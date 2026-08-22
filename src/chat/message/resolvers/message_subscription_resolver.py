from collections.abc import AsyncGenerator

import strawberry
from strawberry.types import Info

from chat.conversation.models.payloads.conversation import Conversation, ConversationType
from chat.core.graphql import get_conversation_read_service, get_principal, get_realtime_service
from chat.message.models.events.message import MessageCreatedEvent
from chat.message.models.payloads.message import Message
from chat.security.http.guards import require_participant

logger = __import__("structlog").get_logger(__name__)


def _to_message_graphql(event: MessageCreatedEvent) -> Message:
    return Message(
        id=strawberry.ID(event.message_id),
        conversation_id=strawberry.ID(event.conversation_id),
        sender_id=event.sender_id,
        body=event.body,
        content_type=event.content_type,
        channel=event.channel.type,
        delivery_status=event.delivery_status,
        created_at=event.created_at,
    )


def _to_conversation_graphql(event: MessageCreatedEvent) -> Conversation:
    return Conversation(
        id=strawberry.ID(event.conversation_id),
        type=ConversationType.DIRECT,
        participants=[],
        last_message=event.body,
        last_message_at=event.created_at,
        unread_count=0,
        channel=event.channel.type,
        external_address=None,
        external_display_name=None,
    )


@strawberry.type
class MessageSubscription:
    @strawberry.subscription
    async def message_received(
        self,
        info: Info,
        conversation_id: strawberry.ID,
    ) -> AsyncGenerator[Message]:
        realtime = get_realtime_service(info)
        principal = await get_principal(info)
        await require_participant(
            get_conversation_read_service(info),
            str(conversation_id),
            principal.user_id,
        )
        logger.debug(
            "subscription_message_received_started",
            user_id=principal.user_id,
            conversation_id=str(conversation_id),
        )
        channel = f"conversation:{conversation_id}"
        async for event in realtime.subscribe(channel):
            yield _to_message_graphql(event)

    @strawberry.subscription
    async def conversation_updated(self, info: Info) -> AsyncGenerator[Conversation]:
        realtime = get_realtime_service(info)
        principal = await get_principal(info)
        logger.debug("subscription_conversation_updated_started", user_id=principal.user_id)
        channel = f"user:{principal.user_id}"
        async for event in realtime.subscribe(channel):
            yield _to_conversation_graphql(event)
