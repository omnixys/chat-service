from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.application.services.message_dispatcher import MessageDispatcher
from chat.domain.errors import EmptyMessageError
from chat.domain.models.communication_channel import CommunicationChannel
from chat.domain.models.message import Message

logger = __import__("structlog").get_logger(__name__)


class MessageService:
    def __init__(
        self,
        session: AsyncSession,
        conversation_repo: ConversationRepository,
        message_repo: MessageRepository,
        read_state_repo: ReadStateRepository,
        dispatcher: MessageDispatcher,
    ) -> None:
        self.session = session
        self.conversation_repo = conversation_repo
        self.message_repo = message_repo
        self.read_state_repo = read_state_repo
        self.dispatcher = dispatcher

    async def send_message(
        self,
        conversation_id: str,
        sender_id: str,
        body: str,
    ) -> Message:
        if not body or not body.strip():
            raise EmptyMessageError

        if not await self.conversation_repo.is_participant(conversation_id, sender_id):
            from chat.domain.errors import NotParticipantError

            raise NotParticipantError(sender_id, conversation_id)

        conversation = await self.conversation_repo.find_by_id(conversation_id)
        if conversation is None:
            from chat.domain.errors import ConversationNotFoundError

            raise ConversationNotFoundError(conversation_id)

        logger.info("send_message", conversation_id=conversation_id, sender_id=sender_id, channel=conversation.channel.value)

        message = Message(
            conversation_id=conversation_id,
            sender_id=sender_id,
            body=body.strip(),
            channel=CommunicationChannel(type=conversation.channel),
        )
        message = await self.message_repo.save(message)

        await self.session.commit()

        if conversation is not None:
            participant_ids = await self.conversation_repo.get_participant_ids(conversation_id)
            conversation.participant_ids = participant_ids
            await self.dispatcher.dispatch(message, conversation)
            if message.delivery_status.value != "PENDING":
                from chat.infrastructure.db.models import MessageModel

                db_message = await self.session.get(MessageModel, message.id)
                if db_message is not None:
                    db_message.delivery_status = message.delivery_status.value
                    db_message.provider_message_id = message.provider_message_id
                    await self.session.commit()

        logger.info("send_message_completed", message_id=message.id, conversation_id=conversation_id, status=message.delivery_status.value)
        return message

    async def get_messages(
        self,
        conversation_id: str,
        user_id: str,
        limit: int = 50,
        before: datetime | None = None,
    ) -> list[Message]:
        if not await self.conversation_repo.is_participant(conversation_id, user_id):
            from chat.domain.errors import NotParticipantError

            raise NotParticipantError(user_id, conversation_id)

        return await self.message_repo.find_by_conversation_id(
            conversation_id,
            limit=limit,
            before=before,
        )
