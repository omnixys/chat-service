from __future__ import annotations

import pytest

import chat.config.settings as settings_module
from chat.config.settings import validate_production_settings


class _StubDatabase:
    url: str = ""


class _StubKeycloak:
    url: str = ""
    client_secret: str = ""


class _StubCache:
    url: str = ""
    password: str = ""


class _StubSettings:
    auth_enabled: bool = True
    chat_service_api_key: str = ""
    communication_gateway_api_key: str = ""
    communication_gateway_url: str = ""
    database: _StubDatabase = _StubDatabase()
    keycloak: _StubKeycloak = _StubKeycloak()
    cache: _StubCache = _StubCache()


def _force_empty_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings_module, "settings", _StubSettings())


def test_missing_environment_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with pytest.raises(RuntimeError, match="Missing required env: ENVIRONMENT"):
        validate_production_settings()


def test_development_and_staging_enforce_required_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_empty_settings(monkeypatch)
    for environment in ("development", "staging"):
        monkeypatch.setenv("ENVIRONMENT", environment)
        with pytest.raises(RuntimeError, match="Missing required production settings"):
            validate_production_settings()


def test_other_environments_skip_required_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_empty_settings(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "test")
    validate_production_settings()
