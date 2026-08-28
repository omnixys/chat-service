import strawberry
from strawberry.types import Info

from chat.core.graphql import get_message_write_service, get_principal
from chat.message.models.payloads.message import Message
from chat.security.http.guards import require_verified_tenant

logger = __import__("structlog").get_logger(__name__)


@strawberry.type
class MessageMutation:
    @strawberry.mutation
    async def send_message(
        self,
        info: Info,
        conversation_id: strawberry.ID,
        body: str,
    ) -> Message:
        principal = await get_principal(info)
        require_verified_tenant()
        service = get_message_write_service(info)
        logger.info("graphql_send_message", user_id=principal.user_id, conversation_id=str(conversation_id))
        m = await service.send_message(
            str(conversation_id),
            principal.user_id,
            body,
        )
        return Message(
            id=strawberry.ID(m.id),
            conversation_id=strawberry.ID(m.conversation_id),
            sender_id=m.sender_id,
            body=m.body,
            content_type=m.content_type,
            channel=m.channel.type,
            delivery_status=m.delivery_status,
            created_at=m.created_at,
            edited_at=m.edited_at,
            deleted_at=m.deleted_at,
        )
