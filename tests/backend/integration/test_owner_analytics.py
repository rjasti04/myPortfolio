"""Aggregate analytics for the owner.

Every read the Activity dashboard performs is scoped to one session_id, so
months of user_activity_events had no query that could cross sessions. The
ai_llm_telemetry rows in particular are a complete Bedrock cost record that
nothing had ever read.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from server.auth import dependencies as auth_dependencies
from server.db.database import get_db
from server.main import app
from server.models.event import UserActivityEvent
from server.models.session import UserSession
from tests.backend.helpers import register_verified_account

OWNER_EMAIL = "owner-analytics@example.com"
WINDOW = "?days=30"


@pytest.fixture
def owner_configured(monkeypatch):
    monkeypatch.setattr(auth_dependencies, "OWNER_EMAIL", OWNER_EMAIL)


# The database is session-scoped, so the owner account outlives the test that
# created it. Register once, then just log in.
_REGISTERED: set[str] = set()


async def _headers(async_client, email):
    password = "Str0ngPassw0rd!"
    if email not in _REGISTERED:
        await register_verified_account(async_client, email, password)
        _REGISTERED.add(email)
    login = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seed(session_count=2):
    """Two sessions of real-shaped events, written straight through the ORM.

    Returns the model id it used. Unique per call, because the database is
    session-scoped and several tests here seed into it - a fixed id made
    per-model totals accumulate across them.
    """
    gen = app.dependency_overrides[get_db]()
    db = await gen.__anext__()
    now = datetime.now(timezone.utc)
    model_id = f"test-model-{uuid.uuid4().hex[:8]}"
    try:
        for index in range(session_count):
            session_id = uuid.uuid4()
            db.add(
                UserSession(
                    session_id=session_id,
                    ip_address=f"203.0.113.{index}",
                    user_agent="pytest",
                    device_type="mobile" if index else "desktop",
                    started_at=now - timedelta(hours=index + 1),
                    last_active_at=now,
                    is_active=index == 0,
                )
            )
            # Flush the parent before its events. There is no ORM relationship
            # between the two - only a raw ForeignKey column - so the unit of
            # work does not know to order the inserts, and PostgreSQL rejects
            # the child row. SQLite does not enforce foreign keys by default,
            # so this only shows up on the real database.
            await db.flush()
            for offset, path in enumerate(["/", "/#resume", "/#contact"]):
                db.add(
                    UserActivityEvent(
                        session_id=session_id,
                        event_type="page_view",
                        page_path=path,
                        event_data={},
                        created_at=now - timedelta(minutes=30 - offset),
                    )
                )
            db.add(
                UserActivityEvent(
                    session_id=session_id,
                    event_type="terminal_command",
                    page_path="/#about",
                    event_data={"command": "skills", "argc": 0, "ok": True},
                    created_at=now - timedelta(minutes=20),
                )
            )
            db.add(
                UserActivityEvent(
                    session_id=session_id,
                    event_type="ai_llm_telemetry",
                    page_path="/api/chat/stream",
                    event_data={
                        "model_id": model_id,
                        "input_tokens": 100,
                        "output_tokens": 40,
                        "cache_read_tokens": 10,
                        "cache_creation_tokens": 5,
                        "cache_hit": index == 0,
                        "latency_ms": 250.0,
                    },
                    created_at=now - timedelta(minutes=10),
                )
            )
        db.add(
            UserActivityEvent(
                session_id=session_id,
                event_type="terminal_command",
                page_path="/#about",
                event_data={"command": "__unknown__", "argc": 0, "ok": False},
                created_at=now - timedelta(minutes=5),
            )
        )
        await db.commit()
    finally:
        await gen.aclose()
    return model_id


PATHS = ["/overview", "/funnel", "/commands", "/llm"]


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.asyncio
async def test_analytics_requires_authentication(async_client, path):
    assert (await async_client.get(f"/api/admin/analytics{path}")).status_code == 401


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.asyncio
async def test_a_signed_in_stranger_cannot_read_them(async_client, owner_configured, path):
    """These expose every visitor's browsing. A login is not enough."""
    headers = await _headers(async_client, f"stranger-{uuid.uuid4().hex[:8]}@example.com")
    response = await async_client.get(f"/api/admin/analytics{path}", headers=headers)
    assert response.status_code == 403


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.asyncio
async def test_an_unset_owner_email_denies_everyone(async_client, monkeypatch, path):
    """Fails closed. A misconfigured deploy that silently published every
    visitor's browsing to any registered account is the worse failure."""
    monkeypatch.setattr(auth_dependencies, "OWNER_EMAIL", "")
    headers = await _headers(async_client, f"nobody-{uuid.uuid4().hex[:8]}@example.com")
    assert (
        await async_client.get(f"/api/admin/analytics{path}", headers=headers)
    ).status_code == 403


@pytest.mark.asyncio
async def test_the_overview_counts_across_sessions(async_client, owner_configured):
    await _seed()
    headers = await _headers(async_client, OWNER_EMAIL)
    body = (
        await async_client.get(f"/api/admin/analytics/overview{WINDOW}", headers=headers)
    ).json()

    assert body["sessions"] >= 2
    assert body["distinct_ips"] >= 2
    types = {row["type"]: row["count"] for row in body["event_types"]}
    assert types["page_view"] >= 6
    assert types["ai_llm_telemetry"] >= 2
    devices = {row["device"] for row in body["devices"]}
    assert {"desktop", "mobile"} <= devices
    assert body["daily_events"], "the daily series must not be empty"


