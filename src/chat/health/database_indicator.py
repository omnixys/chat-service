from __future__ import annotations

import time
from typing import Any

from sqlalchemy import text

from chat.db.session import manager

logger = __import__("structlog").get_logger(__name__)


class DatabaseIndicator:
    name = "postgres"

    async def check(self) -> dict[str, Any]:
        started = time.monotonic()
        try:
            async with manager.session_scope() as session:
                await session.execute(text("SELECT 1"))
            return {"status": "up", "latencyMs": _elapsed_ms(started)}
        except Exception as exc:
            logger.warning("health_check_failed", check=self.name, error=str(exc))
            return {"status": "down", "message": str(exc), "latencyMs": _elapsed_ms(started)}


def _elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
