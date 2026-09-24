"""Guards for defences that existed in the tree but were not actually wired in.

Each test here corresponds to something that was implemented, imported by
nothing, and therefore inert at runtime.
"""

import asyncio
import os

import pytest

from server.config import bedrock as bedrock_config
from server.config import settings
from server.middlewares.body_size import BodySizeLimitMiddleware
from server.middlewares.rate_limit import (
    AUTH_RATE_LIMITED_PATHS,
    CHAT_RATE_LIMITED_PATHS,
    RateLimitMiddleware,
    _normalise_path,
    _rate_bucket,
)
from server.middlewares.request_id import RequestIDMiddleware
from server.middlewares.server_timing import ServerTimingMiddleware
from server.utils.ip_utils import client_ip_from_request, is_trusted_proxy


def _request(client_host: str, forwarded: str = ""):
    """A minimal ASGI request for the client-IP resolver."""
    from fastapi import Request

    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": headers,
        "client": (client_host, 51000),
    })


async def _send(limiter: RateLimitMiddleware, client_ip: str, path: str = "/sessions") -> int:
    """Drives one request through the real middleware and returns its status.

    Not a reimplementation of the limiter's accounting - that would assert
    nothing about the code under test. `TESTING` is unset for the call because
    the middleware short-circuits entirely under it.
    """
    sent: list[dict] = []

    async def _capture(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [],
        "client": (client_ip, 51000),
    }
    previous = os.environ.pop("TESTING", None)
    try:
        await limiter(scope, _receive_nothing, _capture)
    finally:
        if previous is not None:
            os.environ["TESTING"] = previous
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


async def _receive_nothing():
    return {"type": "http.request", "body": b"", "more_body": False}


async def _downstream(scope, receive, send):
    """Stands in for the rest of the app: always 200."""
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b""})


# --- middleware registration ------------------------------------------------


def test_every_middleware_is_registered_on_the_app():
    """The limiter, the body cap and the request-ID tagger were all written and
    then never added to the app, leaving the API unthrottled, uncapped and
    logging `request_id=unknown` on every line."""
    from server.main import app

    installed = [m.cls for m in app.user_middleware]
    for cls in (
        RateLimitMiddleware,
        BodySizeLimitMiddleware,
        RequestIDMiddleware,
        ServerTimingMiddleware,
    ):
        assert cls in installed, f"{cls.__name__} is not registered"


def test_request_id_is_the_outermost_layer():
    """`add_middleware` prepends, so index 0 runs first at request time. The
    tagger has to be outermost for a 429 or 413 to carry a correlation id."""
    from server.main import app

    assert app.user_middleware[0].cls is RequestIDMiddleware


def test_cors_origins_come_from_settings_not_a_hardcoded_list():
    from server.main import app
    from fastapi.middleware.cors import CORSMiddleware

    cors = next(m for m in app.user_middleware if m.cls is CORSMiddleware)
    assert cors.kwargs["allow_origins"] is settings.origins
    assert "https://rjasti.com" in settings.origins


# --- rate limiter path matching ---------------------------------------------


@pytest.mark.parametrize(
    "path",
    ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password"],
)
def test_auth_routes_are_strict_limited_under_both_mount_prefixes(path):
    """Every router is mounted at `/x` and `/api/x`. Matching the raw path meant
    `/api/auth/login` skipped the 5/min budget and got the general 60/min one,
    so the brute-force guard came off by adding four characters to the URL."""
    assert _normalise_path(path) in AUTH_RATE_LIMITED_PATHS
    assert _normalise_path(f"/api{path}") in AUTH_RATE_LIMITED_PATHS


@pytest.mark.parametrize(
    "path", ["/auth/change-password", "/auth/delete-account", "/auth/account"]
)
def test_re_authentication_routes_are_strict_limited_under_both_mount_prefixes(path):
    """Each checks the current password. On the general budget, a stolen
    access token could guess at about a thousand a minute."""
    assert _normalise_path(path) in AUTH_RATE_LIMITED_PATHS
    assert _normalise_path(f"/api{path}") in AUTH_RATE_LIMITED_PATHS


