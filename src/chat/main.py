from __future__ import annotations

import errno
import socket
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from observability import (
    configure_observability,
    instrument_fastapi,
    shutdown_observability,
    uninstrument_fastapi,
)
from observability.metrics import ObservabilityMiddleware
from security import JwtValidator, SecurityMiddleware
from strawberry.fastapi import GraphQLRouter

from chat.api.graphql.context import GraphQLContext
from chat.api.graphql.schema import schema
from chat.api.health import router as health_router
from chat.api.health import run_health_checks
from chat.api.internal.inbound import router as inbound_router
from chat.api.internal.inbound import set_realtime
from chat.api.middleware import ContextBridgeMiddleware
from chat.application.services.conversation_service import ConversationService
from chat.application.services.message_dispatcher import MessageDispatcher
from chat.application.services.message_router import MessageRouter
from chat.application.services.message_service import MessageService
from chat.application.services.read_state_service import ReadStateService
from chat.banner import print_banner
from chat.config import settings, validate_production_settings
from chat.database import manager
from chat.domain.enums import ChannelType
from chat.infrastructure.adapters.default_delivery_policy import DefaultDeliveryPolicy
from chat.infrastructure.adapters.in_app_channel_adapter import InAppChannelAdapter
from chat.infrastructure.adapters.whatsapp_channel_adapter import WhatsAppChannelAdapter
from chat.infrastructure.db.repositories.conversation_repository import SqlAlchemyConversationRepository
from chat.infrastructure.db.repositories.message_repository import SqlAlchemyMessageRepository
from chat.infrastructure.db.repositories.read_state_repository import SqlAlchemyReadStateRepository
from chat.infrastructure.gateway.gateway_client import GatewayClient
from chat.infrastructure.realtime.valkey_event_bus import ValkeyEventBus

logger = __import__("structlog").get_logger(__name__)

realtime = ValkeyEventBus(settings.cache.url, password=settings.cache.password)
gateway_client = GatewayClient()
set_realtime(realtime)

in_app_adapter = InAppChannelAdapter(realtime)
whatsapp_adapter = WhatsAppChannelAdapter(gateway_client, realtime)

router = MessageRouter(
    {
        ChannelType.IN_APP: in_app_adapter,
        ChannelType.WHATSAPP: whatsapp_adapter,
    },
)

policy = DefaultDeliveryPolicy()
dispatcher = MessageDispatcher(policy, router)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    configure_observability(
        service_name=settings.core.service_name,
        otlp_endpoint=settings.observability.otlp_endpoint,
        environment=settings.core.environment,
        log_level=settings.core.log_level,
        tracing_enabled=settings.observability.tracing_enabled,
        sampling_probability=settings.observability.sampling_probability,
    )
    health = await run_health_checks()
    print_banner(settings, health)
    instrument_fastapi(app)

    validate_production_settings()
    logger.info("application_started")

    try:
        yield
    finally:
        logger.info("application_shutdown")
        uninstrument_fastapi(app)
        shutdown_observability()
        await gateway_client.close()
        await realtime.close()
        await manager.close()


def create_application() -> FastAPI:
    jwt_validator = JwtValidator(
        jwks_url=settings.keycloak.jwks_url,
        issuer=settings.keycloak.issuer,
        audience=settings.keycloak.audience or None,
    )

    app = FastAPI(title="Omnixys Chat", version="0.2.0", lifespan=lifespan)

    app.add_middleware(ObservabilityMiddleware)
    app.add_middleware(
        SecurityMiddleware,
        jwt_validator=jwt_validator,
        exclude_paths=[
            "/health", "/health/live", "/health/ready",
            "/health/liveness", "/health/readiness", "/api/v1/internal",
        ],
        internal_api_key=settings.core.internal_api_key,
    )
    app.add_middleware(ContextBridgeMiddleware)

    app.include_router(health_router)
    app.include_router(inbound_router)

    async def get_context() -> AsyncGenerator[GraphQLContext]:
        async with manager.session_scope() as session:
            conversation_repo = SqlAlchemyConversationRepository(session)
            message_repo = SqlAlchemyMessageRepository(session)
            read_state_repo = SqlAlchemyReadStateRepository(session)

            yield GraphQLContext(
                conversation_service=ConversationService(
                    session=session,
                    conversation_repo=conversation_repo,
                    message_repo=message_repo,
                    read_state_repo=read_state_repo,
                ),
                message_service=MessageService(
                    session=session,
                    conversation_repo=conversation_repo,
                    message_repo=message_repo,
                    read_state_repo=read_state_repo,
                    dispatcher=dispatcher,
                ),
                read_state_service=ReadStateService(
                    session=session,
                    conversation_repo=conversation_repo,
                    message_repo=message_repo,
                    read_state_repo=read_state_repo,
                ),
                realtime=realtime,
            )

    graphql_router = GraphQLRouter(
        schema,
        context_getter=get_context,
        subscription_protocols=["graphql-transport-ws"],
    )
    app.include_router(graphql_router, prefix="/graphql")

    return app


app = create_application()


def ensure_bind_available(host: str, port: int) -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((host, port))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            raise SystemExit(
                f"Chat cannot start: {host}:{port} is already in use. "
                "Set PORT or stop the conflicting process.",
            ) from None
        raise
    finally:
        probe.close()


def run() -> None:
    import asyncio

    import hypercorn.asyncio
    import hypercorn.config

    from chat.config import settings

    config = hypercorn.config.Config()
    config.bind = [f"{settings.core.host}:{settings.core.port}"]
    config.loglevel = settings.core.log_level.lower()
    config.use_reloader = settings.hot_reload

    ensure_bind_available(settings.core.host, settings.core.port)
    asyncio.run(hypercorn.asyncio.serve(app, config))  # type: ignore[arg-type]
