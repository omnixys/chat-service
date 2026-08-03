from __future__ import annotations

import time
from typing import Any

import httpx
from cache import CacheClient
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from chat.config import settings
from chat.database import manager

logger = __import__("structlog").get_logger(__name__)

router = APIRouter()


def _app_check() -> dict[str, Any]:
    return {"app": {"status": "up"}}


async def _postgres_check() -> dict[str, Any]:
    started = time.monotonic()
    try:
        async with manager.session_scope() as session:
            await session.execute(text("SELECT 1"))
        return {"postgres": {"status": "up", "latencyMs": _elapsed_ms(started)}}
    except Exception as exc:
        logger.warning("health_check_failed", check="postgres", error=str(exc))
        return {"postgres": {"status": "down", "message": str(exc), "latencyMs": _elapsed_ms(started)}}


async def _cache_check() -> dict[str, Any]:
    cache = CacheClient(url=settings.cache.url, password=settings.cache.password)
    started = time.monotonic()
    try:
        healthy = await cache.ping()
        return {"cache": {"status": "up" if healthy else "down", "healthy": healthy, "latencyMs": _elapsed_ms(started)}}
    except Exception as exc:
        logger.warning("health_check_failed", check="cache", error=str(exc))
        return {"cache": {"status": "down", "healthy": False, "latencyMs": _elapsed_ms(started), "message": str(exc)}}
    finally:
        await cache.close()


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


def _elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def _aggregate(details: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for d in details:
        merged.update(d)
    overall = "ok" if all(v.get("status") == "up" for v in merged.values()) else "error"
    return {"status": overall, "details": merged}


async def _run_readiness_checks() -> dict[str, Any]:
    checks: list[dict[str, Any]] = [
        _app_check(),
        await _postgres_check(),
        await _cache_check(),
    ]
    if settings.keycloak.url:
        checks.append(await _http_ping_check("keycloak", settings.keycloak.url))
    if settings.communication_gateway_url:
        checks.append(await _http_ping_check("communication_gateway", settings.communication_gateway_url))
    if settings.observability.tempo_health_url:
        checks.append(await _tempo_health(settings.observability.tempo_health_url))
    else:
        checks.append({"tempo": {"status": "not_configured"}})
    if settings.observability.prometheus_health_url:
        checks.append(await _http_ping_check("prometheus", settings.observability.prometheus_health_url))
    else:
        checks.append({"prometheus": {"status": "not_configured"}})
    return _aggregate(checks)


async def run_health_checks() -> dict[str, Any]:
    return await _run_readiness_checks()


@router.get("/health/liveness")
async def health_liveness() -> dict[str, Any]:
    return _aggregate([_app_check()])


@router.get("/health/readiness")
async def health_readiness(response: Response) -> dict[str, Any]:
    result = await _run_readiness_checks()
    if result["status"] == "error":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