@pytest.mark.parametrize(
    "address, bucket",
    [
        ("2001:db8::1", "2001:db8::/64"),
        ("2001:db8::ffff:1", "2001:db8::/64"),
        ("2001:db8:0:1::1", "2001:db8:0:1::/64"),
        ("::ffff:192.0.2.1", "192.0.2.1"),
        ("192.0.2.1", "192.0.2.1"),
        ("unknown", "unknown"),
    ],
)
def test_rate_buckets_key_ipv6_on_the_64(address, bucket):
    """One ordinary IPv6 allocation is a /64. Keyed on the full address, it
    handed an attacker 2^64 separate 5/min auth budgets."""
    assert _rate_bucket(address) == bucket


@pytest.mark.asyncio
async def test_addresses_in_one_ipv6_64_share_the_auth_budget():
    limiter = RateLimitMiddleware(app=_downstream, max_requests=1000)

    for suffix in range(1, 6):
        assert await _send(limiter, f"2001:db8::{suffix}", "/auth/login") == 200
    assert await _send(limiter, "2001:db8::99", "/auth/login") == 429, (
        "a fresh address in the same /64 must not get a fresh budget"
    )
    assert await _send(limiter, "2001:db8:0:1::1", "/auth/login") == 200


@pytest.mark.asyncio
async def test_server_timing_is_left_off_the_auth_routes(async_client):
    """The header is exposed cross-origin. On login and registration a
    millisecond-accurate handler time is what an enumeration attack measures."""
    for path in ("/auth/login", "/api/auth/login"):
        response = await async_client.post(path, json={"email": "a@example.com", "password": "x"})
        assert "server-timing" not in response.headers, path
    assert "server-timing" in (await async_client.get("/api/health")).headers


def test_code_driven_login_surfaces_are_strict_limited():
    """Both hand out a session off a guessable secret."""
    assert "/auth/2fa/verify" in AUTH_RATE_LIMITED_PATHS
    assert "/auth/magic-link/request" in AUTH_RATE_LIMITED_PATHS


def test_second_factor_changes_are_strict_limited():
    """Both check a password and six digits, so both are guessing surfaces even
    behind `get_current_user` - an access token is not a password. Setup stays
    off the list on purpose: it guesses nothing, and the budget is shared."""
    assert "/auth/2fa/enable" in AUTH_RATE_LIMITED_PATHS
    assert "/auth/2fa/disable" in AUTH_RATE_LIMITED_PATHS
    assert "/auth/2fa/setup" not in AUTH_RATE_LIMITED_PATHS


@pytest.mark.parametrize(
    "path, expected",
    [("/api/events", "/events"), ("/events", "/events"), ("/api", "/"), ("/apiary", "/apiary")],
)
def test_normalise_path_only_strips_a_real_api_prefix(path, expected):
    assert _normalise_path(path) == expected


def test_non_auth_routes_stay_on_the_general_budget():
    assert _normalise_path("/api/events/bulk") not in AUTH_RATE_LIMITED_PATHS
    assert _normalise_path("/api/events/bulk") not in CHAT_RATE_LIMITED_PATHS


@pytest.mark.parametrize(
    "path", ["/chat", "/chat/", "/chat/stream", "/chat/summarize"]
)
def test_chat_routes_are_on_their_own_budget_under_both_prefixes(path):
    """Bedrock inference sat on the general 60/min budget.

    It is the only endpoint that spends money per call and it takes no
    authentication, so the general limit let one IP drive sixty inference
    requests a minute indefinitely.
    """
    assert _normalise_path(path) in CHAT_RATE_LIMITED_PATHS
    assert _normalise_path(f"/api{path}") in CHAT_RATE_LIMITED_PATHS


