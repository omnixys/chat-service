from chat.application.ports.channel_adapter import ChannelAdapter
from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.enums.conversation import ChannelType

logger = __import__("structlog").get_logger(__name__)


class MessageRouter:
    def __init__(self, adapters: dict[ChannelType, ChannelAdapter]) -> None:
        self._adapters = adapters

    def get_adapter(self, channel: CommunicationChannel) -> ChannelAdapter:
        adapter = self._adapters.get(channel.type)
        if adapter is None:
            logger.error("no_adapter_for_channel", channel=channel.type.value)
            raise ValueError(f"No adapter registered for channel: {channel.type}")
        return adapter
