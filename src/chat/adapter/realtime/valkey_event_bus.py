from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from datetime import datetime

from redis.asyncio import Redis

from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.enums.conversation import ChannelType
from chat.message.models.enums.message import DeliveryStatus, MessageContentType
from chat.message.models.events.message import MessageCreatedEvent

logger = __import__("structlog").get_logger(__name__)


class ValkeyEventBus(RealtimePublisher):
    def __init__(self, url: str, password: str = "") -> None:
        self._redis = Redis.from_url(url, password=password or None, decode_responses=True)

    async def publish(self, channel: str, event: MessageCreatedEvent) -> None:
        try:
            payload = {
                "messageId": event.message_id,
                "conversationId": event.conversation_id,
                "senderId": event.sender_id,
                "body": event.body,
                "contentType": event.content_type.value,
                "channel": event.channel.type.value,
                "deliveryStatus": event.delivery_status.value,
                "createdAt": event.created_at.isoformat(),
            }
            await self._redis.publish(f"chat:{channel}", json.dumps(payload))
        except Exception as exc:
            logger.error("valkey_publish_error", channel=channel, message_id=event.message_id, error=str(exc))

    async def subscribe(self, channel: str) -> AsyncGenerator[MessageCreatedEvent]:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(f"chat:{channel}")
        try:
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    payload = json.loads(item["data"])
                    yield MessageCreatedEvent(
                        message_id=payload["messageId"],
                        conversation_id=payload["conversationId"],
                        sender_id=payload["senderId"],
                        body=payload["body"],
                        content_type=MessageContentType(payload["contentType"]),
                        channel=CommunicationChannel(type=ChannelType(payload["channel"])),
                        delivery_status=DeliveryStatus(payload["deliveryStatus"]),
                        created_at=datetime.fromisoformat(payload["createdAt"]),
                    )
                except (json.JSONDecodeError, KeyError, ValueError) as exc:
                    logger.error("valkey_deserialization_error", channel=channel, error=str(exc))
        finally:
            await pubsub.unsubscribe(f"chat:{channel}")
            await pubsub.aclose()  # type: ignore[no-untyped-call]

    async def unsubscribe(self, channel: str, queue_id: str) -> None:
        logger.debug("unsubscribe_noop", channel=channel)

    async def health(self) -> bool:
        return bool(await self._redis.ping())

    async def close(self) -> None:
        await self._redis.aclose()
