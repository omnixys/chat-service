from collections.abc import Mapping

from chat.security.http.auth import _token_from_connection


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
