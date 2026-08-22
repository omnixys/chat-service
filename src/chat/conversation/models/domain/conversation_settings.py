from dataclasses import dataclass


@dataclass
class ConversationSettings:
    conversation_id: str = ""
    pinned: bool = False
    archived: bool = False
    muted: bool = False
