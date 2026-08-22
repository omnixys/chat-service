from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Protocol
from uuid import UUID, uuid4

from security import current_request_context
from sqlalchemy import or_, select

from chat.db.models import AnalyticsOutboxModel

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logger = __import__("structlog").get_logger(__name__)

_SENSITIVE_KEYS = {
    "accesstoken",
    "body",
    "email",
    "invitationlink",
    "message",
    "password",
    "phonenumber",
    "qrdata",
    "refreshtoken",
    "token",
}


class RawKafkaPublisher(Protocol):
    async def publish_raw(
        self,
        topic: str,
        value: bytes,
        key: str | None = None,
        headers: list[tuple[str, bytes]] | None = None,
    ) -> None: ...


def _assert_safe_properties(value: object, path: str = "properties") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.replace("_", "").replace("-", "").lower()
            if normalized in _SENSITIVE_KEYS:
                raise ValueError(f"Sensitive analytics property is not allowed: {path}.{key}")
            _assert_safe_properties(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_safe_properties(child, f"{path}[{index}]")


class AnalyticsFactWriter:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def enqueue(  # noqa: PLR0913
        self,
        *,
        topic: str,
        event_name: str,
        aggregate_id: str,
        aggregate_type: str,
        properties: dict[str, Any],
        subject_id: str | None = None,
    ) -> str:
        context = current_request_context()
        tenant_id = context.tenant_id
        if not context.is_authenticated or tenant_id is None:
            raise ValueError("Verified organization context is required for analytics facts")
        try:
            UUID(tenant_id)
        except ValueError as exc:
            raise ValueError("Verified organization context must contain a UUID") from exc

        _assert_safe_properties(properties)
        event_id = str(uuid4())
        payload: dict[str, object] = {
            "producer": "chat",
            "eventName": event_name,
            "aggregateId": aggregate_id,
            "aggregateType": aggregate_type,
            "properties": properties,
            "occurredAt": datetime.now(UTC).isoformat(),
        }
        if subject_id is not None:
            payload["subjectId"] = subject_id
        self._session.add(
            AnalyticsOutboxModel(
                id=event_id,
                tenant_id=tenant_id,
                topic=topic,
                payload=payload,
                correlation_id=context.correlation_id,
                actor_id=context.user_id,
            ),
        )
        await self._session.flush()
        return event_id


class AnalyticsOutboxPublisher:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        producer: RawKafkaPublisher,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._producer = producer
        self._instance_id = str(uuid4())
        self._clock = clock or (lambda: datetime.now(UTC))

    async def process_batch(self, *, limit: int = 50) -> int:
        ids = await self._claim(limit)
        published = 0
        for event_id in ids:
            if await self._publish(event_id):
                published += 1
        return published

    async def _claim(self, limit: int) -> list[str]:
        now = self._clock()
        stale = now - timedelta(minutes=1)
        async with self._session_factory() as session, session.begin():
            result = await session.execute(
                select(AnalyticsOutboxModel)
                .where(
                    AnalyticsOutboxModel.published_at.is_(None),
                    AnalyticsOutboxModel.dead_lettered_at.is_(None),
                    AnalyticsOutboxModel.next_attempt_at <= now,
                    or_(
                        AnalyticsOutboxModel.locked_at.is_(None),
                        AnalyticsOutboxModel.locked_at < stale,
                    ),
                )
                .order_by(AnalyticsOutboxModel.created_at.asc())
                .limit(limit)
                .with_for_update(skip_locked=True),
            )
            records = list(result.scalars().all())
            for record in records:
                record.locked_at = now
                record.locked_by = self._instance_id
            return [record.id for record in records]

    async def _publish(self, event_id: str) -> bool:
        async with self._session_factory() as session:
            record = await session.get(AnalyticsOutboxModel, event_id)
            if record is None or record.locked_by != self._instance_id:
                return False
            envelope = {
                "eventId": record.id,
                "eventName": record.topic,
                "eventType": "EVENT",
                "eventVersion": "1",
                "service": "chat",
                "timestamp": record.created_at.isoformat(),
                "payload": record.payload,
            }
            headers = [
                ("x-tenant-id", record.tenant_id.encode()),
                ("x-event-id", record.id.encode()),
                ("x-event-version", b"1"),
                ("x-event-type", b"EVENT"),
                ("x-service", b"chat"),
            ]
            if record.correlation_id:
                headers.append(("x-correlation-id", record.correlation_id.encode()))
            if record.actor_id:
                headers.append(("x-actor-id", record.actor_id.encode()))
            try:
                await self._producer.publish_raw(
                    topic=record.topic,
                    value=json.dumps(envelope, separators=(",", ":")).encode(),
                    key=record.id,
                    headers=headers,
                )
            except Exception as exc:
                record.attempts += 1
                record.locked_at = None
                record.locked_by = None
                record.last_error = str(exc)[:4000]
                if record.attempts >= 10:
                    record.dead_lettered_at = self._clock()
                else:
                    delay = min(300, 2**record.attempts)
                    record.next_attempt_at = self._clock() + timedelta(seconds=delay)
                await session.commit()
                logger.exception("analytics_outbox_publish_failed", event_id=record.id)
                return False
            else:
                record.published_at = self._clock()
                record.locked_at = None
                record.locked_by = None
                record.last_error = None
                await session.commit()
                return True
