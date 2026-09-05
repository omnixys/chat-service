from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from chat.adapter.realtime.in_memory_event_bus import InMemoryEventBus
from chat.api.internal.inbound import router as inbound_router
from chat.api.internal.inbound import set_realtime
from chat.config.settings import settings
from chat.conversation.models.enums.conversation import ChannelType
from chat.conversation.services.conversation_write_service import ConversationWriteService
from chat.db.models import Base
from chat.db.repositories.conversation_repository import (
    SqlAlchemyConversationRepository,
)
from chat.db.session import get_db

TEST_DATABASE_URL = "sqlite+aiosqlite://"

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def _create_tables() -> AsyncGenerator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(autouse=True)
async def _clear_api_keys() -> AsyncGenerator[None]:
    original_chat = settings.chat_service_api_key
    original_gw = settings.communication_gateway_api_key
    settings.chat_service_api_key = ""
    settings.communication_gateway_api_key = ""
    yield
    settings.chat_service_api_key = original_chat
    settings.communication_gateway_api_key = original_gw


@pytest.fixture
def app() -> FastAPI:
    app = FastAPI()
    realtime = InMemoryEventBus()
    set_realtime(realtime)

    async def override_get_db() -> AsyncGenerator[AsyncSession]:
        async with session_factory() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise
            finally:
                await s.close()

    app.dependency_overrides[get_db] = override_get_db
    app.include_router(inbound_router)
    return app


