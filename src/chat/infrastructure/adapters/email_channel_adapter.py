from __future__ import annotations

from chat.application.ports.channel_adapter import ChannelAdapter
from chat.domain.enums import ChannelType, DeliveryStatus
from chat.domain.models.channel_capabilities import ChannelCapabilities
from chat.domain.models.conversation import Conversation
from chat.domain.models.message import Message
from chat.infrastructure.gateway.gateway_client import GatewayClient

logger = __import__("structlog").get_logger(__name__)


class EmailChannelAdapter(ChannelAdapter):
    def __init__(self, gateway_client: GatewayClient) -> None:
        self._gateway = gateway_client

    @property
    def channel_type(self) -> ChannelType:
        return ChannelType.EMAIL

    async def capabilities(self) -> ChannelCapabilities:
        return ChannelCapabilities(
            supports_attachments=True,
            supports_rich_text=True,
            supports_formatting=True,
            supports_typing=False,
            supports_read_receipts=False,
            supports_reactions=False,
            supports_quoted_replies=True,
            supports_forwarding=True,
            supports_editing=False,
            supports_deletion=False,
            supports_delivery_status=False,
            supports_presence=False,
        )

    async def send(self, message: Message, conversation: Conversation) -> None:
        logger.info(
            "adapter_email_send_start",
            message_id=message.id,
            conversation_id=message.conversation_id,
            channel="EMAIL",
        )
        result = await self._gateway.send(message, conversation)
        if result.success:
            message.delivery_status = result.status
            logger.info(
                "adapter_email_send_sent",
                message_id=message.id,
                conversation_id=message.conversation_id,
                channel="EMAIL",
                status=result.status.value,
            )
        else:
            message.delivery_status = DeliveryStatus.FAILED
            logger.warning(
                "adapter_email_send_failed",
                message_id=message.id,
                conversation_id=message.conversation_id,
                channel="EMAIL",
                error=result.error,
            )
