from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import (
    ConversationRepository as ConversationRepositoryPort,
)
from chat.domain.enums import ChannelType, ConversationType
from chat.domain.models.conversation import Conversation
from chat.domain.utils import generate_uuid, utcnow
from chat.infrastructure.db.models import ConversationModel, ConversationParticipantModel

logger = __import__("structlog").get_logger(__name__)


class SqlAlchemyConversationRepository(ConversationRepositoryPort):
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def find_by_participant_pair_key(self, key: str) -> Conversation | None:
        stmt = select(ConversationModel).where(ConversationModel.participant_pair_key == key)
        result = await self.session.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return self._to_domain(row)

    async def find_by_id(self, conversation_id: str) -> Conversation | None:
        stmt = select(ConversationModel).where(ConversationModel.id == conversation_id)
        result = await self.session.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return self._to_domain(row)

    async def find_by_user_id(self, user_id: str) -> list[Conversation]:
        stmt = (
            select(ConversationModel)
            .where(
                ConversationModel.id.in_(
                    select(ConversationParticipantModel.conversation_id).where(
                        ConversationParticipantModel.user_id == user_id,
                    ),
                ),
            )
            .order_by(ConversationModel.updated_at.desc())
        )
        result = await self.session.execute(stmt)
        rows = result.scalars().all()
        return [self._to_domain(row) for row in rows]

    async def find_by_external_address(self, address: str) -> Conversation | None:
        result = await self.session.execute(
            select(ConversationModel).where(ConversationModel.external_address == address),
        )
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def save(self, conversation: Conversation) -> Conversation:
        model = ConversationModel(
            id=conversation.id,
            type=conversation.type.value,
            participant_pair_key=conversation.participant_pair_key,
            channel=conversation.channel.value,
            external_address=conversation.external_address,
            external_display_name=conversation.external_display_name,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )
        self.session.add(model)
        await self.session.flush()
        logger.debug("conversation_save", conversation_id=conversation.id, type=conversation.type.value)
        return conversation

    async def add_participant(self, conversation_id: str, user_id: str) -> None:
        model = ConversationParticipantModel(
            id=generate_uuid(),
            conversation_id=conversation_id,
            user_id=user_id,
            joined_at=utcnow(),
        )
        self.session.add(model)
        await self.session.flush()

    async def is_participant(self, conversation_id: str, user_id: str) -> bool:
        stmt = select(ConversationParticipantModel).where(
            ConversationParticipantModel.conversation_id == conversation_id,
            ConversationParticipantModel.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_participant_ids(self, conversation_id: str) -> list[str]:
        stmt = select(ConversationParticipantModel.user_id).where(
            ConversationParticipantModel.conversation_id == conversation_id,
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    def _to_domain(self, model: ConversationModel) -> Conversation:
        return Conversation(
            id=model.id,
            type=ConversationType(model.type),
            participant_pair_key=model.participant_pair_key,
            channel=ChannelType(model.channel),
            external_address=model.external_address,
            external_display_name=model.external_display_name,
            created_at=model.created_at,
            updated_at=model.updated_at,
            participant_ids=[p.user_id for p in model.participants],
        )
