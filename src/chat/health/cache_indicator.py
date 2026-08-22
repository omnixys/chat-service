from __future__ import annotations

import time
from typing import Any

from cache import CacheClient

from chat.config.settings import settings

logger = __import__("structlog").get_logger(__name__)


class CacheIndicator:
    name = "cache"

    async def check(self) -> dict[str, Any]:
        cache = CacheClient(url=settings.cache.url, password=settings.cache.password)
        started = time.monotonic()
        try:
            healthy = await cache.ping()
            return {"status": "up" if healthy else "down", "healthy": healthy, "latencyMs": _elapsed_ms(started)}
        except Exception as exc:
            logger.warning("health_check_failed", check=self.name, error=str(exc))
            return {"status": "down", "healthy": False, "latencyMs": _elapsed_ms(started), "message": str(exc)}
        finally:
            await cache.close()


def _elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
