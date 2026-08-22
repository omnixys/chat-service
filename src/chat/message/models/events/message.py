from dataclasses import dataclass
from datetime import datetime

from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.message.models.enums.message import DeliveryStatus, MessageContentType


@dataclass
class MessageCreatedEvent:
    message_id: str
    conversation_id: str
    sender_id: str
    body: str
    content_type: MessageContentType
    channel: CommunicationChannel
    delivery_status: DeliveryStatus
    created_at: datetime
