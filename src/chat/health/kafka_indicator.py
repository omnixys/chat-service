from __future__ import annotations

import asyncio
from typing import Any

from chat.config.settings import settings

logger = __import__("structlog").get_logger(__name__)


class KafkaIndicator:
    name = "kafka"

    @property
    def enabled(self) -> bool:
        return bool(settings.kafka.bootstrap_servers)

    async def check(self) -> dict[str, Any]:
        if not self.enabled:
            return {"status": "not_configured"}
        results: list[bool] = []
        for entry in settings.kafka.bootstrap_servers.split(","):
            host, _, port = entry.strip().partition(":")
            if not port:
                port = "9092"
            results.append(await self._tcp_reachable(host, port))
        if all(results):
            return {"status": "up"}
        return {"status": "down"}

    async def _tcp_reachable(self, host: str, port: str) -> bool:
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(host, int(port)),
                timeout=5.0,
            )
        except Exception as exc:
            logger.warning("health_check_failed", check=self.name, host=host, port=port, error=str(exc))
            return False
        else:
            writer.close()
            await writer.wait_closed()
            return True
