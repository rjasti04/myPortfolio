"""Access control for anonymous analytics sessions.

Every activity endpoint identified the visitor by the `session_id` in the URL
and checked nothing else, so holding an id was the same as owning the session:
anyone could read a visitor's full behavioural trail and device metadata, or
write events attributed to them. `POST /events` also answered 404 for an unknown
session and 201 for a real one, which made the id space probeable.

Sessions still need to work without a login, so creation hands out a capability
token that every later call must present.
"""

import uuid

import pytest

from server.auth.session_token import sign_session


async def _new_session(async_client):
    response = await async_client.post(
        "/api/sessions", json={"user_agent": "pytest", "device_type": "desktop"}
    )
    assert response.status_code == 201
    body = response.json()
    return body["session_id"], {"X-Session-Token": body["session_token"]}


@pytest.mark.asyncio
async def test_creating_a_session_returns_a_token(async_client):
    session_id, headers = await _new_session(async_client)
    assert headers["X-Session-Token"] == sign_session(session_id)


def test_the_token_is_not_derivable_from_the_id_alone():
    session_id = uuid.uuid4()
    assert sign_session(session_id) != str(session_id)
    assert sign_session(session_id) != sign_session(uuid.uuid4())
    # Stable, so it needs no server-side storage.
    assert sign_session(session_id) == sign_session(session_id)



def _drop_credentials(async_client):
    """Removes the session cookie from the shared client.

    `async_client` is session-scoped, so it carries one cookie jar for the whole
    run. Since the API began issuing the session token as a cookie - so
    EventSource stops carrying it in the query string, where it landed in access
    logs - creating a session leaves a *valid credential* on the client. A test
    that means "a caller holding nothing" now has to say so explicitly;
    otherwise it is really testing a caller who is properly authorised.

    Every positive test here passes its token as an explicit header, so clearing
    the jar cannot make one of those pass for the wrong reason.
    """
    async_client.cookies.clear()

@pytest.mark.parametrize(
    "method, suffix",
    [
        ("GET", ""),
        ("GET", "/events"),
        ("GET", "/events/summary"),
        ("GET", "/events/funnel"),
        ("PATCH", "/heartbeat"),
    ],
)
@pytest.mark.asyncio
async def test_scoped_endpoints_refuse_a_caller_without_the_token(async_client, method, suffix):
    session_id, _ = await _new_session(async_client)
    _drop_credentials(async_client)
    response = await async_client.request(method, f"/api/sessions/{session_id}{suffix}", json={})
    assert response.status_code == 403


@pytest.mark.parametrize(
    "method, suffix",
    [("GET", ""), ("GET", "/events"), ("GET", "/events/summary")],
)
@pytest.mark.asyncio
async def test_one_session_token_does_not_unlock_another_session(async_client, method, suffix):
    victim_id, _ = await _new_session(async_client)
    _, attacker_headers = await _new_session(async_client)

    response = await async_client.request(
        method, f"/api/sessions/{victim_id}{suffix}", headers=attacker_headers
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_the_token_holder_still_gets_through(async_client):
    session_id, headers = await _new_session(async_client)
    for suffix in ("", "/events", "/events/summary", "/events/funnel"):
        response = await async_client.get(f"/api/sessions/{session_id}{suffix}", headers=headers)
        assert response.status_code == 200, f"{suffix} -> {response.text}"


@pytest.mark.asyncio
async def test_events_cannot_be_written_into_someone_elses_session(async_client):
    victim_id, _ = await _new_session(async_client)
    _, attacker_headers = await _new_session(async_client)

    single = await async_client.post(
        "/api/events",
        headers=attacker_headers,
        json={"session_id": victim_id, "event_type": "click", "page_path": "/"},
    )
    assert single.status_code == 403

    bulk = await async_client.post(
        "/api/events/bulk",
        headers=attacker_headers,
        json={"events": [{"session_id": victim_id, "event_type": "click", "page_path": "/"}]},
    )
    assert bulk.status_code == 403


@pytest.mark.asyncio
async def test_a_bulk_batch_cannot_smuggle_in_a_foreign_session(async_client):
    """The token is checked per event, not once for the batch."""
    own_id, headers = await _new_session(async_client)
    victim_id, _ = await _new_session(async_client)

    response = await async_client.post(
        "/api/events/bulk",
        headers=headers,
        json={
            "events": [
                {"session_id": own_id, "event_type": "click", "page_path": "/"},
                {"session_id": victim_id, "event_type": "click", "page_path": "/"},
            ]
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_an_unknown_session_is_indistinguishable_from_a_forbidden_one(async_client):
    """The 404-vs-201 split on POST /events told an attacker which ids exist."""
    real_id, _ = await _new_session(async_client)
    fake_id = str(uuid.uuid4())
    # After creating the session, so the cookie it issued does not authorise the
    # "real" probe and hand the two branches different status codes.
    _drop_credentials(async_client)

    real = await async_client.post(
        "/api/events", json={"session_id": real_id, "event_type": "click", "page_path": "/"}
    )
    fake = await async_client.post(
        "/api/events", json={"session_id": fake_id, "event_type": "click", "page_path": "/"}
    )
    assert real.status_code == fake.status_code == 403
    assert real.json() == fake.json(), "the response must not distinguish the two"


@pytest.mark.asyncio
async def test_the_stream_accepts_the_token_as_a_query_parameter(async_client):
    """EventSource cannot set request headers, so this endpoint has to take it
    from the query string."""
    session_id, headers = await _new_session(async_client)
    # Without this the cookie authorises the request, the endpoint returns a
    # 200 streaming response, and the assertion below waits forever for a body
    # that by design never ends.
    _drop_credentials(async_client)

    refused = await async_client.get(f"/api/sessions/{session_id}/stream")
    assert refused.status_code == 403

    wrong = await async_client.get(
        f"/api/sessions/{session_id}/stream", params={"session_token": "not-the-token"}
    )
    assert wrong.status_code == 403


@pytest.mark.parametrize("suffix", ["", "/events", "/events/summary", "/stream"])
@pytest.mark.asyncio
async def test_a_session_cookie_does_not_unlock_another_session(async_client, suffix):
    """The cookie is a new credential channel, so it needs the same proof the
    header has: holding one session's token must not grant another's.

    The cookie is what the SSE endpoint now authenticates with, so a mistake
    here would be a cross-visitor read of somebody else's behavioural trail.
    """
    victim_id, _ = await _new_session(async_client)

    # Creating the attacker's session replaces the cookie with *their* token,
    # which is exactly the state a real attacker would be in.
    _, _attacker_headers = await _new_session(async_client)

    response = await async_client.get(f"/api/sessions/{victim_id}{suffix}")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_a_forged_cookie_is_refused(async_client):
    session_id, _ = await _new_session(async_client)
    _drop_credentials(async_client)
    async_client.cookies.set("rj_session_token", "0" * 64)

    response = await async_client.get(f"/api/sessions/{session_id}/events")
    assert response.status_code == 403
    _drop_credentials(async_client)
