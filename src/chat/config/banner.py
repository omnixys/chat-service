from __future__ import annotations

import getpass
import platform
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

if TYPE_CHECKING:
    from chat.config.settings import ChatSettings


_GREEN = "\033[32m"
_CYAN = "\033[36m"
_YELLOW = "\033[33m"
_RED = "\033[31m"
_RESET = "\033[0m"

_ENV_COLORS = {
    "local": _GREEN,
    "development": _GREEN,
    "staging": _YELLOW,
    "production": _RED,
}


def _mask_url(url: str, *, mask_password: bool = True) -> str:
    if not mask_password:
        return url
    try:
        parsed = urlparse(url)
        if parsed.password:
            return url.replace(parsed.password, "****")
    except Exception:
        pass
    return url


def _mask_secret(value: str, *, mask: bool = False) -> str:
    if mask and value:
        return "****"
    return value or "—"


def _enabled(value: bool) -> str:
    if value:
        return f"{_GREEN}ENABLED{_RESET}"
    return f"{_RED}DISABLED{_RESET}"


def _info(label: str, value: str) -> None:
    print(f"  {_CYAN}{label}:{_RESET} {_YELLOW}{value}{_RESET}")  # noqa: T201


def _section(title: str) -> None:
    width = 51
    inner = width - 2
    padding = inner - len(title)
    left = padding // 2
    right = padding - left
    print(f"{_GREEN}{'=' * left}{title}{'=' * right}{_RESET}")  # noqa: T201


def print_banner(settings: ChatSettings, health: dict[str, Any] | None = None) -> None:
    name = settings.core.service_name.upper()
    is_prod = settings.core.is_production

    banner = f"""
{_GREEN}  ╔══════════════════════════════════════════════════╗
  ║{_CYAN}{name:^48}{_GREEN}  ║
  ║{_YELLOW}{"Omnixys Technologies":^48}{_GREEN}  ║
  ╚══════════════════════════════════════════════════╝{_RESET}"""
    print(banner)  # noqa: T201

    _section("APPLICATION")
    _info("Name", name)
    _info("Python", platform.python_version())
    env_color = _ENV_COLORS.get(settings.core.environment.lower(), _YELLOW)
    _info("Environment", f"{env_color}{settings.core.environment.upper()}{_RESET}")
    _info("Host", settings.core.host)
    _info("Port", str(settings.core.port))
    _info("OS", f"{platform.system()} ({platform.release()})")
    _info("User", getpass.getuser())
    _info("Hot Reload", _enabled(settings.hot_reload))

    _section("LOGGER")
    _info("Log Level", settings.core.log_level)

    _section("KEYCLOAK")
    _info("URL", settings.keycloak.url)
    _info("Realm", settings.keycloak.realm)
    _info("Client ID", settings.keycloak.client_id)
    _info("Client Secret", _mask_secret(settings.keycloak.client_secret, mask=is_prod))
    _info("Audience", settings.keycloak.audience)

    _section("DATABASE")
    _info("URL", _mask_url(settings.database.url, mask_password=is_prod))
    _info("Pool Size", str(settings.database.pool_size))
    _info("Max Overflow", str(settings.database.max_overflow))
    _info("Echo", _enabled(settings.database.echo))

    _section("SECURITY")
    _info("Stateless", _enabled(settings.security.stateless))
    _info("CORS Origins", ", ".join(settings.security.cors_allowed_origins) or "—")
    if settings.security.rate_limit.enabled:
        _info("Rate Limit", f"{settings.security.rate_limit.default_limit}/min")
    else:
        _info("Rate Limit", "DISABLED")
    _info("Cookie Secure", str(settings.security.cookie_secure))

    _section("VALKEY")
    _info("URL", _mask_url(settings.cache.url))
    _info("Key Prefix", settings.cache.key_prefix)
    _info("Invalidation", _enabled(settings.cache.invalidation_enabled))

    _section("KAFKA")
    _info("Bootstrap Servers", settings.kafka.bootstrap_servers)
    _info("Client ID", settings.kafka.client_id)
    _info("Group ID", settings.kafka.group_id)
    _info("ACKs", settings.kafka.acks)
    _info("DLQ", _enabled(settings.kafka.dlq_enabled))

    _section("OBSERVABILITY")
    _info("Tracing", _enabled(settings.observability.tracing_enabled))
    _info("Metrics", _enabled(settings.observability.metrics_enabled))
    _info("Sampling", str(settings.observability.sampling_probability))
    _info("OTLP Endpoint", settings.observability.otlp_endpoint)
    _info("Tempo Health", settings.observability.tempo_health_url or "—")
    _info("Prometheus Health", settings.observability.prometheus_health_url or "—")

    _section("STORAGE")
    _info("Endpoint", settings.storage.endpoint)
    _info("Region", settings.storage.region)
    _info("Bucket", settings.storage.bucket)
    _info("Public URL", settings.storage.public_url or "—")

    _section("COMMUNICATION GATEWAY")
    _info("URL", settings.communication_gateway_url)

    if health:
        _section("HEALTH")
        for check_name, check in health.get("details", {}).items():
            st = check.get("status", "unknown")
            color = _GREEN if st == "up" else _RED if st in ("down", "error") else _YELLOW
            latency = check.get("latencyMs")
            suffix = f" ({latency}ms)" if latency is not None else ""
            _info(check_name.upper(), f"{color}{st.upper()}{_RESET}{suffix}")

    print(f"{_GREEN}{'=' * 51}{_RESET}\n")  # noqa: T201
