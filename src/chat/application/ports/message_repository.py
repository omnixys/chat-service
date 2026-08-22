from abc import ABC, abstractmethod
from datetime import datetime

from chat.message.models.domain.message import Message


class MessageRepository(ABC):
    @abstractmethod
    async def find_by_conversation_id(
        self,
        conversation_id: str,
        limit: int = 50,
        before: datetime | None = None,
    ) -> list[Message]: ...

    @abstractmethod
    async def save(self, message: Message) -> Message: ...

    @abstractmethod
    async def count_unread(
        self,
        conversation_id: str,
        user_id: str,
        last_read_at: datetime | None,
    ) -> int: ...

    @abstractmethod
    async def get_last_message(self, conversation_id: str) -> Message | None: ...

    @abstractmethod
    async def get_last_message_id(self, conversation_id: str) -> str | None: ...

    @abstractmethod
    async def find_by_provider_message_id(self, provider_message_id: str) -> Message | None: ...

    @abstractmethod
    async def update_delivery_status(
        self,
        message_id: str,
        status: str,
        provider_message_id: str | None = None,
    ) -> Message | None: ...
