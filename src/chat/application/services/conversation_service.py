from __future__ import annotations

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.domain.enums import ChannelType, ConversationType
from chat.domain.errors import (
    ConversationNotFoundError,
    NotParticipantError,
)
from chat.domain.models.conversation import Conversation, build_direct_participant_key

logger = __import__("structlog").get_logger(__name__)


class ConversationService:
    def __init__(
        self,
        session: AsyncSession,
        conversation_repo: ConversationRepository,
        message_repo: MessageRepository,
        read_state_repo: ReadStateRepository,
    ) -> None:
        self.session = session
        self.conversation_repo = conversation_repo
        self.message_repo = message_repo
        self.read_state_repo = read_state_repo

    async def create_direct_conversation(
        self,
        user_a_id: str,
        user_b_id: str,
        conversation_type: ConversationType = ConversationType.DIRECT,
    ) -> Conversation:
        if conversation_type not in {ConversationType.DIRECT, ConversationType.SUPPORT}:
            raise ValueError("In-app conversations must be DIRECT or SUPPORT")

        participant_key = build_direct_participant_key(user_a_id, user_b_id)
        key = (
            participant_key
            if conversation_type is ConversationType.DIRECT
            else f"support:{participant_key}"
        )

        existing = await self.conversation_repo.find_by_participant_pair_key(key)
        if existing is not None:
            logger.debug("conversation_already_exists", conversation_id=existing.id, key=key)
            return existing

        conversation = Conversation(type=conversation_type, participant_pair_key=key)
        conversation = await self.conversation_repo.save(conversation)
        await self.conversation_repo.add_participant(conversation.id, user_a_id)
        await self.conversation_repo.add_participant(conversation.id, user_b_id)

        try:
            await self.session.flush()
        except IntegrityError:
            logger.info("conversation_concurrent_create", key=key)
            await self.session.rollback()
            existing = await self.conversation_repo.find_by_participant_pair_key(key)
            if existing is None:
                raise
            return existing

        await self.session.commit()
        conversation.participant_ids = [user_a_id, user_b_id]
        logger.info("conversation_created", conversation_id=conversation.id, type=conversation_type.value, key=key)
        return conversation

    async def create_whatsapp_conversation(
        self, owner_user_id: str, phone_number: str, display_name: str | None = None,
    ) -> Conversation:
        address = normalize_e164(phone_number)
        existing = await self.conversation_repo.find_by_external_address(address)
        if existing is not None:
            if not await self.conversation_repo.is_participant(existing.id, owner_user_id):
                raise ValueError("WhatsApp contact already belongs to another conversation")
            logger.debug("whatsapp_conversation_already_exists", conversation_id=existing.id, address=address)
            return existing
        conversation = Conversation(
            participant_pair_key=f"whatsapp:{address}",
            channel=ChannelType.WHATSAPP,
            external_address=address,
            external_display_name=display_name.strip() if display_name else None,
        )
        conversation = await self.conversation_repo.save(conversation)
        await self.conversation_repo.add_participant(conversation.id, owner_user_id)
        await self.session.commit()
        conversation.participant_ids = [owner_user_id]
        logger.info("whatsapp_conversation_created", conversation_id=conversation.id, address=address, owner=owner_user_id)
        return conversation

    async def get_conversation(self, conversation_id: str, user_id: str) -> Conversation:
        conversation = await self.conversation_repo.find_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError(conversation_id)

        if not await self.conversation_repo.is_participant(conversation_id, user_id):
            raise NotParticipantError(user_id, conversation_id)

        last_msg = await self.message_repo.get_last_message(conversation_id)
        if last_msg is not None:
            conversation.last_message = last_msg.body
            conversation.last_message_at = last_msg.created_at

        read_state = await self.read_state_repo.find(conversation_id, user_id)
        last_read_at = read_state.last_read_at if read_state else None
        conversation.unread_count = await self.message_repo.count_unread(
            conversation_id, user_id, last_read_at,
        )

        participant_ids = await self.conversation_repo.get_participant_ids(conversation_id)
        conversation.participant_ids = participant_ids
        return conversation

    async def list_conversations(self, user_id: str) -> list[Conversation]:
        conversations = await self.conversation_repo.find_by_user_id(user_id)

        result: list[Conversation] = []
        for conv in conversations:
            last_msg = await self.message_repo.get_last_message(conv.id)
            if last_msg is not None:
                conv.last_message = last_msg.body
                conv.last_message_at = last_msg.created_at

            read_state = await self.read_state_repo.find(conv.id, user_id)
            last_read_at = read_state.last_read_at if read_state else None
            conv.unread_count = await self.message_repo.count_unread(conv.id, user_id, last_read_at)

            participant_ids = await self.conversation_repo.get_participant_ids(conv.id)
            conv.participant_ids = participant_ids
            result.append(conv)

        return result

    async def verify_participant(self, conversation_id: str, user_id: str) -> None:
        if not await self.conversation_repo.is_participant(conversation_id, user_id):
            raise NotParticipantError(user_id, conversation_id)


def normalize_e164(value: str) -> str:
    normalized = re.sub(r"[\s().-]", "", value.strip())
    if not re.fullmatch(r"\+[1-9]\d{7,14}", normalized):
        raise ValueError("phone number must use E.164 format")
    return normalized
