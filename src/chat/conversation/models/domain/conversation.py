from dataclasses import dataclass, field
from datetime import datetime

from chat.conversation.models.domain.conversation_settings import ConversationSettings
from chat.conversation.models.enums.conversation import ChannelType, ConversationType
from chat.core.utils import generate_uuid, utcnow


def build_direct_participant_key(user_a_id: str, user_b_id: str) -> str:
    if not user_a_id or not user_b_id:
        raise ValueError("User IDs must not be empty")
    if user_a_id == user_b_id:
        from chat.conversation.errors.conversation import SameUserConversationError

        raise SameUserConversationError(user_a_id)
    return ":".join(sorted([user_a_id, user_b_id]))


@dataclass
class Conversation:
    id: str = field(default_factory=generate_uuid)
    type: ConversationType = ConversationType.DIRECT
    participant_pair_key: str = ""
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    participant_ids: list[str] = field(default_factory=list)
    channel: ChannelType = ChannelType.IN_APP
    external_address: str | None = None
    external_display_name: str | None = None
    last_message: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0
    settings: ConversationSettings | None = None
