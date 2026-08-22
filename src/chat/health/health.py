from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Response, status

from chat.config.settings import settings
from chat.health.app_indicator import AppIndicator
from chat.health.cache_indicator import CacheIndicator
from chat.health.database_indicator import DatabaseIndicator
from chat.health.kafka_indicator import KafkaIndicator
from chat.health.keycloak_indicator import KeycloakIndicator

logger = __import__("structlog").get_logger(__name__)

router = APIRouter()

_live_indicators = [AppIndicator()]
_readiness_indicators = [
    AppIndicator(),
    DatabaseIndicator(),
    CacheIndicator(),
    KeycloakIndicator(),
    KafkaIndicator(),
]


async def _http_ping_check(name: str, url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            if resp.status_code < 500:
                return {name: {"status": "up"}}
            return {name: {"status": "down", "message": f"HTTP {resp.status_code}"}}
    except Exception as exc:
        logger.warning("health_check_failed", check=name, url=url, error=str(exc))
        return {name: {"status": "down", "message": str(exc)}}


async def _tempo_health(url: str) -> dict[str, Any]:
    try:
        return await _http_ping_check("tempo", url)
    except Exception:
        return {"tempo": {"status": "down", "message": "unreachable - non-blocking"}}


def _aggregate(details: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for d in details:
        merged.update(d)
    overall = "ok" if all(v.get("status") == "up" for v in merged.values()) else "error"
    return {"status": overall, "details": merged}


async def _run_checks(indicators: list[Any]) -> dict[str, Any]:
    details: list[dict[str, Any]] = []
    for indicator in indicators:
        if getattr(indicator, "enabled", True) is False:
            details.append({indicator.name: {"status": "not_configured"}})
            continue
        details.append({indicator.name: await indicator.check()})
    return _aggregate(details)


async def _run_readiness_checks() -> dict[str, Any]:
    details = await _run_checks(_readiness_indicators)
    if settings.communication_gateway_url:
        details["details"].update(await _http_ping_check("communication_gateway", settings.communication_gateway_url))
    if settings.observability.tempo_health_url:
        details["details"].update(await _tempo_health(settings.observability.tempo_health_url))
    else:
        details["details"]["tempo"] = {"status": "not_configured"}
    if settings.observability.prometheus_health_url:
        details["details"].update(await _http_ping_check("prometheus", settings.observability.prometheus_health_url))
    else:
        details["details"]["prometheus"] = {"status": "not_configured"}
    details["status"] = "ok" if all(v.get("status") == "up" for v in details["details"].values()) else "error"
    return details


async def run_health_checks() -> dict[str, Any]:
    return await _run_readiness_checks()


@router.get("/health/live")
async def health_live() -> dict[str, Any]:
    return await _run_checks(_live_indicators)


@router.get("/health/ready")
async def health_ready(response: Response) -> dict[str, Any]:
    result = await _run_readiness_checks()
    if result["status"] == "error":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result


@router.get("/health/liveness")
async def health_liveness() -> dict[str, Any]:
    return await health_live()


@router.get("/health/readiness")
async def health_readiness(response: Response) -> dict[str, Any]:
    return await health_ready(response)
