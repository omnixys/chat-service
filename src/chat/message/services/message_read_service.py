from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.conversation.errors.conversation import NotParticipantError
from chat.message.models.domain.message import Message

logger = __import__("structlog").get_logger(__name__)


class MessageReadService:
    def __init__(
        self,
        session: AsyncSession,
        conversation_repo: ConversationRepository,
        message_repo: MessageRepository,
    ) -> None:
        self.session = session
        self.conversation_repo = conversation_repo
        self.message_repo = message_repo

    async def get_messages(
        self,
        conversation_id: str,
        user_id: str,
        limit: int = 50,
        before: datetime | None = None,
    ) -> list[Message]:
        if not await self.conversation_repo.is_participant(conversation_id, user_id):
            raise NotParticipantError(user_id, conversation_id)

        return await self.message_repo.find_by_conversation_id(
            conversation_id,
            limit=limit,
            before=before,
        )
