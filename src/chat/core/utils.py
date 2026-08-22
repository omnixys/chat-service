from datetime import UTC, datetime
from uuid import uuid7


def generate_uuid() -> str:
    return str(uuid7())


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
