from __future__ import annotations

from strawberry.types import Info

from chat.conversation.errors.conversation import NotParticipantError
from chat.conversation.services.conversation_read_service import ConversationReadService
from chat.core.graphql import GraphQLContext, get_principal
from chat.security.http.auth import Principal

logger = __import__("structlog").get_logger(__name__)


async def require_principal(info: Info[GraphQLContext, object]) -> Principal:
    principal = await get_principal(info)
    if principal is None:
        logger.warning("principal_required")
        raise PermissionError("authentication required")
    return principal


async def require_participant(
    read_service: ConversationReadService,
    conversation_id: str,
    user_id: str,
) -> None:
    try:
        await read_service.verify_participant(conversation_id, user_id)
    except NotParticipantError:
        logger.warning("principal_not_participant", conversation_id=conversation_id, user_id=user_id)
        raise
