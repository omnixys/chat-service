from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.conversation.errors.conversation import (
    ConversationNotFoundError,
    NotParticipantError,
)
from chat.conversation.models.domain.conversation import Conversation

logger = __import__("structlog").get_logger(__name__)


class ConversationReadService:
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
            conversation_id,
            user_id,
            last_read_at,
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
