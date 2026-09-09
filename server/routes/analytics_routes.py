"""Aggregate analytics for the site owner.

Every read the Activity dashboard performs is scoped to one `session_id`, and
every route serving it is shaped `/sessions/{session_id}/...`. Meanwhile
`user_activity_events` has been accumulating nine event types with no way to
ask a question across sessions: how many people reached Contact this month,
which terminal commands anyone actually runs, what the chat has cost.

The per-session funnel algorithm below is the one from `event_controller`
with the session filter removed and a date window in its place - the same
single window-function pass, so the transition edges stay computable in the
database rather than by pulling every event into the process.

The visitor-facing "Session Activity" section is deliberately untouched. It is
a live demo of the ingest pipeline, not a report, and the two audiences want
different things from the same table.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from server.auth.dependencies import require_owner
from server.db.database import get_db
from server.models.event import UserActivityEvent
from server.models.session import UserSession
from server.models.user import User

router = APIRouter(prefix="/admin/analytics", tags=["Owner analytics"])

# A year is the longest window offered. These are unindexed aggregates over a
# growing table, and an unbounded range is the query that eventually times out.
MAX_WINDOW_DAYS = 365


def _since(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _window(days: int = Query(default=30, ge=1, le=MAX_WINDOW_DAYS)) -> int:
    """Shared date window, so every panel on the dashboard reports the same span."""
    return days


@router.get("/overview", summary="Sessions, visitors and event mix over a window")
async def overview(
    days: int = Depends(_window),
    db: AsyncSession = Depends(get_db),
    _owner: User = Depends(require_owner),
):
    since = _since(days)

    sessions = (
        await db.execute(
            select(
                func.count(UserSession.session_id).label("sessions"),
                func.count(func.distinct(UserSession.ip_address)).label("visitors"),
                func.sum(case((UserSession.is_active.is_(True), 1), else_=0)).label("active"),
            ).where(UserSession.started_at >= since)
        )
    ).one()

    devices = (
        await db.execute(
            select(UserSession.device_type, func.count().label("count"))
            .where(UserSession.started_at >= since)
            .group_by(UserSession.device_type)
            .order_by(desc("count"))
        )
    ).all()

    event_types = (
        await db.execute(
            select(UserActivityEvent.event_type, func.count().label("count"))
            .where(UserActivityEvent.created_at >= since)
            .group_by(UserActivityEvent.event_type)
            .order_by(desc("count"))
        )
    ).all()

    daily = (
        await db.execute(
            select(
                func.date(UserActivityEvent.created_at).label("day"),
                func.count().label("count"),
            )
            .where(UserActivityEvent.created_at >= since)
            .group_by("day")
            .order_by("day")
        )
    ).all()

    return {
        "window_days": days,
        "sessions": sessions.sessions or 0,
        # Distinct IPs, which is a floor on people, not a count of them: one
        # office NATs to one address and one phone roams across several.
        "distinct_ips": sessions.visitors or 0,
        "active_sessions": int(sessions.active or 0),
        "devices": [{"device": row.device_type or "unknown", "count": row.count} for row in devices],
        "event_types": [{"type": row.event_type, "count": row.count} for row in event_types],
        "daily_events": [{"day": str(row.day), "count": row.count} for row in daily],
    }


@router.get("/funnel", summary="Which paths visitors reach, and where they go next")
async def funnel(
    days: int = Depends(_window),
    limit: int = Query(default=10, ge=1, le=25),
    db: AsyncSession = Depends(get_db),
    _owner: User = Depends(require_owner),
):
    since = _since(days)

    # LEAD partitioned BY session: without the partition the last event of one
    # session would pair with the first of the next, inventing a transition
    # nobody made. The per-session version has no partition because its WHERE
    # already guarantees one session.
    ordered = (
        select(
            UserActivityEvent.page_path.label("path"),
            func.lead(UserActivityEvent.page_path)
            .over(
                partition_by=UserActivityEvent.session_id,
                order_by=(UserActivityEvent.created_at, UserActivityEvent.event_id),
            )
            .label("next_path"),
            UserActivityEvent.session_id.label("session_id"),
        )
        .where(
            UserActivityEvent.created_at >= since,
            UserActivityEvent.page_path.isnot(None),
        )
        .subquery()
    )

    steps = (
        await db.execute(
            select(
                ordered.c.path,
                func.count().label("hits"),
                func.count(func.distinct(ordered.c.session_id)).label("sessions"),
            )
            .group_by(ordered.c.path)
            .order_by(desc("hits"))
            .limit(limit)
        )
    ).all()

    transitions = (
        await db.execute(
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
    ).all()

    # Over every path in the window, not just the `limit` rows returned. The sum
    # of the returned steps made `total_hits` under-report by whatever the LIMIT
    # cut, and made the shares add to 1.0 no matter how much was missing.
    total = (
        await db.execute(select(func.count()).select_from(ordered))
    ).scalar_one() or 0

    return {
        "window_days": days,
        "total_hits": total,
        "steps": [
            {
                "path": row.path,
                "hits": row.hits,
                "sessions": row.sessions,
                "share": round(row.hits / total, 4) if total else 0.0,
            }
            for row in steps
        ],
        "transitions": [
            {"from": row.from_path, "to": row.to_path, "weight": row.weight}
            for row in transitions
        ],
    }


@router.get("/commands", summary="Which terminal commands visitors actually run")
async def commands(
    days: int = Depends(_window),
    limit: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _owner: User = Depends(require_owner),
):
    """The answer decides which commands are worth keeping.

    `event_data->>'command'` is indexable through `ix_events_data_gin` on
    PostgreSQL; SQLAlchemy renders the same indexed access as `json_extract`
    under SQLite, which is what the test harness runs on.
    """
    since = _since(days)
    name = UserActivityEvent.event_data["command"].as_string()

    rows = (
        await db.execute(
            select(
                name.label("command"),
                func.count().label("runs"),
                func.count(func.distinct(UserActivityEvent.session_id)).label("sessions"),
                func.sum(
                    case(
                        (UserActivityEvent.event_data["ok"].as_boolean().is_(True), 1),
                        else_=0,
                    )
                ).label("recognised"),
            )
            .where(
                UserActivityEvent.event_type == "terminal_command",
                UserActivityEvent.created_at >= since,
                name.isnot(None),
            )
            .group_by(name)
            .order_by(desc("runs"))
            .limit(limit)
        )
    ).all()

    return {
        "window_days": days,
        "commands": [
            {
                "command": row.command,
                "runs": row.runs,
                "sessions": row.sessions,
                # A command typed but not recognised is a feature request in
                # disguise: someone expected it to exist.
                "recognised": int(row.recognised or 0),
            }
            for row in rows
        ],
    }


@router.get("/llm", summary="Bedrock token spend and cache efficiency")
async def llm_usage(
    days: int = Depends(_window),
    db: AsyncSession = Depends(get_db),
    _owner: User = Depends(require_owner),
):
    """`ai_llm_telemetry` events carry per-turn tokens, cache hits and latency.

    chat_routes has been writing them after every completed stream since the
    telemetry landed, and nothing has ever read them: the chat UI reports
    per-conversation totals from its own metrics frames, so the monthly figure
    existed only in this table.
    """
    since = _since(days)
    data = UserActivityEvent.event_data

    totals = (
        await db.execute(
            select(
                func.count().label("turns"),
                func.sum(data["input_tokens"].as_integer()).label("input_tokens"),
                func.sum(data["output_tokens"].as_integer()).label("output_tokens"),
                func.sum(data["cache_read_tokens"].as_integer()).label("cache_read_tokens"),
                func.sum(data["cache_creation_tokens"].as_integer()).label("cache_creation_tokens"),
                func.avg(data["latency_ms"].as_float()).label("mean_latency_ms"),
                func.sum(
                    case((data["cache_hit"].as_boolean().is_(True), 1), else_=0)
                ).label("cache_hits"),
            ).where(
                UserActivityEvent.event_type == "ai_llm_telemetry",
                UserActivityEvent.created_at >= since,
            )
        )
    ).one()

    by_model = (
        await db.execute(
            select(
                data["model_id"].as_string().label("model_id"),
                func.count().label("turns"),
                func.sum(data["input_tokens"].as_integer()).label("input_tokens"),
                func.sum(data["output_tokens"].as_integer()).label("output_tokens"),
            )
            .where(
                UserActivityEvent.event_type == "ai_llm_telemetry",
                UserActivityEvent.created_at >= since,
            )
            .group_by("model_id")
            .order_by(desc("turns"))
        )
    ).all()

    turns = totals.turns or 0
    return {
        "window_days": days,
        "turns": turns,
        "input_tokens": int(totals.input_tokens or 0),
        "output_tokens": int(totals.output_tokens or 0),
        "cache_read_tokens": int(totals.cache_read_tokens or 0),
        "cache_creation_tokens": int(totals.cache_creation_tokens or 0),
        "cache_hits": int(totals.cache_hits or 0),
        "cache_hit_rate": round((totals.cache_hits or 0) / turns, 4) if turns else 0.0,
        "mean_latency_ms": round(float(totals.mean_latency_ms), 1) if totals.mean_latency_ms else None,
        "by_model": [
            {
                "model_id": row.model_id,
                "turns": row.turns,
                "input_tokens": int(row.input_tokens or 0),
                "output_tokens": int(row.output_tokens or 0),
            }
            for row in by_model
        ],
    }
