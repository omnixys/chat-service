from dataclasses import dataclass

from chat.conversation.models.enums.conversation import ChannelType


@dataclass(frozen=True)
class CommunicationChannel:
    type: ChannelType
