from datetime import datetime

import strawberry

from chat.conversation.models.enums.conversation import ChannelType
from chat.message.models.enums.message import DeliveryStatus, MessageContentType


@strawberry.type
class Message:
    id: strawberry.ID
    conversation_id: strawberry.ID
    sender_id: str
    body: str
    content_type: MessageContentType = MessageContentType.TEXT
    channel: ChannelType = ChannelType.IN_APP
    delivery_status: DeliveryStatus = DeliveryStatus.PENDING
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
