from __future__ import annotations

from pathlib import Path

from config.settings import AppSettings, CoreSettings
from pydantic_settings import SettingsConfigDict

_CHAT_PKG_DIR = Path(__file__).resolve().parents[3]


class ChatCoreSettings(CoreSettings):
    internal_api_key: str = ""


class ChatSettings(AppSettings):
    model_config = SettingsConfigDict(env_file=str(_CHAT_PKG_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")
    core: ChatCoreSettings = ChatCoreSettings()

    communication_gateway_url: str = "http://localhost:8002"
    communication_gateway_api_key: str = ""
    communication_gateway_timeout: int = 30
    chat_service_api_key: str = ""

    auth_enabled: bool = True


settings = ChatSettings()


def validate_production_settings() -> None:
    import os

    environment = os.getenv("ENVIRONMENT")
    if not environment:
        raise RuntimeError("Missing required env: ENVIRONMENT")
    if environment.lower() not in {"production", "development", "staging"}:
        return
    required = {
        "CHAT_SERVICE_API_KEY": settings.chat_service_api_key,
        "COMMUNICATION_GATEWAY_API_KEY": settings.communication_gateway_api_key,
        "COMMUNICATION_GATEWAY_URL": settings.communication_gateway_url,
        "DATABASE_URL": settings.database.url,
        "KEYCLOAK_URL": settings.keycloak.url if settings.auth_enabled else "",
        "KEYCLOAK_CLIENT_SECRET": settings.keycloak.client_secret if settings.auth_enabled else "",
        "CACHE_URL": settings.cache.url,
        "CACHE_PASSWORD": settings.cache.password,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        __import__("structlog").get_logger(__name__).error("missing_production_settings", settings=missing)
        raise RuntimeError(f"Missing required production settings: {', '.join(missing)}")
