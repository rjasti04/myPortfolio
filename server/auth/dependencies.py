from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Optional
from server.db.database import get_db
from server.models.user import User
from server.auth.security import verify_token
from server.config.settings import OWNER_EMAIL
import structlog
import uuid

logger = structlog.get_logger(__name__)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    try:
        payload = verify_token(token, "access")
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            user_id = uuid.UUID(user_id_str)
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid user ID format") from None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("jwt_validation_error", error=str(e))
        # `from None`: the cause is logged above, and chaining it onto the
        # response risks leaking parser internals to an unauthenticated caller.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if user is None:
        # 401, not 404. The token is well-formed and correctly signed but names
        # a row that no longer exists - a hard-purged account, reachable when
        # `register_user` clears one soft-deleted more than 30 days ago. That is
        # a rejected credential, and the rest of the codebase already says so:
        # `refresh_user_token` answers 401 for exactly this case. A 404 also
        # reads to a client as "no such endpoint", so the browser could not tell
        # a dead credential from a routing mistake and left the stale token in
        # storage forever.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    return user

async def get_optional_current_user(
    token: str = Depends(optional_oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    if not token:
        return None
    try:
        return await get_current_user(token=token, db=db)
    except HTTPException:
        return None


async def require_owner(current_user: User = Depends(get_current_user)) -> User:
    """Gate for the aggregate analytics, which read every visitor's activity.

    `users` has no role column and this site has one real account, so the owner
    is named by the OWNER_EMAIL setting rather than by a schema change made in
    service of a constant.

    Unset means **nobody** gets through, not everybody. A misconfigured deploy
    that silently published every visitor's browsing to any registered account
    is a worse failure than one that locks the owner out of his own dashboard.
    """
    if not OWNER_EMAIL:
        logger.warning("owner_analytics_denied_unset", user_id=str(current_user.id))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner analytics are not enabled on this deployment.",
        )
    if (current_user.email or "").strip().lower() != OWNER_EMAIL:
        logger.warning("owner_analytics_denied", user_id=str(current_user.id))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not permitted.",
        )
    return current_user
