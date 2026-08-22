from chat.application.ports.delivery_policy import DeliveryPolicy
from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.domain.conversation import Conversation
from chat.message.models.domain.message import Message


class DefaultDeliveryPolicy(DeliveryPolicy):
    async def determine_channels(
        self,
        message: Message,
        conversation: Conversation,
    ) -> list[CommunicationChannel]:
        return [message.channel]
