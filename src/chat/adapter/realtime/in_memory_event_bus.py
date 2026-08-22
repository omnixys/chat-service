from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator

from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.message.models.events.message import MessageCreatedEvent


class InMemoryEventBus(RealtimePublisher):
    def __init__(self) -> None:
        self._queues: dict[str, dict[str, asyncio.Queue[MessageCreatedEvent]]] = {}

    async def publish(self, channel: str, event: MessageCreatedEvent) -> None:
        if channel not in self._queues:
            return
        for queue in self._queues[channel].values():
            await queue.put(event)

    async def subscribe(self, channel: str) -> AsyncGenerator[MessageCreatedEvent]:
        queue_id = str(uuid.uuid4())
        queue: asyncio.Queue[MessageCreatedEvent] = asyncio.Queue()
        self._queues.setdefault(channel, {})[queue_id] = queue
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            await self.unsubscribe(channel, queue_id)

    async def unsubscribe(self, channel: str, queue_id: str) -> None:
        if channel in self._queues and queue_id in self._queues[channel]:
            del self._queues[channel][queue_id]
            if not self._queues[channel]:
                del self._queues[channel]
