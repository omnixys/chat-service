from abc import ABC, abstractmethod

from chat.message.models.domain.read_state import ReadState


class ReadStateRepository(ABC):
    @abstractmethod
    async def find(self, conversation_id: str, user_id: str) -> ReadState | None: ...

    @abstractmethod
    async def upsert(self, read_state: ReadState) -> ReadState: ...
