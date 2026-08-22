from dataclasses import dataclass, field
from typing import Any

from security import current_request_context
from strawberry.fastapi import BaseContext
from strawberry.types import Info

from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.conversation.services.conversation_read_service import ConversationReadService
from chat.conversation.services.conversation_write_service import ConversationWriteService
from chat.message.services.message_read_service import MessageReadService
from chat.message.services.message_write_service import MessageWriteService
from chat.security.http.auth import Principal, authenticate_connection

logger = __import__("structlog").get_logger(__name__)


@dataclass
class GraphQLContext(BaseContext):
    conversation_read_service: ConversationReadService = field(default=None)  # type: ignore[assignment]
    conversation_write_service: ConversationWriteService = field(default=None)  # type: ignore[assignment]
    message_read_service: MessageReadService = field(default=None)  # type: ignore[assignment]
    message_write_service: MessageWriteService = field(default=None)  # type: ignore[assignment]
    realtime: RealtimePublisher = field(default=None)  # type: ignore[assignment]
    principal: Principal = field(default=None)  # type: ignore[assignment]


def get_conversation_read_service(info: Info[GraphQLContext, Any]) -> ConversationReadService:
    ctx: GraphQLContext = info.context
    return ctx.conversation_read_service


def get_conversation_write_service(info: Info[GraphQLContext, Any]) -> ConversationWriteService:
    ctx: GraphQLContext = info.context
    return ctx.conversation_write_service


def get_message_read_service(info: Info[GraphQLContext, Any]) -> MessageReadService:
    ctx: GraphQLContext = info.context
    return ctx.message_read_service


def get_message_write_service(info: Info[GraphQLContext, Any]) -> MessageWriteService:
    ctx: GraphQLContext = info.context
    return ctx.message_write_service


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
