from __future__ import annotations

from typing import Any

_CSP = (
    "default-src 'self' https:; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; "
    "img-src 'self' data:"
)
_HSTS = "max-age=31536000"


class SecurityHeaderMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_secure = scope.get("scheme") in {"https", "wss"}

        async def send_wrapper(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                self._set_if_absent(headers, b"content-security-policy", _CSP.encode())
                if is_secure:
                    self._set_if_absent(headers, b"strict-transport-security", _HSTS.encode())
                self._set_if_absent(headers, b"x-content-type-options", b"nosniff")
                self._set_if_absent(headers, b"x-frame-options", b"SAMEORIGIN")
                self._set_if_absent(headers, b"x-powered-by", b"Omnixys")
            await send(message)

        await self.app(scope, receive, send_wrapper)

    @staticmethod
    def _set_if_absent(headers: list[tuple[bytes, bytes]], name: bytes, value: bytes) -> None:
        if not any(existing.lower() == name for existing, _ in headers):
            headers.append((name, value))
