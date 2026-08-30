import json
import asyncio
from uuid import UUID
from datetime import datetime, timezone
import structlog
from typing import Optional
from fastapi import Request, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import desc, func
from server.db.database import get_db
from server.models.session import UserSession
from server.models.event import UserActivityEvent
from server.schemas.event import EVENT_TYPES, EventCreate, BulkEventCreate

logger = structlog.get_logger(__name__)

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_event(payload: EventCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Inserts one row into user_activity_events.
    The session must exist in user_sessions.
    """
    session_exists = await db.execute(select(UserSession).where(UserSession.session_id == payload.session_id))
    if not session_exists.scalars().first():
        raise HTTPException(404, f"session_id {payload.session_id} not found")

    event = UserActivityEvent(
        session_id=payload.session_id,
        event_type=payload.event_type,
        page_path=payload.page_path,
        event_data=payload.event_data
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    # Broadcast event to active SSE streams
    from server.services.kafka_stream import broadcast_event
    asyncio.create_task(broadcast_event(payload.session_id, {
        "event_id": event.event_id,
        "session_id": str(payload.session_id),
        "event_type": payload.event_type,
        "page_path": payload.page_path,
        "event_data": payload.event_data,
        "created_at": event.created_at.isoformat() if event.created_at else _now().isoformat()
    }))

    return {"event_id": event.event_id, "created_at": event.created_at}


async def create_events_bulk(payload: BulkEventCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Inserts up to 500 events in a single transaction.
    """
    if not payload.events:
        raise HTTPException(400, "events list is empty")
    if len(payload.events) > 500:
        raise HTTPException(400, "Maximum 500 events per bulk request")

    events = [
        UserActivityEvent(
            session_id=e.session_id,
            event_type=e.event_type,
            page_path=e.page_path,
            event_data=e.event_data
        )
        for e in payload.events
    ]

    try:
        db.add_all(events)
        await db.commit()
        
        # Broadcast all inserted events to active streams
        from server.services.kafka_stream import broadcast_event
        for e in events:
            asyncio.create_task(broadcast_event(e.session_id, {
                "event_id": e.event_id,
                "session_id": str(e.session_id),
                "event_type": e.event_type,
                "page_path": e.page_path,
                "event_data": e.event_data,
                "created_at": (e.created_at or _now()).isoformat()
            }))
    except Exception as e:
        await db.rollback()
        logger.exception("Bulk event insert failed")
        raise HTTPException(422, "Failed to insert events (possibly invalid session_id)")

    return {"inserted": len(events)}


async def stream_session_events(session_id: UUID, request: Request):
    """
    Exposes an SSE stream endpoint that relays real-time event updates to the client dashboard.
    Registers a stream queue for the session_id.
    """
    from server.services.kafka_stream import register_stream, unregister_stream
    
    client_queue = await register_stream(session_id)
    
    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                
                try:
                    event_dict = await asyncio.wait_for(client_queue.get(), timeout=2.0)
                    yield f"data: {json.dumps(event_dict)}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat comment
                    yield ": keep-alive\n\n"
        finally:
            unregister_stream(session_id, client_queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


async def get_session_events(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    event_type: Optional[str] = Query(
        default=None,
        description="Restrict results to a single event type (tile drill-down).",
    ),
):
    limit = int(limit)
    offset = int(offset)

    if event_type is not None and event_type not in EVENT_TYPES:
        raise HTTPException(422, f"Unknown event_type '{event_type}'")

    query = select(UserActivityEvent).where(UserActivityEvent.session_id == session_id)
    if event_type is not None:
        query = query.where(UserActivityEvent.event_type == event_type)

    result = await db.execute(
        query
        # event_id breaks ties: bulk inserts share a created_at, and without a
        # stable secondary sort the same row can appear on two pages.
        .order_by(desc(UserActivityEvent.created_at), desc(UserActivityEvent.event_id))
        .limit(limit)
        .offset(offset)
    )
    events = result.scalars().all()

    return [
        {
            "event_id": e.event_id,
            "event_type": e.event_type,
            "page_path": e.page_path,
            "event_data": e.event_data,
            "created_at": e.created_at
        }
        for e in events
    ]


async def get_session_event_summary(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Aggregate counts for the Activity dashboard summary tiles.

    Two indexed round trips over the session_id index: one GROUP BY for the
    per-type counts, one scalar row for the session-wide span. Counting client
    side is not an option - the table endpoint is paginated, so the browser
    never holds the full event set.
    """
    grouped = await db.execute(
        select(
            UserActivityEvent.event_type,
            func.count().label("count"),
            func.max(UserActivityEvent.created_at).label("last_at"),
        )
        .where(UserActivityEvent.session_id == session_id)
        .group_by(UserActivityEvent.event_type)
    )
    counts = {row.event_type: (row.count, row.last_at) for row in grouped}

    span = await db.execute(
        select(
            func.count(func.distinct(UserActivityEvent.page_path)).label("distinct_paths"),
            func.min(UserActivityEvent.created_at).label("first_at"),
            func.max(UserActivityEvent.created_at).label("last_at"),
        ).where(UserActivityEvent.session_id == session_id)
    )
    span_row = span.one()

    # Zero-fill every declared type so the client grid is stable across polls.
    known = [
        {
            "event_type": name,
            "count": counts.get(name, (0, None))[0],
            "last_at": counts.get(name, (0, None))[1],
        }
        for name in EVENT_TYPES
    ]
    # Surface legacy or since-removed types already sitting in the table.
    unknown = [
        {"event_type": name, "count": count, "last_at": last_at}
        for name, (count, last_at) in counts.items()
        if name not in EVENT_TYPES
    ]

    return {
        "session_id": session_id,
        "total_events": sum(count for count, _ in counts.values()),
        "distinct_paths": span_row.distinct_paths or 0,
        "first_event_at": span_row.first_at,
        "last_event_at": span_row.last_at,
        "by_type": known + unknown,
    }
