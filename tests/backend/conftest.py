import os
os.environ.setdefault("TESTING", "true")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("DEFAULT_MODEL_ID", "dummy-model-id")
# JWT_SECRET is required at import time and must clear the length floor; this
# throwaway value is for the test process only.
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-any-real-deployment")

from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool, StaticPool

from server.main import app
import os
from server.db.database import Base, get_db

DATABASE_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:?cache=shared")

if DATABASE_URL.startswith("sqlite"):
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
else:
    engine = create_async_engine(DATABASE_URL, echo=False, poolclass=NullPool)

TestingSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

async def override_get_db():
    async with TestingSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

app.dependency_overrides[get_db] = override_get_db

import pytest_asyncio

@pytest_asyncio.fixture(scope="session")
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture(scope="session")
async def async_client(setup_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# --- email verification -----------------------------------------------------
# Registration now issues a verification link and login refuses an unconfirmed
# address. The mail helper is patched once here to record the token rather than
# open an SMTP connection; tests redeem it through the real endpoint using
# tests.backend.helpers.register_verified_account.

import pytest
from server.services import auth_service
from tests.backend import helpers


@pytest.fixture(autouse=True)
def capture_verification_email(monkeypatch):
    monkeypatch.setattr(
        auth_service, "send_email_verification_email", helpers.capture_verification_email
    )
    yield helpers.SENT_VERIFICATION_TOKENS
