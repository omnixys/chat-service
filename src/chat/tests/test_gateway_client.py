from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import respx
from httpx import Response

from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.config import settings
from chat.domain.enums import ChannelType, DeliveryStatus
from chat.domain.events import MessageCreatedEvent
from chat.domain.models.communication_channel import CommunicationChannel
from chat.domain.models.conversation import Conversation
from chat.domain.models.message import Message
from chat.infrastructure.adapters.whatsapp_channel_adapter import WhatsAppChannelAdapter
from chat.infrastructure.gateway.gateway_client import GatewayClient, GatewayResult


@pytest.fixture
def message() -> Message:
    return Message(
        id="msg-1",
        conversation_id="conv-1",
        sender_id="user-1",
        body="Hello",
        channel=CommunicationChannel(type=ChannelType.WHATSAPP),
    )


@pytest.fixture
def conversation() -> Conversation:
    return Conversation(
        id="conv-1",
        participant_ids=["user-1", "user-2"],
        channel=ChannelType.WHATSAPP,
        external_address="+491234567890",
    )


@pytest.fixture
def client() -> GatewayClient:
    original_url = settings.communication_gateway_url
    settings.communication_gateway_url = "http://localhost:8002"
    c = GatewayClient()
    settings.communication_gateway_url = original_url
    return c


class TestGatewayClientSend:
    @respx.mock
    async def test_send_success(
        self,
        client: GatewayClient,
        message: Message,
        conversation: Conversation,
    ) -> None:
        route = respx.post("http://localhost:8002/api/v1/messages/send").mock(
            return_value=Response(
                200,
                json={
                    "success": True,
                    "status": "SENT",
                    "providerMessageId": "evo-123",
                },
            ),
        )

        result = await client.send(message, conversation)

        assert route.called
        assert result.success is True
        assert result.status == DeliveryStatus.SENT

    @respx.mock
    async def test_send_failure(
        self,
        client: GatewayClient,
        message: Message,
        conversation: Conversation,
    ) -> None:
        respx.post("http://localhost:8002/api/v1/messages/send").mock(
            return_value=Response(
                400,
                json={
                    "success": False,
                    "error": "provider_unavailable",
                },
            ),
        )

        result = await client.send(message, conversation)

        assert result.success is False
        assert result.status == DeliveryStatus.FAILED

    @respx.mock
    async def test_send_timeout(
        self,
        client: GatewayClient,
        message: Message,
        conversation: Conversation,
    ) -> None:
        respx.post("http://localhost:8002/api/v1/messages/send").mock(
            side_effect=Exception("timeout"),
        )

        result = await client.send(message, conversation)

        assert result.success is False
        assert result.status == DeliveryStatus.FAILED

    @respx.mock
    async def test_send_payload_structure(
        self,
        client: GatewayClient,
        message: Message,
        conversation: Conversation,
    ) -> None:
        route = respx.post("http://localhost:8002/api/v1/messages/send").mock(
            return_value=Response(200, json={"success": True, "status": "SENT"}),
        )

        await client.send(message, conversation)

        assert route.called
        sent = route.calls.last.request.content
        import json

        payload = json.loads(sent)
        assert payload["id"] == "msg-1"
        assert payload["channel"] == "WHATSAPP"
        assert payload["senderId"] == "user-1"
        assert payload["recipientAddress"] == conversation.external_address
        assert payload["body"] == "Hello"
        assert payload["contentType"] == "TEXT"
        assert payload["metadata"]["conversationId"] == "conv-1"


class RecordingRealtimePublisher(RealtimePublisher):
    def __init__(self) -> None:
        self.published: list[tuple[str, MessageCreatedEvent]] = []

    async def publish(self, channel: str, event: MessageCreatedEvent) -> None:
        self.published.append((channel, event))

    async def subscribe(self, channel: str) -> AsyncGenerator[MessageCreatedEvent]:
        del channel
        if False:
            yield self.published[0][1]

    async def unsubscribe(self, channel: str, queue_id: str) -> None:
        del channel, queue_id


class TestWhatsAppRealtime:
    async def test_successful_send_publishes_each_realtime_channel_once(
        self,
        message: Message,
        conversation: Conversation,
    ) -> None:
        gateway = AsyncMock(spec=GatewayClient)
        gateway.send.return_value = GatewayResult(
            success=True,
            status=DeliveryStatus.SENT,
            provider_message_id="provider-1",
        )
        realtime = RecordingRealtimePublisher()
        adapter = WhatsAppChannelAdapter(gateway, realtime)

        await adapter.send(message, conversation)

        assert [channel for channel, _event in realtime.published] == [
            "conversation:conv-1",
            "user:user-1",
            "user:user-2",
        ]
        assert message.delivery_status is DeliveryStatus.SENT
        assert message.provider_message_id == "provider-1"
