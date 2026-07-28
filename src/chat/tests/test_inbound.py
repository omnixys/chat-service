from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from chat.api.internal.inbound import router as inbound_router
from chat.api.internal.inbound import set_realtime
from chat.application.services.conversation_service import ConversationService
from chat.config import settings
from chat.database import get_db
from chat.domain.enums import ChannelType
from chat.infrastructure.db.models import Base
from chat.infrastructure.db.repositories.conversation_repository import (
    SqlAlchemyConversationRepository,
)
from chat.infrastructure.realtime.in_memory_event_bus import InMemoryEventBus

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
        owner_id = "keycloak-sub-owner"
        async with session_factory() as session:
            conversation_repo = SqlAlchemyConversationRepository(session)
            from chat.infrastructure.db.repositories.message_repository import (
                SqlAlchemyMessageRepository,
            )
            from chat.infrastructure.db.repositories.read_state_repository import (
                SqlAlchemyReadStateRepository,
            )

            service = ConversationService(
                session,
                conversation_repo,
                SqlAlchemyMessageRepository(session),
                SqlAlchemyReadStateRepository(session),
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
            from chat.domain.models.conversation import Conversation as ConvModel

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
            from chat.domain.models.conversation import Conversation as ConvModel

            conv = ConvModel(
                id="conv-1",
                channel=ChannelType.WHATSAPP,
                external_address="+49123456789",
            )
            await repo.save(conv)
            await repo.add_participant("conv-1", "rachel")
            await repo.add_participant("conv-1", "phone-user")
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/internal/inbound-message",
                json={
                    "message_id": "evo-msg-123",
                    "channel": "WHATSAPP",
                    "user_id": "rachel",
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
                    "user_id": "unknown-user",
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
            from chat.domain.models.conversation import Conversation as ConvModel

            conversation = ConvModel(
                id="conv-idempotent",
                channel=ChannelType.WHATSAPP,
                external_address="+491701234567",
            )
            await repo.save(conversation)
            await repo.add_participant(conversation.id, "user-1")
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
        from chat.domain.enums import DeliveryStatus, MessageContentType
        from chat.domain.models.communication_channel import CommunicationChannel
        from chat.domain.models.message import Message
        from chat.infrastructure.db.repositories.message_repository import (
            SqlAlchemyMessageRepository,
        )

        async with session_factory() as session:
            conversation_repo = SqlAlchemyConversationRepository(session)
            from chat.domain.models.conversation import Conversation as ConvModel

            conversation = ConvModel(id="conv-status", channel=ChannelType.WHATSAPP)
            await conversation_repo.save(conversation)
            message = Message(
                id="message-status",
                conversation_id=conversation.id,
                sender_id="user-1",
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
                    "user_id": "user-1",
                    "from_": "+111",
                    "body": "test",
                },
                headers={"x-api-key": "wrong-key"},
            )

        assert resp.status_code == 401
        settings.communication_gateway_api_key = ""
