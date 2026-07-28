from __future__ import annotations

from typing import Any

from observability.request_context import (
    RequestContext as ObservabilityRequestContext,
)
from observability.request_context import (
    set_request_context as set_observability_context,
)
from security.request_context import (
    current_request_context as get_security_context,
)


class ContextBridgeMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] == "http":
            security_ctx = get_security_context()
            if security_ctx is not None:
                obs_ctx = ObservabilityRequestContext(
                    user_id=security_ctx.user_id,
                    organization_id=security_ctx.organization_id,
                    roles=security_ctx.roles,
                    scope=security_ctx.scopes,
                    correlation_id=security_ctx.correlation_id,
                    request_id=security_ctx.request_id,
                    is_authenticated=security_ctx.is_authenticated,
                )
                set_observability_context(obs_ctx)
        await self.app(scope, receive, send)
