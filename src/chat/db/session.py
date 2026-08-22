from collections.abc import AsyncGenerator

from database import DatabaseSessionManager
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config.settings import settings

manager = DatabaseSessionManager(
    url=settings.database.url,
    echo=settings.database.echo,
    pool_size=settings.database.pool_size,
    max_overflow=settings.database.max_overflow,
)


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with manager.session_scope() as session:
        yield session
