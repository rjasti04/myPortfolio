"""Asserts every endpoint the deployed frontend calls exists on the backend.

The frontend is a static bundle talking to this API over a hardcoded base URL,
so nothing but a running browser ever checked that the two agree. Three routes
had silently drifted apart:

  POST /auth/logout                  - no route at all, and auth.js discards the
                                       failure, so a "logged out" refresh token
                                       stayed valid for its full 30-day life
  POST /auth/sessions/revoke-others  - no route; the service function existed
  POST /auth/delete-account          - the API only served DELETE /auth/account

Path coverage is the assertion that matters here. Method detection from static
JavaScript is heuristic (the nearest `method:` literal to a call site), so it is
reported for context but only enforced where it can be determined unambiguously.
"""

import os
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
FRONTEND_JS = sorted((REPO / "frontend" / "js").glob("*.js"))

# The frontend pins this prefix in analytics.js; every call is built from it.
API_PREFIX = "/api"


def _normalise(path: str) -> str:
    """`/sessions/${id}/events` -> `/sessions/{}/events`, query string dropped."""
    path = path.split("?")[0]
    path = re.sub(r"\$\{[^}]+\}", "{}", path)
    return path.rstrip("/") or "/"


def _frontend_endpoints() -> dict[str, set[str]]:
    """Every `${API_BASE}/...` template literal, mapped to the files using it."""
    found: dict[str, set[str]] = {}
    for js in FRONTEND_JS:
        for match in re.finditer(r"`\$\{API_BASE\}(/[^`]*)`", js.read_text(encoding="utf-8")):
            found.setdefault(_normalise(match.group(1)), set()).add(js.name)
    return found


def _backend_paths(app) -> set[str]:
    return {re.sub(r"\{[^}]+\}", "{}", path) for path in app.openapi()["paths"]}


@pytest.fixture(scope="module")
def app():
    os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-not-for-any-real-deployment")
    from server.main import app as fastapi_app

    return fastapi_app


def test_the_frontend_actually_calls_the_api():
    """Guards the extraction itself: a refactor that renames API_BASE would
    otherwise turn every assertion below into a vacuous pass."""
    endpoints = _frontend_endpoints()
    assert len(endpoints) >= 20, (
        f"only found {len(endpoints)} frontend endpoints; the API_BASE template "
        "pattern probably changed and this contract test has gone blind"
    )


def test_every_frontend_endpoint_exists_on_the_backend(app):
    backend = _backend_paths(app)
    missing = {
        path: sorted(files)
        for path, files in _frontend_endpoints().items()
        if API_PREFIX + path not in backend
    }
    assert missing == {}, (
        "the frontend calls endpoints the API does not serve: "
        + "; ".join(f"{p} (from {', '.join(f)})" for p, f in sorted(missing.items()))
    )


@pytest.mark.parametrize(
    "path",
    [
        "/auth/logout",
        "/auth/sessions/revoke-others",
        "/auth/delete-account",
    ],
)
def test_previously_missing_routes_are_served(app, path):
    """Explicit cases, so a regression names the exact route rather than
    appearing as one entry in a set difference."""
    assert API_PREFIX + path in _backend_paths(app)


def test_logout_revokes_tokens_rather_than_only_clearing_the_client(app):
    """auth.js wraps its logout call in `catch(e){}`, so a missing or broken
    route is invisible from the UI - the user appears logged out while their
    refresh token stays valid. Assert the route reaches the revoking service."""
    import inspect

    from server.routes import auth_routes

    source = inspect.getsource(auth_routes)
    logout = source.split("/logout")[1].split("@router")[0]
    assert "logout_user" in logout, "the logout route must delegate to auth_service.logout_user"

    from server.services import auth_service

    assert "revoke_user_tokens" in inspect.getsource(auth_service.logout_user)