def test_chat_budget_is_stricter_than_the_general_one():
    limiter = RateLimitMiddleware(app=None)
    assert settings.CHAT_RATE_LIMIT_PER_MINUTE < limiter.max_requests


def test_the_general_budget_is_configurable_and_defaults_to_1000():
    """It was a hardcoded constructor default of 60, which the activity
    dashboard alone could exhaust in a few refreshes - one load fires the
    session create or heartbeat, a bulk flush, three `/sessions/{id}/…` reads
    and the SSE stream, then a flush and an end call on unload."""
    assert settings.RATE_LIMIT_PER_MINUTE == 1000
    assert RateLimitMiddleware(app=None).max_requests == 1000


@pytest.mark.asyncio
async def test_the_general_budget_is_not_shared_between_clients():
    """The bucket key is the client IP, so one visitor cannot exhaust another's
    budget. This is the property `TRUSTED_PROXY_IPS` has to make real: without
    it every request behind the proxy resolves to the same address and all of
    these buckets collapse into one."""
    limiter = RateLimitMiddleware(app=_downstream, max_requests=3)

    for _ in range(3):
        assert await _send(limiter, "203.0.113.7") == 200
    assert await _send(limiter, "203.0.113.7") == 429, "the noisy client is capped"

    # A different client is untouched by that.
    assert await _send(limiter, "198.51.100.4") == 200


@pytest.mark.asyncio
async def test_the_general_budget_actually_admits_its_configured_number():
    """A ceiling nothing exercises is a number in a settings file. At the old
    60 the activity dashboard reached it in a few refreshes."""
    limiter = RateLimitMiddleware(app=_downstream, max_requests=settings.RATE_LIMIT_PER_MINUTE)

    for _ in range(settings.RATE_LIMIT_PER_MINUTE):
        assert await _send(limiter, "203.0.113.7") == 200
    assert await _send(limiter, "203.0.113.7") == 429


@pytest.mark.asyncio
async def test_the_raised_general_budget_does_not_apply_to_chat():
    """`/chat/stream` must stay on its own 12/min however high the general
    number goes - it is the only endpoint that spends money per call."""
    limiter = RateLimitMiddleware(app=_downstream, max_requests=1000)

    for _ in range(settings.CHAT_RATE_LIMIT_PER_MINUTE):
        assert await _send(limiter, "203.0.113.7", "/chat/stream") == 200
    assert await _send(limiter, "203.0.113.7", "/chat/stream") == 429

    # The general bucket is untouched by that traffic.
    assert await _send(limiter, "203.0.113.7", "/sessions") == 200


@pytest.mark.asyncio
async def test_the_raised_general_budget_does_not_apply_to_auth():
    """Five attempts a minute is the brute-force guard on /auth/login."""
    limiter = RateLimitMiddleware(app=_downstream, max_requests=1000)

    for _ in range(5):
        assert await _send(limiter, "203.0.113.7", "/auth/login") == 200
    assert await _send(limiter, "203.0.113.7", "/auth/login") == 429


def test_trusted_proxies_default_to_loopback_so_buckets_are_per_visitor():
    """Empty was the old default, and it made `client_ip_from_request` fall
    back to the direct peer - the loopback address for every visitor behind
    Apache, so the whole site shared one bucket and a couple of hard refreshes
    returned 429 for everyone."""
    assert settings.TRUSTED_PROXY_NETWORKS, "an empty list means one bucket for the whole site"
    assert is_trusted_proxy("127.0.0.1", settings.TRUSTED_PROXY_NETWORKS)
    assert is_trusted_proxy("::1", settings.TRUSTED_PROXY_NETWORKS)
    # And only the local proxy: an API reachable directly still ignores the
    # header, so a remote caller cannot choose its own bucket.
    assert not is_trusted_proxy("203.0.113.7", settings.TRUSTED_PROXY_NETWORKS)


