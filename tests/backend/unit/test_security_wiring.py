"""Guards for defences that existed in the tree but were not actually wired in.

Each test here corresponds to something that was implemented, imported by
nothing, and therefore inert at runtime.
"""

import asyncio

import pytest

from server.config import bedrock as bedrock_config
from server.config import settings
from server.middlewares.body_size import BodySizeLimitMiddleware
from server.middlewares.rate_limit import (
    AUTH_RATE_LIMITED_PATHS,
    CHAT_RATE_LIMITED_PATHS,
    RateLimitMiddleware,
    _normalise_path,
)
from server.middlewares.request_id import RequestIDMiddleware
from server.middlewares.server_timing import ServerTimingMiddleware


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


def test_code_driven_login_surfaces_are_strict_limited():
    """Both hand out a session off a guessable secret."""
    assert "/auth/2fa/verify" in AUTH_RATE_LIMITED_PATHS
    assert "/auth/magic-link/request" in AUTH_RATE_LIMITED_PATHS


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
    monkeypatch.setenv("PROBE_SECRET", "a" * settings.JWT_SECRET_MIN_LENGTH)
    assert settings._required_secret("PROBE_SECRET") == "a" * settings.JWT_SECRET_MIN_LENGTH


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
