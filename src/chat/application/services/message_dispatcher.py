from chat.application.ports.delivery_policy import DeliveryPolicy
from chat.application.services.message_router import MessageRouter
from chat.domain.models.conversation import Conversation
from chat.domain.models.message import Message

logger = __import__("structlog").get_logger(__name__)


class MessageDispatcher:
    def __init__(self, policy: DeliveryPolicy, router: MessageRouter) -> None:
        self._policy = policy
        self._router = router

    async def dispatch(self, message: Message, conversation: Conversation) -> None:
        channels = await self._policy.determine_channels(message, conversation)
        logger.info("dispatch_started", message_id=message.id, conversation_id=conversation.id, channels=[c.type.value for c in channels])
        for channel in channels:
            try:
                adapter = self._router.get_adapter(channel)
                await adapter.send(message, conversation)
                logger.info("dispatch_channel_sent", message_id=message.id, channel=channel.type.value)
            except Exception as exc:
                logger.error("dispatch_channel_failed", message_id=message.id, channel=channel.type.value, error=str(exc))
                raise
