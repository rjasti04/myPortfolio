from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException, status
from server.models.user import User
from server.schemas.auth import UserCreate, UserLogin, Token, RefreshTokenRequest
from server.auth.security import get_password_hash, verify_password, create_access_token, create_refresh_token, verify_token
from sqlalchemy.exc import IntegrityError
import structlog
from datetime import datetime, timezone
import uuid

logger = structlog.get_logger(__name__)

async def register_user(db: AsyncSession, user_data: UserCreate) -> User:
    # Check if user already exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalars().first():
        logger.info("registration_failed_email_exists", email=user_data.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Hash the password
    hashed_password = get_password_hash(user_data.password)

    # Create new user
    db_user = User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=hashed_password
    )

    db.add(db_user)
    try:
        await db.commit()
        await db.refresh(db_user)
        logger.info("user_registered", user_id=str(db_user.id), email=db_user.email)
        return db_user
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

async def authenticate_user(db: AsyncSession, user_data: UserLogin) -> Token:
    result = await db.execute(select(User).where(User.email == user_data.email))
    user = result.scalars().first()

    if not user or not verify_password(user_data.password, user.hashed_password):
        # Prevent user enumeration by giving generic error
        logger.warning("login_failed", email=user_data.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning("login_failed_inactive", email=user_data.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Update last login
    user.last_login = datetime.now(timezone.utc)
    db.add(user)
    await db.commit()

    logger.info("user_logged_in", user_id=str(user.id), email=user.email)

    return Token(
        access_token=create_access_token(subject=str(user.id)),
        refresh_token=create_refresh_token(subject=str(user.id)),
        token_type="bearer"
    )

async def refresh_user_token(db: AsyncSession, token_data: RefreshTokenRequest) -> Token:
    payload = verify_token(token_data.refresh_token, expected_type="refresh")
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token subject")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return Token(
        access_token=create_access_token(subject=str(user.id)),
        refresh_token=create_refresh_token(subject=str(user.id)),
        token_type="bearer"
    )
