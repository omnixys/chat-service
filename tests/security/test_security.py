from collections.abc import Mapping
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from chat.security.http import auth
from chat.security.http.auth import Principal, _token_from_connection, authenticate_connection


class FakeConnection:
    def __init__(self, headers: Mapping[str, str] | None = None, cookies: Mapping[str, str] | None = None) -> None:
        self.headers = headers or {}
        self.cookies = cookies or {}


def test_http_bearer_token_is_supported() -> None:
    connection = FakeConnection(headers={"authorization": "Bearer http-token"})
    assert _token_from_connection(connection) == "http-token"  # type: ignore[arg-type]


def test_access_token_cookie_is_supported() -> None:
    connection = FakeConnection(cookies={"access_token": "cookie-token"})
    assert _token_from_connection(connection) == "cookie-token"  # type: ignore[arg-type]


def test_graphql_transport_ws_connection_params_are_supported() -> None:
    connection = FakeConnection()
    assert (
        _token_from_connection(
            connection,  # type: ignore[arg-type]
            {"Authorization": "Bearer websocket-token"},
        )
        == "websocket-token"
    )


class FakeClaims:
    user_id: str | None
    preferred_username: str | None

    def __init__(self, user_id: str | None, preferred_username: str | None = None) -> None:
        self.user_id = user_id
        self.preferred_username = preferred_username


class FakeValidator:
    def __init__(self, claims: FakeClaims) -> None:
        self._claims = claims

    async def validate(self, _token: str) -> FakeClaims:
        return self._claims


async def test_authenticate_connection_resolves_internal_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth,
        "_get_jwt_validator",
        lambda: FakeValidator(FakeClaims("01920000-1000-7000-8000-000000000008", "jdoe")),
    )
    monkeypatch.setattr("chat.security.http.auth.settings", SimpleNamespace(auth_enabled=True))

    principal = await authenticate_connection(FakeConnection(headers={"authorization": "Bearer t"}))  # type: ignore[arg-type]

    assert principal == Principal(user_id="01920000-1000-7000-8000-000000000008", username="jdoe")


async def test_authenticate_connection_fails_closed_without_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "_get_jwt_validator", lambda: FakeValidator(FakeClaims(None, "jdoe")))
    monkeypatch.setattr("chat.security.http.auth.settings", SimpleNamespace(auth_enabled=True))

    with pytest.raises(HTTPException) as excinfo:
        await authenticate_connection(FakeConnection(headers={"authorization": "Bearer t"}))  # type: ignore[arg-type]

    assert excinfo.value.status_code == 401
