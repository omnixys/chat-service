from collections.abc import AsyncGenerator

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from chat.adapter.channels.default_delivery_policy import DefaultDeliveryPolicy
from chat.adapter.channels.in_app_channel_adapter import InAppChannelAdapter
from chat.adapter.realtime.in_memory_event_bus import InMemoryEventBus
from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.read_state_repository import ReadStateRepository
from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.conversation.models.enums.conversation import ChannelType
from chat.conversation.services.conversation_read_service import ConversationReadService
from chat.conversation.services.conversation_write_service import ConversationWriteService
from chat.db.models import Base
from chat.db.repositories.conversation_repository import (
    SqlAlchemyConversationRepository,
)
from chat.db.repositories.message_repository import (
    SqlAlchemyMessageRepository,
)
from chat.db.repositories.read_state_repository import (
    SqlAlchemyReadStateRepository,
)
from chat.message.services.message_dispatcher import MessageDispatcher
from chat.message.services.message_read_service import MessageReadService
from chat.message.services.message_router import MessageRouter
from chat.message.services.message_write_service import MessageWriteService

TEST_DATABASE_URL = "sqlite+aiosqlite://"

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def _create_tables() -> AsyncGenerator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def session() -> AsyncGenerator[AsyncSession]:
    async with session_factory() as s:
        yield s
        await s.rollback()


@pytest_asyncio.fixture(name="session_factory")
async def session_factory_fixture() -> async_sessionmaker[AsyncSession]:
    return session_factory


@pytest_asyncio.fixture
async def conversation_repo(session: AsyncSession) -> ConversationRepository:
    return SqlAlchemyConversationRepository(session)


@pytest_asyncio.fixture
async def message_repo(session: AsyncSession) -> MessageRepository:
    return SqlAlchemyMessageRepository(session)


@pytest_asyncio.fixture
async def read_state_repo(session: AsyncSession) -> ReadStateRepository:
    return SqlAlchemyReadStateRepository(session)


@pytest_asyncio.fixture
async def realtime() -> RealtimePublisher:
    return InMemoryEventBus()


@pytest_asyncio.fixture
async def dispatcher(realtime: RealtimePublisher) -> MessageDispatcher:
    in_app_adapter = InAppChannelAdapter(realtime)
    router = MessageRouter(
        {
            ChannelType.IN_APP: in_app_adapter,
        },
    )
    policy = DefaultDeliveryPolicy()
    return MessageDispatcher(policy, router)


@pytest_asyncio.fixture
async def conversation_read_service(
    session: AsyncSession,
    conversation_repo: ConversationRepository,
    message_repo: MessageRepository,
    read_state_repo: ReadStateRepository,
) -> ConversationReadService:
    return ConversationReadService(session, conversation_repo, message_repo, read_state_repo)


@pytest_asyncio.fixture
async def conversation_write_service(
    session: AsyncSession,
    conversation_repo: ConversationRepository,
) -> ConversationWriteService:
    return ConversationWriteService(session, conversation_repo)


@pytest_asyncio.fixture
async def message_read_service(
    session: AsyncSession,
    conversation_repo: ConversationRepository,
    message_repo: MessageRepository,
) -> MessageReadService:
    return MessageReadService(session, conversation_repo, message_repo)


@pytest_asyncio.fixture
async def message_write_service(
    session: AsyncSession,
    conversation_repo: ConversationRepository,
    message_repo: MessageRepository,
    read_state_repo: ReadStateRepository,
    dispatcher: MessageDispatcher,
) -> MessageWriteService:
    return MessageWriteService(
        session,
        conversation_repo,
        message_repo,
        read_state_repo,
        dispatcher,
    )
