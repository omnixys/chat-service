from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.domain.models.read_state import ReadState
from chat.domain.utils import utcnow

logger = __import__("structlog").get_logger(__name__)


class ReadStateService:
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

    async def mark_read(self, conversation_id: str, user_id: str) -> bool:
        if not await self.conversation_repo.is_participant(conversation_id, user_id):
            from chat.domain.errors import NotParticipantError

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
