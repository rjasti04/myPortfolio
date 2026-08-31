from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from server.config.env import required_env

# No fallback DSN: one meant a deployment with DATABASE_URL unset started
# cleanly and pointed at a database that does not exist. Read from config.env
# rather than config.settings so importing the ORM does not also demand the
# Bedrock and JWT configuration - alembic needs this module and none of that.
DATABASE_URL = required_env("DATABASE_URL")
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
