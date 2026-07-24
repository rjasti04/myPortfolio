from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, delete
from fastapi import HTTPException, status, BackgroundTasks
from typing import Optional
from server.models.user import User
from server.models.token import RefreshToken
from server.models.session import UserSession
from server.models.password_history import PasswordHistory
from server.schemas.auth import (
    UserCreate, UserLogin, Token, RefreshTokenRequest, ChangePasswordRequest,
    ForgotPasswordRequest, ResetPasswordRequest
)
from server.auth.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    create_refresh_token,
    create_password_reset_token,
    verify_token,
    REFRESH_TOKEN_EXPIRE_DAYS
)
from server.services.hibp_service import check_password_breached
from server.services.notification_service import send_security_notification_email, send_password_reset_email
from sqlalchemy.exc import IntegrityError
import structlog
from datetime import datetime, timezone, timedelta
import uuid

logger = structlog.get_logger(__name__)

PASSWORD_HISTORY_LIMIT = 5

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
    # Mark all active refresh tokens for this user as revoked
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.is_revoked == False)
        .values(is_revoked=True)
    )
    # Deactivate any user session records if attribute exists
    if hasattr(UserSession, "user_id"):
        await db.execute(
            update(UserSession)
            .where(UserSession.user_id == user_id)
            .where(UserSession.is_active == True)
            .values(is_active=False, ended_at=datetime.now(timezone.utc), end_reason="password_change")
        )
    await db.commit()
    logger.info("all_refresh_tokens_revoked", user_id=str(user_id))


async def change_user_password(
    db: AsyncSession,
    user: User,
    data: ChangePasswordRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    # Step 1: Verify Current Password
    if not verify_password(data.current_password, user.hashed_password):
        logger.warning("password_change_failed_invalid_current", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect current password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Step 2: Check Password Breach Status (Have I Been Pwned API)
    is_breached = await check_password_breached(data.new_password)
    if is_breached:
        logger.warning("password_change_failed_breached", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password has appeared in a data breach and is unsafe to use."
        )

    # Step 3: Check Password Reuse / History
    # Fetch top N recent password hashes from password_history for user
    history_result = await db.execute(
        select(PasswordHistory.password_hash)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_LIMIT)
    )
    recent_history_hashes = history_result.scalars().all()

    # Compare new_password against active password and recent history
    all_candidate_hashes = [user.hashed_password] + list(recent_history_hashes)
    for past_hash in all_candidate_hashes:
        if verify_password(data.new_password, past_hash):
            logger.warning("password_change_failed_reused", user_id=str(user.id))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot reuse a recent password."
            )

    # Step 4: Record in Password History (Store OLD password hash)
    old_hash = user.hashed_password
    history_entry = PasswordHistory(
        user_id=user.id,
        password_hash=old_hash
    )
    db.add(history_entry)

    # Step 5: Update Active Password
    user.hashed_password = get_password_hash(data.new_password)
    db.add(user)

    # Clean up or prune history entries older than the last N records
    prune_subquery = (
        select(PasswordHistory.id)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .offset(PASSWORD_HISTORY_LIMIT)
    )
    prune_result = await db.execute(prune_subquery)
    old_history_ids = prune_result.scalars().all()
    if old_history_ids:
        await db.execute(
            delete(PasswordHistory).where(PasswordHistory.id.in_(old_history_ids))
        )

    # Step 6: Invalidate Active Sessions & Refresh Tokens
    await revoke_user_tokens(db, user.id)

    await db.commit()

    # Step 7: Send Notification (Asynchronous Background Task)
    if background_tasks:
        background_tasks.add_task(send_security_notification_email, user.email, str(user.id))

    logger.info("password_changed_successfully", user_id=str(user.id))

    return {"message": "Password changed successfully"}


async def request_password_reset(
    db: AsyncSession,
    data: ForgotPasswordRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    email_normalized = data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalars().first()

    if user and user.is_active:
        reset_token = create_password_reset_token(subject=str(user.id))
        logger.info("password_reset_requested", user_id=str(user.id), email=email_normalized)
        if background_tasks:
            background_tasks.add_task(send_password_reset_email, user.email, reset_token)
    else:
        logger.info("password_reset_requested_unknown_email", email=email_normalized)

    # Always return a generic success message to prevent user enumeration
    return {"message": "If an account with that email exists, a password reset link has been sent."}


async def reset_password_with_token(
    db: AsyncSession,
    data: ResetPasswordRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    # Step 1: Verify token
    payload = verify_token(data.token, expected_type="password_reset")
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token subject")

    # Step 2: Fetch user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found or inactive")

    # Step 3: Check Password Breach Status
    is_breached = await check_password_breached(data.new_password)
    if is_breached:
        logger.warning("password_reset_failed_breached", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password has appeared in a data breach and is unsafe to use."
        )

    # Step 4: Check Password Reuse / History
    history_result = await db.execute(
        select(PasswordHistory.password_hash)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_LIMIT)
    )
    recent_history_hashes = history_result.scalars().all()

    all_candidate_hashes = [user.hashed_password] + list(recent_history_hashes)
    for past_hash in all_candidate_hashes:
        if verify_password(data.new_password, past_hash):
            logger.warning("password_reset_failed_reused", user_id=str(user.id))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot reuse a recent password."
            )

    # Step 5: Record in Password History (Store OLD password hash)
    old_hash = user.hashed_password
    history_entry = PasswordHistory(
        user_id=user.id,
        password_hash=old_hash
    )
    db.add(history_entry)

    # Step 6: Update Active Password
    user.hashed_password = get_password_hash(data.new_password)
    db.add(user)

    # Clean up old history
    prune_subquery = (
        select(PasswordHistory.id)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .offset(PASSWORD_HISTORY_LIMIT)
    )
    prune_result = await db.execute(prune_subquery)
    old_history_ids = prune_result.scalars().all()
    if old_history_ids:
        await db.execute(
            delete(PasswordHistory).where(PasswordHistory.id.in_(old_history_ids))
        )

    # Step 7: Invalidate Active Sessions & Refresh Tokens
    await revoke_user_tokens(db, user.id)

    await db.commit()

    # Step 8: Send Notification
    if background_tasks:
        background_tasks.add_task(send_security_notification_email, user.email, str(user.id))

    logger.info("password_reset_completed", user_id=str(user.id))

    return {"message": "Password reset successfully. You can now log in with your new password."}



