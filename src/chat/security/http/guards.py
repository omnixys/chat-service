from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from security import current_request_context

from chat.conversation.errors.conversation import NotParticipantError
from chat.core.graphql import get_principal
from chat.security.errors import AuthenticationRequiredError, VerifiedTenantRequiredError

if TYPE_CHECKING:
    from strawberry.types import Info

    from chat.conversation.services.conversation_read_service import ConversationReadService
    from chat.core.graphql import GraphQLContext
    from chat.security.http.auth import Principal

logger = __import__("structlog").get_logger(__name__)


async def require_principal(info: Info[GraphQLContext, object]) -> Principal:
    principal = await get_principal(info)
    if principal is None:
        logger.warning("principal_required")
        raise AuthenticationRequiredError
    return principal


def require_verified_tenant() -> str:
    context = current_request_context()
    tenant_id = context.tenant_id
    tenant_ids = context.tenant_ids or []

    if not context.is_authenticated or not tenant_id or tenant_id not in tenant_ids:
        raise VerifiedTenantRequiredError

    try:
        UUID(tenant_id)
    except ValueError as exc:
        raise VerifiedTenantRequiredError from exc

    return tenant_id


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
