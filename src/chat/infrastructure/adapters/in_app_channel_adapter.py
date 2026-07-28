from chat.application.ports.channel_adapter import ChannelAdapter
from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.domain.enums import ChannelType
from chat.domain.events import MessageCreatedEvent
from chat.domain.models.channel_capabilities import ChannelCapabilities
from chat.domain.models.conversation import Conversation
from chat.domain.models.message import Message

logger = __import__("structlog").get_logger(__name__)


class InAppChannelAdapter(ChannelAdapter):
    def __init__(self, realtime: RealtimePublisher) -> None:
        self._realtime = realtime

    @property
    def channel_type(self) -> ChannelType:
        return ChannelType.IN_APP

    async def capabilities(self) -> ChannelCapabilities:
        return ChannelCapabilities(
            supports_attachments=True,
            supports_rich_text=True,
            supports_formatting=False,
            supports_typing=True,
            supports_read_receipts=True,
            supports_reactions=True,
            supports_quoted_replies=True,
            supports_forwarding=False,
            supports_editing=True,
            supports_deletion=True,
            supports_delivery_status=True,
            supports_presence=True,
        )

    async def send(self, message: Message, conversation: Conversation) -> None:
        logger.info("in_app_send", message_id=message.id, conversation_id=message.conversation_id)
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
