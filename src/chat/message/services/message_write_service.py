from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.conversation.errors.conversation import (
    ConversationNotFoundError,
    NotParticipantError,
)
from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.core.utils import utcnow
from chat.message.errors.message import EmptyMessageError
from chat.message.models.domain.message import Message
from chat.message.models.domain.read_state import ReadState
from chat.message.services.message_dispatcher import MessageDispatcher

if TYPE_CHECKING:
    from chat.analytics.outbox import AnalyticsFactWriter

logger = __import__("structlog").get_logger(__name__)


class MessageWriteService:
    def __init__(  # noqa: PLR0913
        self,
        session: AsyncSession,
        conversation_repo: ConversationRepository,
        message_repo: MessageRepository,
        read_state_repo: ReadStateRepository,
        dispatcher: MessageDispatcher,
        analytics: AnalyticsFactWriter | None = None,
    ) -> None:
        self.session = session
        self.conversation_repo = conversation_repo
        self.message_repo = message_repo
        self.read_state_repo = read_state_repo
        self.dispatcher = dispatcher
        self.analytics = analytics

    async def send_message(
        self,
        conversation_id: str,
        sender_id: str,
        body: str,
    ) -> Message:
        if not body or not body.strip():
            raise EmptyMessageError

        if not await self.conversation_repo.is_participant(conversation_id, sender_id):
            raise NotParticipantError(sender_id, conversation_id)

        conversation = await self.conversation_repo.find_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError(conversation_id)

        logger.info(
            "send_message",
            conversation_id=conversation_id,
            sender_id=sender_id,
            channel=conversation.channel.value,
        )

        message = Message(
            conversation_id=conversation_id,
            sender_id=sender_id,
            body=body.strip(),
            channel=CommunicationChannel(type=conversation.channel),
        )
        message = await self.message_repo.save(message)

        if self.analytics is not None:
            await self.analytics.enqueue(
                topic="chat.message.sent.v1",
                event_name="MessageSent",
                aggregate_id=message.id,
                aggregate_type="message",
                subject_id=sender_id,
                properties={
                    "channel": message.channel.type.value,
                    "contentType": message.content_type.value,
                    "conversationId": conversation_id,
                },
            )
        await self.session.commit()

        if conversation is not None:
            participant_ids = await self.conversation_repo.get_participant_ids(conversation_id)
            conversation.participant_ids = participant_ids
            await self.dispatcher.dispatch(message, conversation)
            if message.delivery_status.value != "PENDING":
                from chat.db.models import MessageModel

                db_message = await self.session.get(MessageModel, message.id)
                if db_message is not None:
                    db_message.delivery_status = message.delivery_status.value
                    db_message.provider_message_id = message.provider_message_id
                    await self.session.commit()

        logger.info(
            "send_message_completed",
            message_id=message.id,
            conversation_id=conversation_id,
            status=message.delivery_status.value,
        )
        return message

    async def mark_read(self, conversation_id: str, user_id: str) -> bool:
        if not await self.conversation_repo.is_participant(conversation_id, user_id):
            raise NotParticipantError(user_id, conversation_id)

        last_message_id = await self.message_repo.get_last_message_id(conversation_id)

        read_state = ReadState(
            conversation_id=conversation_id,
            user_id=user_id,
            last_read_at=utcnow(),
            last_read_message_id=last_message_id,
        )
        await self.read_state_repo.upsert(read_state)
        await self.session.commit()
        logger.debug("mark_read", conversation_id=conversation_id, user_id=user_id, last_message_id=last_message_id)
        return True
