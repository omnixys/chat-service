from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request, WebSocket, status
from security import JwtValidator

from chat.config import settings

logger = __import__("structlog").get_logger(__name__)


@dataclass(frozen=True)
class Principal:
    user_id: str
    username: str = ""


_jwt_validator: JwtValidator | None = None


def _get_jwt_validator() -> JwtValidator:
    global _jwt_validator
    if _jwt_validator is None:
        _jwt_validator = JwtValidator(
            jwks_url=settings.keycloak.jwks_url,
            issuer=settings.keycloak.issuer,
            audience=settings.keycloak.audience or None,
        )
    return _jwt_validator


def _token_from_connection(
    connection: Request | WebSocket,
    connection_params: object | None = None,
) -> str:
    authorization = connection.headers.get("authorization", "")
    if isinstance(connection_params, dict):
        authorization = str(
            connection_params.get("Authorization") or connection_params.get("authorization") or authorization,
        )
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    if isinstance(connection_params, dict):
        token = connection_params.get("accessToken") or connection_params.get("token")
        if isinstance(token, str) and token:
            return token.removeprefix("Bearer ").strip()
    return connection.cookies.get("access_token", "")


async def authenticate_connection(
    connection: Request | WebSocket,
    connection_params: object | None = None,
) -> Principal:
    if not settings.auth_enabled:
        user_id = connection.headers.get("x-test-user-id", "test-user")
        return Principal(user_id=user_id, username=user_id)

    token = _token_from_connection(connection, connection_params)
    if not token:
        logger.warning("auth_missing_token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
        )

    try:
        claims = await _get_jwt_validator().validate(token)
    except ValueError as exc:
        logger.warning("auth_invalid_token", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid access token",
        ) from exc

    user_id = claims.sub or ""
    if not user_id:
        logger.warning("auth_missing_subject")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token subject missing",
        )
    logger.debug("auth_success", user_id=user_id)
    return Principal(user_id=user_id, username=claims.preferred_username or "")