def test_a_remote_caller_cannot_pick_its_own_bucket_by_forging_the_header():
    forged = _request(client_host="203.0.113.7", forwarded="10.0.0.1")
    assert client_ip_from_request(forged, settings.TRUSTED_PROXY_NETWORKS) == "203.0.113.7"

    # Arriving through the local proxy, the header is what identifies the client.
    proxied = _request(client_host="127.0.0.1", forwarded="203.0.113.9")
    assert client_ip_from_request(proxied, settings.TRUSTED_PROXY_NETWORKS) == "203.0.113.9"


def test_raising_the_general_budget_did_not_loosen_the_strict_ones():
    """Chat is the only endpoint that spends money per call, auth is the
    brute-force surface, and contact sends mail. None of them may drift up with
    the general number."""
    limiter = RateLimitMiddleware(app=None)
    assert settings.CHAT_RATE_LIMIT_PER_MINUTE == 12
    assert settings.CONTACT_RATE_LIMIT_PER_HOUR == 5
    assert settings.CHAT_RATE_LIMIT_PER_MINUTE < limiter.max_requests
    assert settings.CONTACT_RATE_LIMIT_PER_HOUR < limiter.max_requests


def test_chat_and_auth_budgets_are_tracked_separately():
    """Chat traffic must not be able to exhaust the login budget, or vice versa."""
    limiter = RateLimitMiddleware(app=None)
    assert limiter._chat_hits is not limiter._auth_hits
    assert limiter._chat_hits is not limiter._hits


# --- required signing key ---------------------------------------------------


def test_required_secret_rejects_the_published_placeholder(monkeypatch):
    """The old fallback is in public repo history, so anything signed with it
    is forgeable by anyone who can read the source."""
    monkeypatch.setenv("PROBE_SECRET", settings._LEGACY_JWT_SECRET)
    with pytest.raises(RuntimeError, match="placeholder"):
        settings._required_secret("PROBE_SECRET")


def test_required_secret_rejects_a_short_key(monkeypatch):
    monkeypatch.setenv("PROBE_SECRET", "tooshort")
    with pytest.raises(RuntimeError, match="at least"):
        settings._required_secret("PROBE_SECRET")


