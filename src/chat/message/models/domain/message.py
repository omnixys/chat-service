from dataclasses import dataclass, field
from datetime import datetime

from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.enums.conversation import ChannelType
from chat.core.utils import generate_uuid, utcnow
from chat.message.models.enums.message import DeliveryStatus, MessageContentType


@dataclass
class Message:
    id: str = field(default_factory=generate_uuid)
    conversation_id: str = ""
    sender_id: str = ""
    body: str = ""
    content_type: MessageContentType = MessageContentType.TEXT
    channel: CommunicationChannel = field(
        default_factory=lambda: CommunicationChannel(type=ChannelType.IN_APP),
    )
    delivery_status: DeliveryStatus = DeliveryStatus.PENDING
    provider_message_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
