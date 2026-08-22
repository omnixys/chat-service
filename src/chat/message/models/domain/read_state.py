from dataclasses import dataclass
from datetime import datetime


@dataclass
class ReadState:
    id: str = ""
    conversation_id: str = ""
    user_id: str = ""
    last_read_at: datetime | None = None
    last_read_message_id: str | None = None
