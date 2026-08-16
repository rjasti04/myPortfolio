from uuid import UUID
from datetime import datetime, timezone
import structlog
from fastapi import Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update
from server.db.database import get_db
from server.models.session import UserSession
from server.schemas.session import SessionCreate, SessionEnd
from server.config.settings import TRUSTED_PROXY_NETWORKS
from server.utils.ip_utils import client_ip_from_request

logger = structlog.get_logger(__name__)

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_session(payload: SessionCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Creates a new row in user_sessions and returns the generated session_id.
    Client IP is auto-detected from the request.
    """
    request_id = request.scope.get("request_id", "unknown")
    client_ip = client_ip_from_request(request, TRUSTED_PROXY_NETWORKS)

    user_agent_truncated = payload.user_agent[:512] if payload.user_agent else None
    session_db = UserSession(
        ip_address=client_ip,
        user_agent=user_agent_truncated,
        device_type=payload.device_type
    )
    db.add(session_db)
    await db.commit()
    await db.refresh(session_db)

    logger.info(
        "session_created",
        request_id=request_id,
        session_id=str(session_db.session_id),
        device_type=payload.device_type,
        ip_address=client_ip[:15] + "..." if len(client_ip) > 15 else client_ip
    )
    return {"session_id": str(session_db.session_id), "started_at": session_db.started_at}


async def session_heartbeat(session_id: UUID, request: Request, db: AsyncSession = Depends(get_db)):
    """Call periodically (e.g. every 60 s) to keep the session alive."""
    result = await db.execute(
        update(UserSession)
        .where(UserSession.session_id == session_id)
        .values(
            last_active_at=_now(),
            is_active=True,
            ended_at=None,
            end_reason=None
        )
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(404, "Session not found")

    return {"status": "ok", "last_active_at": _now()}


async def end_session(session_id: UUID, payload: SessionEnd, request: Request, db: AsyncSession = Depends(get_db)):
    """Marks the session inactive and records ended_at + end_reason."""
    result = await db.execute(
        update(UserSession)
        .where(UserSession.session_id == session_id)
        .values(
            is_active=False,
            ended_at=_now(),
            last_active_at=_now(),
            end_reason=payload.end_reason
        )
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(404, "Session not found")

    return {"status": "ended", "ended_at": _now()}


async def get_session(session_id: UUID, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserSession).where(UserSession.session_id == session_id))
    session = result.scalars().first()

    if not session:
        raise HTTPException(404, "Session not found")

    return {
        "session_id": session.session_id,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "is_active": session.is_active,
        "device_type": session.device_type,
        "user_agent": session.user_agent,
        "last_active_at": session.last_active_at,
        "end_reason": session.end_reason
    }
