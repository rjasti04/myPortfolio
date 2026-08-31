import pytest

from server.schemas.event import EVENT_TYPES


async def _new_session(async_client):
    response = await async_client.post(
        "/api/sessions",
        json={"user_agent": "pytest-agent", "device_type": "desktop"},
    )
    assert response.status_code == 201
    body = response.json()
    # Creating a session is the only time the token is handed out; every call
    # scoped to that session must present it.
    return body["session_id"], {"X-Session-Token": body["session_token"]}


async def _seed(async_client, session_id, headers):
    """Seeds a known mix: 3 clicks, 2 page_views, 1 theme_change over 2 paths."""
    events = (
        [
            {
                "session_id": session_id,
                "event_type": "click",
                "page_path": "/#about",
                "event_data": {"tag": "A", "tracked": True},
            }
        ]
        * 3
        + [
            {
                "session_id": session_id,
                "event_type": "page_view",
                "page_path": "/#activity",
                "event_data": {"referrer": ""},
            }
        ]
        * 2
        + [
            {
                "session_id": session_id,
                "event_type": "theme_change",
                "page_path": "/#about",
                "event_data": {"theme": "dark"},
            }
        ]
    )
    response = await async_client.post("/api/events/bulk", json={"events": events}, headers=headers)
    assert response.status_code == 201
    assert response.json()["inserted"] == 6


@pytest.mark.asyncio
async def test_event_summary_counts_by_type(async_client):
    """Summary returns per-type totals plus the session-wide span."""
    session_id, headers = await _new_session(async_client)
    await _seed(async_client, session_id, headers)

    response = await async_client.get(f"/api/sessions/{session_id}/events/summary", headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body["total_events"] == 6
    assert body["distinct_paths"] == 2
    assert body["first_event_at"] is not None
    assert body["last_event_at"] is not None

    counts = {row["event_type"]: row["count"] for row in body["by_type"]}
    assert counts["click"] == 3
    assert counts["page_view"] == 2
    assert counts["theme_change"] == 1


@pytest.mark.asyncio
async def test_event_summary_zero_fills_every_declared_type(async_client):
    """
    Untouched types must still appear with count 0 - the dashboard grid renders
    one tile per row and would reflow if rows appeared only once used.
    """
    session_id, headers = await _new_session(async_client)
    await _seed(async_client, session_id, headers)

    response = await async_client.get(f"/api/sessions/{session_id}/events/summary", headers=headers)
    body = response.json()

    returned = [row["event_type"] for row in body["by_type"]]
    assert returned[: len(EVENT_TYPES)] == list(EVENT_TYPES)

    counts = {row["event_type"]: row["count"] for row in body["by_type"]}
    assert counts["terminal_command"] == 0
    assert counts["copy_email"] == 0
    assert counts["contact_submission"] == 0


@pytest.mark.asyncio
async def test_event_summary_empty_session(async_client):
    """A session with no events reports zeros rather than 404."""
    session_id, headers = await _new_session(async_client)

    response = await async_client.get(f"/api/sessions/{session_id}/events/summary", headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body["total_events"] == 0
    assert body["distinct_paths"] == 0
    assert body["first_event_at"] is None
    assert body["last_event_at"] is None
    assert all(row["count"] == 0 for row in body["by_type"])


@pytest.mark.asyncio
async def test_list_events_filters_by_type(async_client):
    """The tile drill-down narrows the list endpoint to a single event type."""
    session_id, headers = await _new_session(async_client)
    await _seed(async_client, session_id, headers)

    response = await async_client.get(
        f"/api/sessions/{session_id}/events", params={"event_type": "click", "limit": 50}, headers=headers
    )
    assert response.status_code == 200
    events = response.json()

    assert len(events) == 3
    assert {e["event_type"] for e in events} == {"click"}


@pytest.mark.asyncio
async def test_list_events_rejects_unknown_type(async_client):
    session_id, headers = await _new_session(async_client)

    response = await async_client.get(
        f"/api/sessions/{session_id}/events", params={"event_type": "not_a_type"}, headers=headers
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_events_returns_event_id(async_client):
    """The client dedupes streamed events on event_id, so it must be present."""
    session_id, headers = await _new_session(async_client)
    await _seed(async_client, session_id, headers)

    response = await async_client.get(
        f"/api/sessions/{session_id}/events", params={"limit": 50}, headers=headers
    )
    events = response.json()

    assert events
    assert all(e.get("event_id") is not None for e in events)
    # Ordering is newest-first and must be stable even when created_at ties.
    ids = [e["event_id"] for e in events]
    assert ids == sorted(ids, reverse=True)


@pytest.mark.asyncio
async def test_created_event_broadcast_includes_event_id(async_client):
    """
    Regression: the SSE payload used to omit event_id, which made the browser's
    duplicate check a no-op and let live events render twice.
    """
    from server.services import kafka_stream

    session_id, headers = await _new_session(async_client)
    queue = await kafka_stream.register_stream(__import__("uuid").UUID(session_id))

    try:
        response = await async_client.post(
            "/api/events",
            headers=headers,
            json={
                "session_id": session_id,
                "event_type": "theme_change",
                "page_path": "/#about",
                "event_data": {"theme": "light"},
            },
        )
        assert response.status_code == 201
        created_id = response.json()["event_id"]

        broadcast = await queue.get()
        assert broadcast["event_id"] == created_id
    finally:
        kafka_stream.unregister_stream(__import__("uuid").UUID(session_id), queue)
