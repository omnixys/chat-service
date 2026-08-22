from abc import ABC, abstractmethod

from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.domain.conversation import Conversation
from chat.message.models.domain.message import Message


class DeliveryPolicy(ABC):
    @abstractmethod
    async def determine_channels(
        self,
        message: Message,
        conversation: Conversation,
    ) -> list[CommunicationChannel]: ...