@pytest.mark.asyncio
async def test_funnel_totals_count_paths_the_limit_cut(async_client, owner_configured):
    """`total_hits` used to be the sum of the returned steps.

    With more distinct paths than the limit that under-reports by the whole
    tail, and every `share` becomes a fraction of the visible rows - so they
    added to 1.0 however much had been left out.
    """
    gen = app.dependency_overrides[get_db]()
    db = await gen.__anext__()
    now = datetime.now(timezone.utc)
    session_id = uuid.uuid4()
    try:
        db.add(
            UserSession(
                session_id=session_id,
                ip_address="203.0.113.99",
                user_agent="pytest",
                device_type="desktop",
                started_at=now - timedelta(hours=1),
                last_active_at=now,
                is_active=True,
            )
        )
        await db.flush()
        # Twelve distinct paths against a limit of three.
        for index in range(12):
            db.add(
                UserActivityEvent(
                    session_id=session_id,
                    event_type="page_view",
                    page_path=f"/wide-{index}",
                    event_data={},
                    created_at=now - timedelta(minutes=40 - index),
                )
            )
        await db.commit()
    finally:
        await gen.aclose()

    headers = await _headers(async_client, OWNER_EMAIL)
    response = await async_client.get(
        f"/api/admin/analytics/funnel{WINDOW}&limit=3", headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert len(body["steps"]) == 3
    assert body["total_hits"] > sum(step["hits"] for step in body["steps"]), (
        "the total must count the paths the limit cut"
    )
    assert sum(step["share"] for step in body["steps"]) < 1.0, (
        "three of twelve paths cannot be the whole visit"
    )


@pytest.mark.asyncio
async def test_the_funnel_never_invents_a_cross_session_transition(async_client, owner_configured):
    """LEAD is partitioned by session.

    Without the partition the last event of one session pairs with the first of
    the next, producing a transition nobody made. The per-session version needs
    no partition because its WHERE already guarantees one session.
    """
    await _seed()
    headers = await _headers(async_client, OWNER_EMAIL)
    body = (
        await async_client.get(f"/api/admin/analytics/funnel{WINDOW}", headers=headers)
    ).json()

    paths = {step["path"] for step in body["steps"]}
    assert {"/", "/#resume", "/#contact"} <= paths
    for step in body["steps"]:
        assert step["sessions"] >= 1

    edges = {(t["from"], t["to"]) for t in body["transitions"]}
    assert ("/", "/#resume") in edges
    # The seed's last path in a session is /#about; the first of the next is
    # "/". That edge exists only if the partition is missing.
    assert ("/#about", "/") not in edges


@pytest.mark.asyncio
async def test_command_usage_separates_recognised_from_mistyped(async_client, owner_configured):
    await _seed()
    headers = await _headers(async_client, OWNER_EMAIL)
    body = (
        await async_client.get(f"/api/admin/analytics/commands{WINDOW}", headers=headers)
    ).json()

    by_name = {row["command"]: row for row in body["commands"]}
    assert by_name["skills"]["runs"] >= 2
    assert by_name["skills"]["recognised"] == by_name["skills"]["runs"]
    # A command typed but not recognised is a feature request in disguise.
    assert by_name["__unknown__"]["recognised"] == 0


@pytest.mark.asyncio
async def test_llm_usage_totals_the_telemetry_nothing_had_read(async_client, owner_configured):
    model_id = await _seed()
    headers = await _headers(async_client, OWNER_EMAIL)
    body = (
        await async_client.get(f"/api/admin/analytics/llm{WINDOW}", headers=headers)
    ).json()

    assert body["turns"] >= 2
    assert body["input_tokens"] >= 200
    assert body["output_tokens"] >= 80
    assert body["cache_read_tokens"] >= 20
    assert 0.0 <= body["cache_hit_rate"] <= 1.0
    # A mean, not an exact value: the chat suites write ai_llm_telemetry rows of
    # their own into this session-scoped database, so asserting 250.0 here made
    # the test pass alone and fail in a full run.
    assert body["mean_latency_ms"] > 0

    by_model = {row["model_id"]: row for row in body["by_model"]}
    assert by_model[model_id]["turns"] == 2
    assert by_model[model_id]["input_tokens"] == 200
    assert by_model[model_id]["output_tokens"] == 80


@pytest.mark.asyncio
async def test_the_window_is_bounded(async_client, owner_configured):
    """Unindexed aggregates over a growing table; an unbounded range is the
    query that eventually times out."""
    headers = await _headers(async_client, OWNER_EMAIL)
    assert (
        await async_client.get("/api/admin/analytics/overview?days=366", headers=headers)
    ).status_code == 422
    assert (
        await async_client.get("/api/admin/analytics/overview?days=0", headers=headers)
    ).status_code == 422


@pytest.mark.asyncio
async def test_a_narrow_window_excludes_older_events(async_client, owner_configured):
    """Proves the date filter is applied rather than decorative."""
    gen = app.dependency_overrides[get_db]()
    db = await gen.__anext__()
    session_id = uuid.uuid4()
    old = datetime.now(timezone.utc) - timedelta(days=200)
    try:
        db.add(
            UserSession(
                session_id=session_id,
                ip_address="198.51.100.7",
                device_type="desktop",
                started_at=old,
                last_active_at=old,
                is_active=False,
            )
        )
        await db.flush()
        db.add(
            UserActivityEvent(
                session_id=session_id,
                event_type="terminal_command",
                page_path="/#about",
                event_data={"command": "ancient", "argc": 0, "ok": True},
                created_at=old,
            )
        )
        await db.commit()
    finally:
        await gen.aclose()

    headers = await _headers(async_client, OWNER_EMAIL)
    recent = (
        await async_client.get("/api/admin/analytics/commands?days=7", headers=headers)
    ).json()
    assert "ancient" not in {row["command"] for row in recent["commands"]}

    wide = (
        await async_client.get("/api/admin/analytics/commands?days=365", headers=headers)
    ).json()
    assert "ancient" in {row["command"] for row in wide["commands"]}