def test_required_secret_rejects_an_unset_key(monkeypatch):
    monkeypatch.delenv("PROBE_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="must be set"):
        settings._required_secret("PROBE_SECRET")


def test_required_secret_accepts_a_generated_key(monkeypatch):
    import secrets

    key = secrets.token_hex(32)
    monkeypatch.setenv("PROBE_SECRET", key)
    assert settings._required_secret("PROBE_SECRET") == key


@pytest.mark.parametrize(
    "value",
    [
        "replace-me-with-openssl-rand-hex-32",  # what .env.example used to ship
        "CHANGE-ME-before-deploying-this-to-production",
        "changeme" * 5,
    ],
)
def test_required_secret_rejects_a_placeholder_shape(monkeypatch, value):
    """`.env.example`'s placeholder was 35 characters and passed the length
    check, so a `.env` copied as-is started with a key anyone could read."""
    monkeypatch.setenv("PROBE_SECRET", value)
    with pytest.raises(RuntimeError, match="placeholder"):
        settings._required_secret("PROBE_SECRET")


@pytest.mark.parametrize("value", ["a" * 64, "ab" * 32, "qwertyui" * 5])
def test_required_secret_rejects_a_key_that_is_not_random(monkeypatch, value):
    monkeypatch.setenv("PROBE_SECRET", value)
    with pytest.raises(RuntimeError, match="distinct"):
        settings._required_secret("PROBE_SECRET")


def test_the_example_env_leaves_the_signing_key_empty():
    """So a copied `.env` refuses to start rather than starting with a public key."""
    from pathlib import Path

    example = Path(__file__).resolve().parents[3] / ".env.example"
    lines = [line for line in example.read_text().splitlines() if line.startswith("JWT_SECRET=")]
    assert lines == ["JWT_SECRET="]


def test_security_module_has_no_default_signing_key():
    import inspect

    from server.auth import security

    assert settings._LEGACY_JWT_SECRET not in inspect.getsource(security)
    assert security.JWT_SECRET is settings.JWT_SECRET


# --- Bedrock concurrency slot ------------------------------------------------


@pytest.mark.asyncio
async def test_slot_release_is_idempotent():
    """Release is driven from both the generator's `finally` and the response's
    background task, so the second call has to be a no-op rather than handing
    back a slot that was never held."""
    start = bedrock_config.bedrock_semaphore._value
    slot = await bedrock_config.acquire_bedrock_slot()
    assert bedrock_config.bedrock_semaphore._value == start - 1

    await slot.release()
    await slot.release()
    await slot.release()

    assert bedrock_config.bedrock_semaphore._value == start
    assert slot.released is True


@pytest.mark.asyncio
async def test_an_abandoned_streaming_response_does_not_leak_its_slot():
    """Reproduces the leak: the handler takes a slot, then the client vanishes
    before Starlette iterates the body, so the generator's `finally` never runs.
    Four of those used to pin the semaphore at zero for the life of the process
    and chat answered 429 forever."""
    start = bedrock_config.bedrock_semaphore._value

    for _ in range(start + 1):
        slot = await bedrock_config.acquire_bedrock_slot()

        async def body(held=slot):  # bound now, not at call time
            try:
                yield "chunk"
            finally:
                await held.release()

        generator = body()
        del generator  # client gone; the body is never started

        # Starlette still runs the response's background task.
        await slot.release()

    assert bedrock_config.bedrock_semaphore._value == start, "slots were leaked"
    assert not bedrock_config.bedrock_semaphore.locked()


@pytest.mark.asyncio
async def test_slot_acquisition_refuses_when_saturated():
    held = []
    try:
        while not bedrock_config.bedrock_semaphore.locked():
            held.append(await bedrock_config.acquire_bedrock_slot())

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as excinfo:
            await bedrock_config.acquire_bedrock_slot("busy")
        assert excinfo.value.status_code == 429
    finally:
        await asyncio.gather(*(slot.release() for slot in held))


# --- dual-prefix mounting ---------------------------------------------------


@pytest.mark.asyncio
async def test_both_mount_prefixes_still_route(async_client):
    """Every router is mounted at `/x` and at `/api/x`. Which one production
    actually uses depends on whether Apache strips the prefix before proxying,
    so dropping either would risk an outage. The root copy is hidden from the
    OpenAPI schema, which must not change routing - asserted over real requests
    rather than by walking the route table, which nests included routers.
    """
    for path in ("/health", "/api/health"):
        assert (await async_client.get(path)).status_code == 200, f"{path} stopped routing"

    for path in ("/sessions", "/api/sessions"):
        response = await async_client.post(
            path, json={"user_agent": "pytest", "device_type": "desktop"}
        )
        assert response.status_code == 201, f"{path} stopped routing"

    # A path that exists under neither mount still 404s, so the check above is
    # not simply passing on a catch-all.
    assert (await async_client.get("/api/definitely-not-a-route")).status_code == 404


def test_only_one_copy_of_each_route_is_documented():
    """The duplicate mount made /openapi.json advertise 66 paths for 33
    endpoints and made FastAPI warn about duplicate operation ids on boot."""
    from server.main import app

    documented = app.openapi()["paths"]
    assert not any(p.startswith("/auth/") for p in documented), "root mount leaked into the schema"
    assert "/api/auth/login" in documented


# --- Bedrock client configuration (BUG-09) ----------------------------------


def test_the_chat_client_carries_the_configured_timeouts():
    """The streaming path built its own client with no Config at all.

    config/bedrock.py assembled a properly tuned client that nothing imported,
    so chat ran on botocore defaults - a 60s read timeout instead of
    BEDROCK_TIMEOUT_SECONDS - and a hung connection held one of the
    CHAT_MAX_CONCURRENCY slots for a minute rather than thirty seconds.
    """
    from server.services.bedrock_service import bedrock_service

    config = bedrock_service.client.meta.config
    assert config.read_timeout == settings.BEDROCK_TIMEOUT_SECONDS
    assert config.connect_timeout == 10
    # botocore normalises max_attempts=2 (retries) into total_max_attempts=3
    # (the initial call plus two retries).
    assert config.retries["mode"] == "standard"
    assert config.retries["total_max_attempts"] == 3


def test_the_chat_client_is_the_shared_configured_one():
    from server.config.bedrock import bedrock_runtime
    from server.services.bedrock_service import bedrock_service

    assert bedrock_service.client is bedrock_runtime


def test_stream_queue_settings_are_actually_used():
    """Both were defined, validated and documented while the module hardcoded
    its own values, so two documented env vars turned nothing."""
    from server.services import bedrock_service as svc

    assert svc._STREAM_QUEUE_SIZE == settings.CHAT_STREAM_QUEUE_SIZE
    assert svc._QUEUE_PUT_TIMEOUT_SECONDS == settings.BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS


# --- Concurrent SSE streams (SEC-04) ----------------------------------------


@pytest.mark.asyncio
async def test_a_session_cannot_hold_unlimited_sse_streams():
    """An SSE connection is one request that then stays open indefinitely.

    CHAT_MAX_CONCURRENCY covers Bedrock and the rate limiter counts requests,
    but neither bounds this. A session token costs one unauthenticated POST.
    """
    import uuid as _uuid

    from server.services import kafka_stream

    session_id = _uuid.uuid4()
    opened = []
    try:
        for _ in range(settings.MAX_STREAMS_PER_SESSION):
            opened.append(await kafka_stream.register_stream(session_id))

        with pytest.raises(kafka_stream.TooManyStreams):
            await kafka_stream.register_stream(session_id)
    finally:
        for queue in opened:
            kafka_stream.unregister_stream(session_id, queue)


@pytest.mark.asyncio
async def test_closing_a_stream_frees_the_slot():
    import uuid as _uuid

    from server.services import kafka_stream

    session_id = _uuid.uuid4()
    first = await kafka_stream.register_stream(session_id)
    kafka_stream.unregister_stream(session_id, first)

    # Reusable, otherwise a visitor who reloads a few times locks themselves out.
    again = await kafka_stream.register_stream(session_id)
    kafka_stream.unregister_stream(session_id, again)


@pytest.mark.asyncio
async def test_the_model_inventory_route_is_gone(async_client):
    """`GET /models` was anonymous, called by nothing in the frontend, and drove
    Bedrock's `ListFoundationModels` at the general budget - spending the
    account's control-plane quota and publishing its model inventory to anyone.
    """
    for path in ("/models", "/api/models"):
        assert (await async_client.get(path)).status_code == 404, f"{path} still routes"
    assert not hasattr(bedrock_config, "bedrock_mgmt")


# --- repository hygiene ---------------------------------------------------


@pytest.mark.parametrize(
    "path, ignored",
    [
        (".env", True),
        (".env.production", True),
        (".env.staging.local", True),
        ("id_rsa", True),
        ("id_ed25519.pub", True),
        ("deploy.pem", True),
        ("server/tls.key", True),
        (".env.example", False),
    ],
)
def test_secrets_cannot_be_committed_by_accident(path, ignored):
    """Only `.env` and `.env.local` were ignored, so `.env.production` or an SSH
    key dropped in the tree would have been committed. The deploy's rsync
    already excluded `.env*`, which says those variants exist."""
    import subprocess
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        ["git", "check-ignore", "--quiet", "--no-index", path], cwd=root, check=False
    )
    assert (result.returncode == 0) is ignored, f"{path}: expected ignored={ignored}"
