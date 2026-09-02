import asyncio

import pytest

from chat.adapter.realtime.in_memory_event_bus import InMemoryEventBus
from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.enums.conversation import ChannelType
from chat.conversation.services.conversation_write_service import ConversationWriteService
from chat.message.models.enums.message import DeliveryStatus, MessageContentType
from chat.message.models.events.message import MessageCreatedEvent
from chat.message.services.message_read_service import MessageReadService
from chat.message.services.message_write_service import MessageWriteService


class TestEventBus:
    async def test_publish_and_subscribe(self, realtime: InMemoryEventBus) -> None:
        event = MessageCreatedEvent(
            message_id="msg-1",
            conversation_id="conv-1",
            sender_id="01920000-1000-7000-8000-000000000001",
            body="Hello",
            content_type=MessageContentType.TEXT,
            channel=CommunicationChannel(type=ChannelType.IN_APP),
            delivery_status=DeliveryStatus.PENDING,
            created_at=None,  # type: ignore[arg-type]
        )

        async def subscriber() -> MessageCreatedEvent:
            async for e in realtime.subscribe("user:rachel"):
                return e
            raise AssertionError("unreachable")

        async def publisher() -> None:
            await asyncio.sleep(0.05)
            await realtime.publish("user:rachel", event)

        result = await asyncio.gather(subscriber(), publisher())
        received = result[0]
        assert received.body == "Hello"
        assert received.sender_id == "01920000-1000-7000-8000-000000000001"

    async def test_subscription_cleanup_after_disconnect(self, realtime: InMemoryEventBus) -> None:

        async def subscriber() -> MessageCreatedEvent:
            gen = realtime.subscribe("user:rachel")
            async for m in gen:
                return m
            raise AssertionError("unreachable")

        task = asyncio.create_task(subscriber())
        await asyncio.sleep(0.05)
        task.cancel()
        await asyncio.sleep(0.05)

        assert "user:rachel" not in realtime._queues or realtime._queues["user:rachel"] == {}

    async def test_offline_user_can_load_history_later(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        message_read_service: MessageReadService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        await message_write_service.send_message(
            conv.id,
            "01920000-1000-7000-8000-000000000001",
            "Message while offline",
        )

        msgs = await message_read_service.get_messages(conv.id, "01920000-1000-7000-8000-000000000002")
        assert len(msgs) == 1
        assert msgs[0].body == "Message while offline"


class TestEndToEndRealtime:
    async def test_delivers_to_both_participants(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        realtime: InMemoryEventBus,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        received: dict[str, asyncio.Event] = {
            "01920000-1000-7000-8000-000000000001": asyncio.Event(),
            "01920000-1000-7000-8000-000000000002": asyncio.Event(),
        }
        results: dict[str, str] = {}

        async def subscribe_and_capture(user_id: str) -> None:
            async for msg in realtime.subscribe(f"user:{user_id}"):
                results[user_id] = msg.body
                received[user_id].set()
                break

        tasks = [
            asyncio.create_task(subscribe_and_capture("01920000-1000-7000-8000-000000000001")),
            asyncio.create_task(subscribe_and_capture("01920000-1000-7000-8000-000000000002")),
        ]
        await asyncio.sleep(0.05)

        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Hallo Rachel!")

        await asyncio.wait_for(
            asyncio.gather(
                asyncio.create_task(received["01920000-1000-7000-8000-000000000001"].wait()),
                asyncio.create_task(received["01920000-1000-7000-8000-000000000002"].wait()),
            ),
            timeout=5.0,
        )

        for t in tasks:
            t.cancel()

        assert results.get("01920000-1000-7000-8000-000000000001") == "Hallo Rachel!"
        assert results.get("01920000-1000-7000-8000-000000000002") == "Hallo Rachel!"

    async def test_non_participant_does_not_receive(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        realtime: InMemoryEventBus,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        received_eve = asyncio.Event()
        results: dict[str, str] = {}

        async def subscribe_eve() -> None:
            async for msg in realtime.subscribe("user:01920000-1000-7000-8000-000000000003"):
                results["01920000-1000-7000-8000-000000000003"] = msg.body
                received_eve.set()
                break

        task = asyncio.create_task(subscribe_eve())
        await asyncio.sleep(0.05)

        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Secret")

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(received_eve.wait(), timeout=0.5)

        task.cancel()
        assert "01920000-1000-7000-8000-000000000003" not in results

    async def test_conversation_subscription_gets_event(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        realtime: InMemoryEventBus,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        received = asyncio.Event()
        results: dict[str, str] = {}

        async def subscribe_conversation() -> None:
            async for msg in realtime.subscribe(f"conversation:{conv.id}"):
                results["body"] = msg.body
                received.set()
                break

        task = asyncio.create_task(subscribe_conversation())
        await asyncio.sleep(0.05)

        await message_write_service.send_message(
            conv.id,
            "01920000-1000-7000-8000-000000000001",
            "Hello via conversation channel",
        )

        await asyncio.wait_for(received.wait(), timeout=5.0)
        task.cancel()

        assert results.get("body") == "Hello via conversation channel"
