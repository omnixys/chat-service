import json
from collections.abc import Generator
from typing import Any

import pytest
from security.request_context import RequestContext, reset_request_context, set_request_context
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.application.services.conversation_service import ConversationService
from chat.infrastructure.analytics.outbox import AnalyticsFactWriter, AnalyticsOutboxPublisher
from chat.infrastructure.db.models import AnalyticsOutboxModel, ConversationModel

TENANT_ID = "11111111-1111-4111-8111-111111111111"


class FakeProducer:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    async def publish_raw(
        self,
        topic: str,
        value: bytes,
        key: str | None = None,
        headers: list[tuple[str, bytes]] | None = None,
    ) -> None:
        self.records.append(
            {
                "topic": topic,
                "value": json.loads(value),
                "key": key,
                "headers": dict(headers or []),
            },
        )


@pytest.fixture(autouse=True)
def _verified_context() -> Generator[None]:
    set_request_context(
        RequestContext(
            user_id="user-1",
            organization_id=TENANT_ID,
            correlation_id="correlation-1",
            is_authenticated=True,
        ),
    )
    yield
    reset_request_context()


async def test_conversation_and_fact_are_committed_atomically(
    session: AsyncSession,
    conversation_repo: ConversationRepository,
    message_repo: MessageRepository,
    read_state_repo: ReadStateRepository,
) -> None:
    service = ConversationService(
        session,
        conversation_repo,
        message_repo,
        read_state_repo,
        AnalyticsFactWriter(session),
    )

    conversation = await service.create_direct_conversation("user-1", "user-2")

    stored = await session.scalar(
        select(AnalyticsOutboxModel).where(
            AnalyticsOutboxModel.topic == "chat.conversation.created.v1",
        ),
    )
    assert stored is not None
    assert stored.tenant_id == TENANT_ID
    assert stored.payload["eventName"] == "ConversationCreated"
    assert stored.payload["aggregateId"] == conversation.id


async def test_writer_failure_rolls_back_conversation_and_outbox(
    session: AsyncSession,
    conversation_repo: ConversationRepository,
    message_repo: MessageRepository,
    read_state_repo: ReadStateRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    writer = AnalyticsFactWriter(session)

    async def fail_enqueue(**_kwargs: object) -> str:
        raise RuntimeError("outbox unavailable")

    monkeypatch.setattr(writer, "enqueue", fail_enqueue)
    service = ConversationService(
        session,
        conversation_repo,
        message_repo,
        read_state_repo,
        writer,
    )

    with pytest.raises(RuntimeError, match="outbox unavailable"):
        await service.create_direct_conversation("user-1", "user-3")
    await session.rollback()

    assert await session.scalar(select(func.count(ConversationModel.id))) == 0
    assert await session.scalar(select(func.count(AnalyticsOutboxModel.id))) == 0


async def test_publisher_retries_by_event_id_without_duplicate_processing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    event_id = await AnalyticsFactWriter(session).enqueue(
        topic="chat.message.sent.v1",
        event_name="MessageSent",
        aggregate_id="message-1",
        aggregate_type="message",
        subject_id="user-1",
        properties={"channel": "IN_APP", "contentType": "TEXT"},
    )
    await session.commit()
    producer = FakeProducer()
    publisher = AnalyticsOutboxPublisher(session_factory, producer)

    assert await publisher.process_batch() == 1
    assert await publisher.process_batch() == 0
    assert len(producer.records) == 1
    assert producer.records[0]["key"] == event_id
    assert producer.records[0]["value"]["eventId"] == event_id
    assert producer.records[0]["headers"]["x-tenant-id"] == TENANT_ID.encode()


async def test_sensitive_message_content_is_rejected(session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="Sensitive analytics property"):
        await AnalyticsFactWriter(session).enqueue(
            topic="chat.message.sent.v1",
            event_name="MessageSent",
            aggregate_id="message-1",
            aggregate_type="message",
            properties={"body": "must never leave chat"},
        )