class TestInboundEndpoint:
    async def test_whatsapp_creator_passes_participant_access_check(
        self,
        app: FastAPI,
    ) -> None:
        original_chat_key = settings.chat_service_api_key
        owner_id = "01920000-1000-7000-8000-000000000020"
        async with session_factory() as session:
            conversation_repo = SqlAlchemyConversationRepository(session)

            service = ConversationWriteService(
                session,
                conversation_repo,
            )
            conversation = await service.create_whatsapp_conversation(
                owner_id,
                "+49123456789",
                "WhatsApp Guest",
            )
            assert await conversation_repo.is_participant(conversation.id, owner_id)

        settings.chat_service_api_key = "chat-secret"
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                allowed = await client.get(
                    f"/api/v1/internal/conversations/{conversation.id}/participants/{owner_id}",
                    headers={"x-api-key": "chat-secret"},
                )
                denied = await client.get(
                    f"/api/v1/internal/conversations/{conversation.id}/participants/other-user",
                    headers={"x-api-key": "chat-secret"},
                )
                missing = await client.get(
                    f"/api/v1/internal/conversations/missing/participants/{owner_id}",
                    headers={"x-api-key": "chat-secret"},
                )
            assert allowed.status_code == 204
            assert denied.status_code == 403
            assert missing.status_code == 404
        finally:
            settings.chat_service_api_key = original_chat_key

    async def test_participant_access_check_is_protected(self, app: FastAPI) -> None:
        async with session_factory() as session:
            repo = SqlAlchemyConversationRepository(session)
            from chat.conversation.models.domain.conversation import Conversation as ConvModel

            conversation = ConvModel(id="conv-access", channel=ChannelType.IN_APP)
            await repo.save(conversation)
            await repo.add_participant(conversation.id, "allowed-user")
            await session.commit()

        settings.chat_service_api_key = "chat-secret"
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                missing = await client.get(
                    "/api/v1/internal/conversations/conv-access/participants/allowed-user",
                )
                allowed = await client.get(
                    "/api/v1/internal/conversations/conv-access/participants/allowed-user",
                    headers={"x-api-key": "chat-secret"},
                )
                denied = await client.get(
                    "/api/v1/internal/conversations/conv-access/participants/other-user",
                    headers={"x-api-key": "chat-secret"},
                )
            assert missing.status_code == 401
            assert allowed.status_code == 204
            assert denied.status_code == 403
        finally:
            settings.chat_service_api_key = ""

    async def test_inbound_creates_message(self, app: FastAPI) -> None:
        async with session_factory() as session:
            repo = SqlAlchemyConversationRepository(session)
            from chat.conversation.models.domain.conversation import Conversation as ConvModel

            conv = ConvModel(
                id="conv-1",
                channel=ChannelType.WHATSAPP,
                external_address="+49123456789",
            )
            await repo.save(conv)
            await repo.add_participant("conv-1", "01920000-1000-7000-8000-000000000002")
            await repo.add_participant("conv-1", "phone-user")
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/internal/inbound-message",
                json={
                    "message_id": "evo-msg-123",
                    "channel": "WHATSAPP",
                    "user_id": "01920000-1000-7000-8000-000000000002",
                    "from_": "+49123456789",
                    "body": "Hello from phone!",
                    "content_type": "TEXT",
                    "conversation_id": None,
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["body"] == "Hello from phone!"
        assert data["sender_id"] == "whatsapp:+49123456789"
        assert data["delivery_status"] == "DELIVERED"
        assert data["channel"] == "WHATSAPP"

    async def test_inbound_rejects_unmatched_conversation(self, app: FastAPI) -> None:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/internal/inbound-message",
                json={
                    "message_id": "evo-msg-456",
                    "channel": "WHATSAPP",
                    "user_id": "01920000-1000-7000-8000-000000000011",
                    "from_": "+49999999999",
                    "body": "Hello?",
                    "content_type": "TEXT",
                    "conversation_id": None,
                },
            )

        assert resp.status_code == 422
        data = resp.json()
        assert "UNMATCHED_INBOUND_MESSAGE" in str(data)

    async def test_repeated_inbound_webhook_is_idempotent(self, app: FastAPI) -> None:
        async with session_factory() as session:
            repo = SqlAlchemyConversationRepository(session)
            from chat.conversation.models.domain.conversation import Conversation as ConvModel

            conversation = ConvModel(
                id="conv-idempotent",
                channel=ChannelType.WHATSAPP,
                external_address="+491701234567",
            )
            await repo.save(conversation)
            await repo.add_participant(conversation.id, "01920000-1000-7000-8000-000000000008")
            await session.commit()

        payload = {
            "message_id": "provider-idempotent-1",
            "channel": "WHATSAPP",
            "from_": "+491701234567",
            "body": "exactly once",
            "content_type": "TEXT",
        }
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post("/api/v1/internal/inbound-message", json=payload)
            second = await client.post("/api/v1/internal/inbound-message", json=payload)

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        assert first.json()["duplicate"] is False
        assert second.json()["duplicate"] is True

    async def test_delivery_status_rejects_regression(self, app: FastAPI) -> None:
        from chat.conversation.models.domain.communication_channel import CommunicationChannel
        from chat.db.repositories.message_repository import (
            SqlAlchemyMessageRepository,
        )
        from chat.message.models.domain.message import Message
        from chat.message.models.enums.message import DeliveryStatus, MessageContentType

        async with session_factory() as session:
            conversation_repo = SqlAlchemyConversationRepository(session)
            from chat.conversation.models.domain.conversation import Conversation as ConvModel

            conversation = ConvModel(id="conv-status", channel=ChannelType.WHATSAPP)
            await conversation_repo.save(conversation)
            message = Message(
                id="message-status",
                conversation_id=conversation.id,
                sender_id="01920000-1000-7000-8000-000000000008",
                body="status",
                content_type=MessageContentType.TEXT,
                channel=CommunicationChannel(type=ChannelType.WHATSAPP),
                delivery_status=DeliveryStatus.PENDING,
                provider_message_id="provider-status",
            )
            await SqlAlchemyMessageRepository(session).save(message)
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for status in ("SENT", "DELIVERED", "READ"):
                response = await client.post(
                    "/api/v1/internal/delivery-status",
                    json={"provider_message_id": "provider-status", "status": status},
                )
                assert response.status_code == 200
                assert response.json()["status"] == status

            regression = await client.post(
                "/api/v1/internal/delivery-status",
                json={"provider_message_id": "provider-status", "status": "SENT"},
            )

        assert regression.status_code == 409
        assert regression.json()["detail"]["code"] == "INVALID_STATUS_TRANSITION"

    async def test_inbound_requires_auth(self, app: FastAPI) -> None:
        expected = "test-secret"
        settings.communication_gateway_api_key = expected

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/internal/inbound-message",
                json={
                    "channel": "WHATSAPP",
                    "user_id": "01920000-1000-7000-8000-000000000008",
                    "from_": "+111",
                    "body": "test",
                },
                headers={"x-api-key": "wrong-key"},
            )

        assert resp.status_code == 401
        settings.communication_gateway_api_key = ""
