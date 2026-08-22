from abc import ABC, abstractmethod

from chat.conversation.models.domain.channel_capabilities import ChannelCapabilities
from chat.conversation.models.domain.conversation import Conversation
from chat.conversation.models.enums.conversation import ChannelType
from chat.message.models.domain.message import Message


class ChannelAdapter(ABC):
    @property
    @abstractmethod
    def channel_type(self) -> ChannelType: ...

    @abstractmethod
    async def capabilities(self) -> ChannelCapabilities: ...

    @abstractmethod
    async def send(self, message: Message, conversation: Conversation) -> None: ...
