from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from chat.message.models.events.message import MessageCreatedEvent


class RealtimePublisher(ABC):
    @abstractmethod
    async def publish(self, channel: str, event: MessageCreatedEvent) -> None: ...

    @abstractmethod
    async def subscribe(self, channel: str) -> AsyncGenerator[MessageCreatedEvent]:
        if False:
            yield

    @abstractmethod
    async def unsubscribe(self, channel: str, queue_id: str) -> None: ...
