from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.message_repository import MessageRepository as MessageRepositoryPort
from chat.domain.enums import ChannelType, DeliveryStatus
from chat.domain.models.communication_channel import CommunicationChannel
from chat.domain.models.message import Message
from chat.infrastructure.db.models import MessageModel

logger = __import__("structlog").get_logger(__name__)


class SqlAlchemyMessageRepository(MessageRepositoryPort):
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def find_by_conversation_id(
        self,
        conversation_id: str,
        limit: int = 50,
        before: datetime | None = None,
    ) -> list[Message]:
        stmt = (
            select(MessageModel)
            .where(MessageModel.conversation_id == conversation_id)
            .where(MessageModel.deleted_at.is_(None))
        )
        if before is not None:
            stmt = stmt.where(MessageModel.created_at < before)
        stmt = stmt.order_by(MessageModel.created_at.desc()).limit(limit)
        result = await self.session.execute(stmt)
        rows = result.scalars().all()
        messages = [self._to_domain(row) for row in rows]
        messages.reverse()
        return messages

    async def save(self, message: Message) -> Message:
        model = MessageModel(
            id=message.id,
            conversation_id=message.conversation_id,
            sender_id=message.sender_id,
            body=message.body,
            content_type=message.content_type.value,
            channel=message.channel.type.value,
            delivery_status=message.delivery_status.value,
            provider_message_id=message.provider_message_id,
            created_at=message.created_at,
        )
        self.session.add(model)
        await self.session.flush()
        logger.debug(
            "message_save",
            message_id=message.id,
            conversation_id=message.conversation_id,
            channel=message.channel.type.value,
        )
        return message

    async def count_unread(
        self,
        conversation_id: str,
        user_id: str,
        last_read_at: datetime | None,
    ) -> int:
        stmt = (
            select(func.count(MessageModel.id))
            .where(MessageModel.conversation_id == conversation_id)
            .where(MessageModel.sender_id != user_id)
            .where(MessageModel.deleted_at.is_(None))
        )
        if last_read_at is not None:
            stmt = stmt.where(MessageModel.created_at > last_read_at)
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def get_last_message(self, conversation_id: str) -> Message | None:
        stmt = (
            select(MessageModel)
            .where(MessageModel.conversation_id == conversation_id)
            .where(MessageModel.deleted_at.is_(None))
            .order_by(MessageModel.created_at.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return self._to_domain(row)

    async def get_last_message_id(self, conversation_id: str) -> str | None:
        msg = await self.get_last_message(conversation_id)
        return msg.id if msg else None

    async def find_by_provider_message_id(self, provider_message_id: str) -> Message | None:
        result = await self.session.execute(
            select(MessageModel).where(MessageModel.provider_message_id == provider_message_id),
        )
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update_delivery_status(
        self,
        message_id: str,
        status: str,
        provider_message_id: str | None = None,
    ) -> Message | None:
        model = await self.session.get(MessageModel, message_id)
        if model is None:
            return None
        model.delivery_status = status
        if provider_message_id:
            model.provider_message_id = provider_message_id
        await self.session.flush()
        return self._to_domain(model)

    def _to_domain(self, model: MessageModel) -> Message:
        from chat.domain.enums import MessageContentType

        return Message(
            id=model.id,
            conversation_id=model.conversation_id,
            sender_id=model.sender_id,
            body=model.body,
            content_type=MessageContentType(model.content_type),
            channel=CommunicationChannel(type=ChannelType(model.channel)),
            delivery_status=DeliveryStatus(model.delivery_status),
            provider_message_id=model.provider_message_id,
            created_at=model.created_at,
            edited_at=model.edited_at,
            deleted_at=model.deleted_at,
        )
