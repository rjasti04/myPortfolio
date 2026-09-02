import json
import asyncio
import time
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
from server.auth.session_token import assert_session_access, require_session_access
from server.schemas.event import EVENT_TYPES, EventCreate, BulkEventCreate

logger = structlog.get_logger(__name__)

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_event(payload: EventCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Inserts one row into user_activity_events.
    The session must exist in user_sessions.
    """
    assert_session_access(payload.session_id, request)

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

    # Broadcast event to active SSE streams. `spawn_background` retains a
    # strong reference; a bare create_task can be collected mid-await.
    from server.services.kafka_stream import broadcast_event, spawn_background
    spawn_background(broadcast_event(payload.session_id, {
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

    Unrecognised event types are skipped individually rather than failing the
    batch. `BulkEventItem` types `event_type` as a plain string precisely so
    that decision lands here: when the vocabulary lived in the request schema,
    FastAPI answered 422 for the whole request, and since analytics.js only
    re-queues on 5xx/429 the valid events in that batch were lost with it. A
    client that runs ahead of a server deploy should cost itself one event, not
    everything it had buffered.
    """
    if not payload.events:
        raise HTTPException(400, "events list is empty")

    # One batch, one session: a caller holding one token must not be able to
    # write events attributed to somebody else's session. This stays a hard
    # failure for the whole batch - it is an authorisation boundary, not a
    # vocabulary mismatch.
    for event in payload.events:
        assert_session_access(event.session_id, request)
    if len(payload.events) > 500:
        raise HTTPException(400, "Maximum 500 events per bulk request")

    events = []
    rejected = []
    for index, e in enumerate(payload.events):
        if e.event_type not in EVENT_TYPES:
            rejected.append({
                "index": index,
                "event_type": e.event_type,
                "reason": "unknown event_type",
            })
            continue
        events.append(
            UserActivityEvent(
                session_id=e.session_id,
                event_type=e.event_type,
                page_path=e.page_path,
                event_data=e.event_data,
            )
        )

    if rejected:
        logger.warning(
            "bulk_events_partially_rejected",
            rejected_count=len(rejected),
            accepted_count=len(events),
            event_types=sorted({r["event_type"] for r in rejected}),
        )

    if not events:
        return {"inserted": 0, "rejected": rejected}

    try:
        db.add_all(events)
        await db.commit()

        if payload.flush_reason:
            from server.services.kafka_stream import record_flush_reason
            record_flush_reason(payload.flush_reason, len(events))

        # Broadcast all inserted events to active streams
        from server.services.kafka_stream import broadcast_event, spawn_background
        for e in events:
            spawn_background(broadcast_event(e.session_id, {
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
        raise HTTPException(422, "Failed to insert events (possibly invalid session_id)") from e

    return {"inserted": len(events), "rejected": rejected}


# A comment frame every 2s (the previous behaviour) is far more chatty than any
# proxy idle timeout requires. 15s keeps intermediaries from reaping the
# connection at a fraction of the write volume.
SSE_KEEPALIVE_SECONDS = 15.0

# Cadence for pipeline health frames pushed down the same connection, so the
# DAG needs no second polling loop.
SSE_PIPELINE_INTERVAL_SECONDS = 2.0

# Browser reconnect backoff, advertised once on connect.
SSE_RETRY_MS = 3000


def _sse_frame(channel: str, payload: dict, event_id: Optional[int] = None) -> str:
    """Serialises one SSE frame on a named channel."""
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {channel}")
    lines.append(f"data: {json.dumps(payload, default=str)}")
    return "\n".join(lines) + "\n\n"


def _compact(event: dict) -> dict:
    """
    Compact wire shape for streamed events.

    `session_id` is implicit in the stream and ISO-8601 strings cost roughly
    twice what an epoch integer does, so the frame carries neither. The REST
    list endpoint keeps the verbose shape, where readability matters more than
    bytes on the wire.
    """
    created_at = event.get("created_at")
    if isinstance(created_at, str):
        try:
            ts = int(datetime.fromisoformat(created_at).timestamp() * 1000)
        except ValueError:
            ts = int(_now().timestamp() * 1000)
    elif isinstance(created_at, datetime):
        ts = int(created_at.timestamp() * 1000)
    else:
        ts = int(_now().timestamp() * 1000)

    return {
        "i": event.get("event_id"),
        "t": ts,
        "e": event.get("event_type"),
        "p": event.get("page_path"),
        "d": event.get("event_data"),
    }


async def stream_session_events(
    session_id: UUID,
    request: Request,
    _: UUID = Depends(require_session_access),
):
    """
    Exposes an SSE stream endpoint that relays real-time event updates to the client dashboard.

    Carries three named channels on one connection:
      `hello`    - bootstrap (server time, retry hint, pipeline snapshot)
      `activity` - one activity event, compacted, carrying an `id:` for resume
      `pipeline` - periodic per-stage health for the DAG

    Every event used to be sent twice - once on the named `activity` channel and
    once as an unnamed `data:` frame, for a client still on
    `EventSource.onmessage`. That deploy has long since happened and the only
    client subscribes to both, deduplicating by `event_id`, so the copy was pure
    waste: double the bytes, and the redundant one was the larger verbose shape.
    """
    from server.services.kafka_stream import (
        TooManyStreams,
        register_stream,
        unregister_stream,
        replay_since,
        pipeline_snapshot,
    )

    # Set by the browser automatically on reconnect from the last `id:` it saw.
    raw_last_id = request.headers.get("last-event-id")
    try:
        last_event_id = int(raw_last_id) if raw_last_id else None
    except ValueError:
        last_event_id = None

    try:
        client_queue = await register_stream(session_id)
    except TooManyStreams as exc:
        # 429 rather than 403: the caller is authorised, just over its
        # allowance, and EventSource will retry on its own backoff.
        raise HTTPException(status_code=429, detail=str(exc)) from None

    async def event_generator():
        try:
            yield f"retry: {SSE_RETRY_MS}\n\n"
            yield _sse_frame("hello", {
                "server_time": _now().isoformat(),
                "resumed_from": last_event_id,
                "pipeline": pipeline_snapshot(),
            })

            # Close the reconnect gap before streaming anything new.
            for missed in replay_since(session_id, last_event_id):
                yield _sse_frame("activity", _compact(missed), event_id=missed.get("event_id"))

            last_pipeline_at = 0.0
            last_write = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break

                now = time.monotonic()
                if now - last_pipeline_at >= SSE_PIPELINE_INTERVAL_SECONDS:
                    last_pipeline_at = now
                    yield _sse_frame("pipeline", pipeline_snapshot())

                # Wake often enough to keep the pipeline cadence honest, but
                # only write a keep-alive comment once the full interval of
                # genuine silence has elapsed.
                try:
                    event_dict = await asyncio.wait_for(
                        client_queue.get(), timeout=SSE_PIPELINE_INTERVAL_SECONDS
                    )
                except asyncio.TimeoutError:
                    idle_for = time.monotonic() - last_write
                    if idle_for >= SSE_KEEPALIVE_SECONDS:
                        yield ": keep-alive\n\n"
                        last_write = time.monotonic()
                    continue

                if event_dict.get("__channel__") == "pipeline":
                    payload = {k: v for k, v in event_dict.items() if k != "__channel__"}
                    yield _sse_frame("pipeline", payload)
                else:
                    event_id = event_dict.get("event_id")
                    yield _sse_frame("activity", _compact(event_dict), event_id=event_id)
                last_write = time.monotonic()
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
    _: UUID = Depends(require_session_access),
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


async def get_session_path_funnel(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: UUID = Depends(require_session_access),
    limit: int = Query(default=8, ge=1, le=25, description="Maximum paths to return."),
):
    """
    Path-level funnel for the session: dwell, hits, and where each path leads.

    Uses a single window-function pass to pair every event with the next
    distinct path in the session, which is what makes the transition edges
    computable without pulling the whole event set into the application.
    """
    ordered = (
        select(
            UserActivityEvent.page_path.label("path"),
            UserActivityEvent.created_at.label("at"),
            func.lead(UserActivityEvent.page_path)
            .over(order_by=(UserActivityEvent.created_at, UserActivityEvent.event_id))
            .label("next_path"),
            func.lead(UserActivityEvent.created_at)
            .over(order_by=(UserActivityEvent.created_at, UserActivityEvent.event_id))
            .label("next_at"),
        )
        .where(
            UserActivityEvent.session_id == session_id,
            UserActivityEvent.page_path.isnot(None),
        )
        .subquery()
    )

    result = await db.execute(
        select(
            ordered.c.path,
            func.count().label("hits"),
            func.min(ordered.c.at).label("first_at"),
            func.max(ordered.c.at).label("last_at"),
        )
        .group_by(ordered.c.path)
        .order_by(desc("hits"))
        .limit(limit)
    )
    steps = [
        {
            "path": row.path,
            "hits": row.hits,
            "first_at": row.first_at,
            "last_at": row.last_at,
        }
        for row in result
    ]

    transitions_result = await db.execute(
        select(
            ordered.c.path.label("from_path"),
            ordered.c.next_path.label("to_path"),
            func.count().label("weight"),
        )
        .where(
            ordered.c.next_path.isnot(None),
            ordered.c.next_path != ordered.c.path,
        )
        .group_by(ordered.c.path, ordered.c.next_path)
        .order_by(desc("weight"))
        .limit(limit * 2)
    )
    transitions = [
        {"from": row.from_path, "to": row.to_path, "weight": row.weight}
        for row in transitions_result
    ]

    total = sum(step["hits"] for step in steps)
    for step in steps:
        step["share"] = round(step["hits"] / total, 4) if total else 0.0

    return {
        "session_id": session_id,
        "total_hits": total,
        "steps": steps,
        "transitions": transitions,
    }


async def get_session_event_summary(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: UUID = Depends(require_session_access),
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
