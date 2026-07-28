from dataclasses import dataclass, field
from typing import Any

from security import current_request_context
from strawberry.fastapi import BaseContext
from strawberry.types import Info

from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.application.services.conversation_service import ConversationService
from chat.application.services.message_service import MessageService
from chat.application.services.read_state_service import ReadStateService
from chat.security import Principal, authenticate_connection

logger = __import__("structlog").get_logger(__name__)


@dataclass
class GraphQLContext(BaseContext):
    conversation_service: ConversationService = field(default=None)  # type: ignore[assignment]
    message_service: MessageService = field(default=None)  # type: ignore[assignment]
    read_state_service: ReadStateService = field(default=None)  # type: ignore[assignment]
    realtime: RealtimePublisher = field(default=None)  # type: ignore[assignment]
    principal: Principal = field(default=None)  # type: ignore[assignment]


def get_conversation_service(info: Info[GraphQLContext, Any]) -> ConversationService:
    ctx: GraphQLContext = info.context
    return ctx.conversation_service


def get_message_service(info: Info[GraphQLContext, Any]) -> MessageService:
    ctx: GraphQLContext = info.context
    return ctx.message_service


def get_read_state_service(info: Info[GraphQLContext, Any]) -> ReadStateService:
    ctx: GraphQLContext = info.context
    return ctx.read_state_service


def get_realtime_service(info: Info[GraphQLContext, Any]) -> RealtimePublisher:
    ctx: GraphQLContext = info.context
    return ctx.realtime


async def get_principal(info: Info[GraphQLContext, Any]) -> Principal:
    ctx: GraphQLContext = info.context
    if ctx.principal is not None:
        return ctx.principal

    req_ctx = current_request_context()
    if req_ctx.is_authenticated and req_ctx.user_id:
        ctx.principal = Principal(
            user_id=req_ctx.user_id,
            username=req_ctx.username or "",
        )
        logger.debug("principal_from_request_context", user_id=ctx.principal.user_id)
        return ctx.principal

    if ctx.request is not None:
        ctx.principal = await authenticate_connection(ctx.request, ctx.connection_params)
        logger.debug("principal_from_http_auth", user_id=ctx.principal.user_id)
        return ctx.principal

    logger.warning("principal_authentication_required")
    raise PermissionError("authentication required")
