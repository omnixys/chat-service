from __future__ import annotations

from typing import Any

import httpx

from chat.config.settings import settings

logger = __import__("structlog").get_logger(__name__)


class KeycloakIndicator:
    name = "keycloak"

    @property
    def enabled(self) -> bool:
        return bool(settings.keycloak.url)

    async def check(self) -> dict[str, Any]:
        if not self.enabled:
            return {"status": "not_configured"}
        url = f"{settings.keycloak.url.rstrip('/')}/.well-known/openid-configuration"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
        except Exception as exc:
            logger.warning("health_check_failed", check=self.name, url=url, error=str(exc))
            return {"status": "down", "message": str(exc)}
        else:
            if resp.status_code < 500:
                return {"status": "up"}
            return {"status": "down", "message": f"HTTP {resp.status_code}"}
