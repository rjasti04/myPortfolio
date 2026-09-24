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


# --- Bulk batch resilience (BUG-01) -----------------------------------------
# The client emits event types the server may not have declared yet. When the
# vocabulary lived in the request schema, FastAPI answered 422 for the whole
# request and analytics.js dropped the batch, so one unknown type destroyed
# every valid event flushed alongside it.


@pytest.mark.asyncio
async def test_contact_prompt_is_an_accepted_event_type():
    """form.js has always emitted this; the schema has to know about it."""
    assert "contact_prompt" in EVENT_TYPES


@pytest.mark.asyncio
async def test_ai_llm_telemetry_is_a_declared_event_type():
    """chat_routes writes this row directly, so the summary must not call it unknown."""
    assert "ai_llm_telemetry" in EVENT_TYPES


@pytest.mark.asyncio
async def test_unknown_event_type_does_not_discard_the_rest_of_the_batch(async_client):
    """The regression that lost contact form conversions.

    `contact_prompt` and `contact_submission` are emitted seconds apart and land
    in the same flush window, so the batch that carried the conversion event was
    exactly the batch most likely to be rejected.
    """
    session_id, headers = await _new_session(async_client)

    response = await async_client.post(
        "/api/events/bulk",
        json={
            "events": [
                {"session_id": session_id, "event_type": "page_view", "page_path": "/#contact"},
                {"session_id": session_id, "event_type": "not_a_real_event_type"},
                {
                    "session_id": session_id,
                    "event_type": "contact_submission",
                    "event_data": {"success": True},
                },
            ]
        },
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["inserted"] == 2
    assert [r["event_type"] for r in body["rejected"]] == ["not_a_real_event_type"]
    assert body["rejected"][0]["index"] == 1

    stored = await async_client.get(f"/api/sessions/{session_id}/events", headers=headers)
    assert stored.status_code == 200
    stored_types = {e["event_type"] for e in stored.json()}
    assert "contact_submission" in stored_types, "the conversion event must survive"
    assert "page_view" in stored_types
    assert "not_a_real_event_type" not in stored_types


@pytest.mark.asyncio
async def test_batch_of_only_unknown_types_reports_rather_than_failing(async_client):
    session_id, headers = await _new_session(async_client)

    response = await async_client.post(
        "/api/events/bulk",
        json={"events": [{"session_id": session_id, "event_type": "made_up"}]},
        headers=headers,
    )

    assert response.status_code == 201
    assert response.json() == {
        "inserted": 0,
        "rejected": [{"index": 0, "event_type": "made_up", "reason": "unknown event_type"}],
    }


@pytest.mark.asyncio
async def test_bulk_still_refuses_a_batch_touching_another_session(async_client):
    """Partial acceptance covers vocabulary drift, not the authorisation boundary."""
    session_id, headers = await _new_session(async_client)
    other_session_id, _ = await _new_session(async_client)

    response = await async_client.post(
        "/api/events/bulk",
        json={
            "events": [
                {"session_id": session_id, "event_type": "page_view"},
                {"session_id": other_session_id, "event_type": "page_view"},
            ]
        },
        headers=headers,
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_bulk_still_rejects_structurally_invalid_rows(async_client):
    """A malformed session_id is a client bug, not schema drift: still a 422."""
    session_id, headers = await _new_session(async_client)

    response = await async_client.post(
        "/api/events/bulk",
        json={
            "events": [
                {"session_id": session_id, "event_type": "page_view"},
                {"session_id": "not-a-uuid", "event_type": "page_view"},
            ]
        },
        headers=headers,
    )

    assert response.status_code == 422


# --- Session token delivery (SEC-02) ----------------------------------------


@pytest.mark.asyncio
async def test_session_creation_sets_the_token_as_a_cookie(async_client):
    """EventSource cannot set headers, so the stream endpoint used to take the
    token in the query string - where it lands in the access log, in browser
    history, and in any Referer the page emits."""
    response = await async_client.post(
        "/api/sessions", json={"user_agent": "pytest", "device_type": "desktop"}
    )
    assert response.status_code == 201

    cookie = response.cookies.get("rj_session_token")
    assert cookie, "the session token must be issued as a cookie"
    assert cookie == response.json()["session_token"]

    header = response.headers["set-cookie"]
    assert "HttpOnly" in header, "no script on the page should be able to read it"
    assert "SameSite=strict" in header.replace("samesite", "SameSite")


@pytest.mark.asyncio
async def test_the_cookie_alone_authorises_a_session_scoped_call(async_client):
    """This is what lets the token come out of the URL: the cookie rides along
    on the same-origin EventSource request with no header and no query."""
    created = await async_client.post(
        "/api/sessions", json={"user_agent": "pytest", "device_type": "desktop"}
    )
    session_id = created.json()["session_id"]

    # No X-Session-Token header; async_client carries the cookie jar.
    response = await async_client.get(f"/api/sessions/{session_id}/events")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_a_call_with_neither_cookie_nor_header_is_still_refused(async_client):
    created = await async_client.post(
        "/api/sessions", json={"user_agent": "pytest", "device_type": "desktop"}
    )
    session_id = created.json()["session_id"]

    # A separate client, so this starts with an empty cookie jar. `async_client`
    # is session-scoped and shared, so clearing its cookies here would silently
    # strip credentials from every test that runs after this one.
    from httpx import ASGITransport, AsyncClient

    from server.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as anonymous:
        response = await anonymous.get(f"/api/sessions/{session_id}/events")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_client_error_is_an_accepted_event_type():
    """Uncaught frontend exceptions had nowhere to go but the browser console."""
    assert "client_error" in EVENT_TYPES


# --- bulk insert failure statuses (C8) ---------------------------------------
# analytics.js re-queues a batch on 5xx and 429 and drops it on anything else.
# Every failure used to answer 422 "possibly invalid session_id", so a dropped
# connection or a database restart permanently lost the whole buffered batch.


def _one_click(session_id):
    return {"events": [{"session_id": session_id, "event_type": "click", "page_path": "/#about"}]}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "expected"),
    [
        ("operational", 503),
        ("interface", 503),
        ("integrity", 422),
    ],
)
async def test_bulk_failure_status_tells_the_client_whether_to_retry(async_client, error, expected):
    from unittest.mock import patch

    from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError
    from sqlalchemy.ext.asyncio import AsyncSession

    raised = {
        "operational": OperationalError("INSERT", {}, Exception("server closed the connection")),
        "interface": InterfaceError("INSERT", {}, Exception("connection is closed")),
        "integrity": IntegrityError("INSERT", {}, Exception("violates foreign key constraint")),
    }[error]
    session_id, headers = await _new_session(async_client)

    with patch.object(AsyncSession, "commit", side_effect=raised):
        response = await async_client.post("/api/events/bulk", json=_one_click(session_id), headers=headers)

    assert response.status_code == expected, response.text


@pytest.mark.asyncio
async def test_a_failed_broadcast_after_the_commit_is_still_a_success(async_client):
    """The rows are saved by then. Reporting a failure would have the client
    re-send them, or drop a batch that was stored."""
    from unittest.mock import patch

    session_id, headers = await _new_session(async_client)

    payload = {**_one_click(session_id), "flush_reason": "timer"}
    with patch("server.services.kafka_stream.record_flush_reason", side_effect=RuntimeError("metrics broke")):
        response = await async_client.post("/api/events/bulk", json=payload, headers=headers)

    assert response.status_code == 201, response.text
    assert response.json()["inserted"] == 1
    stored = await async_client.get(f"/api/sessions/{session_id}/events", headers=headers)
    assert [e["event_type"] for e in stored.json()] == ["click"]
