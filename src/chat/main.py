from __future__ import annotations

import errno
import socket

from chat.app import app

logger = __import__("structlog").get_logger(__name__)


def ensure_bind_available(host: str, port: int) -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((host, port))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            logger.critical("port_in_use", host=host, port=port)
            raise SystemExit(
                f"Chat cannot start: {host}:{port} is already in use. Set PORT or stop the conflicting process.",
            ) from None
        raise
    finally:
        probe.close()


def run() -> None:
    import asyncio

    import hypercorn.asyncio
    import hypercorn.config

    from chat.config.settings import settings

    config = hypercorn.config.Config()
    config.bind = [f"{settings.core.host}:{settings.core.port}"]
    config.loglevel = settings.core.log_level.lower()
    config.use_reloader = settings.hot_reload

    ensure_bind_available(settings.core.host, settings.core.port)
    asyncio.run(hypercorn.asyncio.serve(app, config))  # type: ignore[arg-type]
