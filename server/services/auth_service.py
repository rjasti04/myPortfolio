from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update
from fastapi import HTTPException, status
from server.models.user import User
from server.models.token import RefreshToken
from server.schemas.auth import UserCreate, UserLogin, Token, RefreshTokenRequest
from server.auth.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_token,
    REFRESH_TOKEN_EXPIRE_DAYS
)
from sqlalchemy.exc import IntegrityError
import structlog
from datetime import datetime, timezone, timedelta
import uuid

logger = structlog.get_logger(__name__)

async def register_user(db: AsyncSession, user_data: UserCreate) -> User:
    email_normalized = user_data.email.strip().lower()
    # Check if user already exists
    result = await db.execute(select(User).where(User.email == email_normalized))
    if result.scalars().first():
        logger.info("registration_failed_email_exists", email=email_normalized)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Hash the password
    hashed_password = get_password_hash(user_data.password)

    # Create new user
    db_user = User(
        email=email_normalized,
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
    email_normalized = user_data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalars().first()

    if not user or not verify_password(user_data.password, user.hashed_password):
        # Prevent user enumeration by giving generic error
        logger.warning("login_failed", email=email_normalized)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning("login_failed_inactive", email=email_normalized)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Update last login
    user.last_login = datetime.now(timezone.utc)
    db.add(user)

    # Generate Refresh Token JTI and record it in database
    jti = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    db_token = RefreshToken(
        user_id=user.id,
        token_jti=jti,
        expires_at=expires_at
    )
    db.add(db_token)
    await db.commit()

    logger.info("user_logged_in", user_id=str(user.id), email=user.email)

    return Token(
        access_token=create_access_token(subject=str(user.id)),
        refresh_token=create_refresh_token(subject=str(user.id), jti=jti),
        token_type="bearer"
    )

async def refresh_user_token(db: AsyncSession, token_data: RefreshTokenRequest) -> Token:
    payload = verify_token(token_data.refresh_token, expected_type="refresh")
    user_id_str = payload.get("sub")
    jti = payload.get("jti")

    if not user_id_str or not jti:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token subject")

    # Look up the refresh token in the database
    token_result = await db.execute(select(RefreshToken).where(RefreshToken.token_jti == jti))
    db_token = token_result.scalars().first()

    now = datetime.now(timezone.utc)
    if not db_token or db_token.is_revoked or db_token.expires_at.replace(tzinfo=timezone.utc) < now:
        # If a refresh token is reused/revoked/expired, reject the request
        logger.warning("refresh_token_invalid_or_revoked", jti=jti, user_id=user_id_str)
        raise HTTPException(status_code=401, detail="Refresh token has been revoked or expired")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Revoke the old refresh token (rotation)
    db_token.is_revoked = True
    db.add(db_token)

    # Generate new JTI and save new refresh token record
    new_jti = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    new_db_token = RefreshToken(
        user_id=user.id,
        token_jti=new_jti,
        expires_at=expires_at
    )
    db.add(new_db_token)
    await db.commit()

    logger.info("token_refreshed", user_id=str(user.id), old_jti=jti, new_jti=new_jti)

    return Token(
        access_token=create_access_token(subject=str(user.id)),
        refresh_token=create_refresh_token(subject=str(user.id), jti=new_jti),
        token_type="bearer"
    )

async def revoke_user_tokens(db: AsyncSession, user_id: uuid.UUID) -> None:
    # Mark all active tokens for this user as revoked
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.is_revoked == False)
        .values(is_revoked=True)
    )
    await db.commit()
    logger.info("all_refresh_tokens_revoked", user_id=str(user_id))
