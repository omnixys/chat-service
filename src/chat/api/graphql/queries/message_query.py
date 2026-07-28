from datetime import datetime

import strawberry
from strawberry.types import Info

from chat.api.graphql.context import get_message_service, get_principal
from chat.api.graphql.types.message import Message


@strawberry.type
class MessageQuery:
    @strawberry.field
    async def messages(
        self,
        info: Info,
        conversation_id: strawberry.ID,
        limit: int = 50,
        before: datetime | None = None,
    ) -> list[Message]:
        service = get_message_service(info)
        principal = await get_principal(info)
        msgs = await service.get_messages(
            str(conversation_id),
            principal.user_id,
            limit=limit,
            before=before,
        )
        return [
            Message(
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
            for m in msgs
        ]
