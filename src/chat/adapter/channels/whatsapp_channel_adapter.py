from __future__ import annotations

from chat.adapter.gateway.gateway_client import GatewayClient
from chat.application.ports.channel_adapter import ChannelAdapter
from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.conversation.models.domain.channel_capabilities import ChannelCapabilities
from chat.conversation.models.domain.conversation import Conversation
from chat.conversation.models.enums.conversation import ChannelType
from chat.message.models.domain.message import Message
from chat.message.models.enums.message import DeliveryStatus
from chat.message.models.events.message import MessageCreatedEvent

logger = __import__("structlog").get_logger(__name__)


class WhatsAppChannelAdapter(ChannelAdapter):
    def __init__(self, gateway_client: GatewayClient, realtime: RealtimePublisher) -> None:
        self._gateway = gateway_client
        self._realtime = realtime

    @property
    def channel_type(self) -> ChannelType:
        return ChannelType.WHATSAPP

    async def capabilities(self) -> ChannelCapabilities:
        return ChannelCapabilities(
            supports_attachments=True,
            supports_rich_text=False,
            supports_formatting=False,
            supports_typing=True,
            supports_read_receipts=True,
            supports_reactions=False,
            supports_quoted_replies=True,
            supports_forwarding=False,
            supports_editing=False,
            supports_deletion=False,
            supports_delivery_status=True,
            supports_presence=True,
        )

    async def send(self, message: Message, conversation: Conversation) -> None:
        logger.info(
            "adapter_whatsapp_send_start",
            message_id=message.id,
            conversation_id=message.conversation_id,
            channel="WHATSAPP",
        )
        result = await self._gateway.send(message, conversation)
        if result.success:
            message.delivery_status = result.status
            message.provider_message_id = result.provider_message_id
            logger.info(
                "adapter_whatsapp_send_sent",
                message_id=message.id,
                conversation_id=message.conversation_id,
                channel="WHATSAPP",
                status=result.status.value,
            )
        else:
            message.delivery_status = DeliveryStatus.FAILED
            logger.warning(
                "adapter_whatsapp_send_failed",
                message_id=message.id,
                conversation_id=message.conversation_id,
                channel="WHATSAPP",
                error=result.error,
            )

        event = MessageCreatedEvent(
            message_id=message.id,
            conversation_id=message.conversation_id,
            sender_id=message.sender_id,
            body=message.body,
            content_type=message.content_type,
            channel=message.channel,
            delivery_status=message.delivery_status,
            created_at=message.created_at,
        )
        await self._realtime.publish(f"conversation:{message.conversation_id}", event)
        for uid in conversation.participant_ids:
            await self._realtime.publish(f"user:{uid}", event)
