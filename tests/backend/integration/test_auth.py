"""Endpoint coverage for the auth surface.

This file was previously empty, which is how five routes shipped calling
`auth_service` functions that do not exist: `pytest` stayed green while
/auth/change-password, /auth/reset-password, /auth/account and both
/auth/sessions routes returned 500 to every caller. The happy-path tests below
exist mainly so that class of wiring break cannot pass CI again.
"""

import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyotp
import pytest
from sqlalchemy import update
from unittest.mock import patch

from server.routes import auth_routes
from server.services import auth_service
from tests.backend.helpers import (
    SENT_VERIFICATION_TOKENS,
    register_verified_account,
    verify_registered_email,
)


ROOT = Path(__file__).resolve().parents[3]


def _email() -> str:
    """Unique address per call - the suite shares one session-scoped database."""
    return f"user-{uuid.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
def offline_side_effects(monkeypatch):
    """Keep auth flows off the network.

    `change_user_password` and `reset_password_with_token` both call Have I Been
    Pwned, and the mail helpers open an SMTP connection from a background task.
    Unpatched, the suite depends on outbound network and on HIBP being up.
    """
    async def _not_breached(_password: str) -> bool:
        return False

    async def _noop(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(auth_service, "check_password_breached", _not_breached)
    monkeypatch.setattr(auth_service, "send_security_notification_email", _noop)
    monkeypatch.setattr(auth_service, "send_magic_link_email", _noop)
    monkeypatch.setattr(auth_service, "send_existing_account_email", _noop)


# The clock `consume_totp` checks codes against, owned by the test. A code is
# single-use within its 30-second step, so a test that enables 2FA and then
# signs in needs two steps - which real time would make it wait for.
_TOTP_CLOCK = [0.0]


@pytest.fixture(autouse=True)
def totp_clock(monkeypatch):
    _TOTP_CLOCK[0] = float((int(time.time()) // 30) * 30 + 1)
    monkeypatch.setattr(auth_service, "_totp_time", lambda: _TOTP_CLOCK[0])
    return _TOTP_CLOCK


async def _register(async_client, password="Str0ngPassw0rd!"):
    """Register and confirm the address.

    Login refuses an unconfirmed address, so every test below needs a verified
    account. The confirmation goes through the real endpoint with the token the
    real mail helper was handed - see conftest.register_verified_account.
    """
    return await register_verified_account(async_client, _email(), password)


async def _login(async_client, email, password):
    response = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _auth_header(async_client, email, password):
    return {"Authorization": f"Bearer {(await _login(async_client, email, password))['access_token']}"}


def _totp_now(secret):
    """The code for the *next* 30-second step, with the server's clock moved there.

    Every call is a fresh step, because the server refuses a code for a step it
    has already accepted (RFC 6238 §5.2). The clock is the test's, so there is
    no boundary race either: `TOTP.now()` taken near the end of a real step
    used to expire before the server's `verify()` ran.
    """
    _TOTP_CLOCK[0] += 30
    return _totp_current(secret)


def _totp_current(secret):
    """The code for the step the server's clock is in now, without moving it."""
    return pyotp.TOTP(secret).at(int(_TOTP_CLOCK[0]))


async def _auth_header_2fa(async_client, email, password, secret):
    """A bearer token for an account that already has 2FA on.

    `_auth_header` cannot serve one: password login on an enrolled account
    returns a challenge rather than a token pair, so the second factor has to be
    walked through to get an access token at all.
    """
    challenge = await _login(async_client, email, password)
    assert challenge["requires_2fa"] is True
    verified = await async_client.post(
        "/api/auth/2fa/verify",
        json={
            "pre_auth_token": challenge["pre_auth_token"],
            "code": _totp_now(secret),
        },
    )
    assert verified.status_code == 200, verified.text
    return {"Authorization": f"Bearer {verified.json()['access_token']}"}


def _assert_login_refused(response):
    """A locked account answers exactly as a wrong password or an unknown
    address does. "Account is temporarily locked" confirmed that an address
    had an account, because only real accounts can lock."""
    assert response.status_code == 401, response.text
    assert response.json()["detail"] == auth_service.LOGIN_FAILED_DETAIL


async def _second_factor_refused_while_locked(async_client, email, password, secret):
    """The code tally is locked: a correct password still yields a challenge -
    the password tally is separate - and a *correct* code is refused."""
    challenge = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert challenge.status_code == 200, challenge.text
    assert challenge.json()["requires_2fa"] is True
    refused = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": challenge.json()["pre_auth_token"], "code": _totp_now(secret)},
    )
    assert refused.status_code == 400
    assert "locked" in refused.text.lower()


# --- wiring ----------------------------------------------------------------


def test_every_auth_service_call_in_the_router_resolves():
    """Generalised guard for the bug this file was written to catch.

    `auth_routes` reaches into `auth_service` by attribute, so a renamed
    service function fails at request time rather than import time. Five of
    them were wrong simultaneously.
    """
    source = __import__("inspect").getsource(auth_routes)
    referenced = sorted(set(re.findall(r"auth_service\.([a-z_0-9]+)", source)))

    assert referenced, "expected the router to delegate to auth_service"
    missing = [name for name in referenced if not hasattr(auth_service, name)]
    assert missing == [], f"auth_routes calls non-existent auth_service functions: {missing}"


# --- registration and login ------------------------------------------------


@pytest.mark.asyncio
async def test_registration_answers_the_same_whether_or_not_the_address_has_an_account(
    async_client, monkeypatch
):
    """"Email already registered" told anyone which addresses have accounts - an
    oracle the enumeration table in docs/SECURITY.md never listed. Both answers
    are now the same 202 and the same body; the difference goes to the inbox."""
    reminded: list[str] = []

    async def _capture(email: str) -> None:
        reminded.append(email)

    monkeypatch.setattr(auth_service, "send_existing_account_email", _capture)

    email, _ = await _register(async_client)
    SENT_VERIFICATION_TOKENS.pop(email, None)

    existing = await async_client.post(
        "/api/auth/register", json={"email": email, "password": "An0therPassw0rd!"}
    )
    fresh = await async_client.post(
        "/api/auth/register", json={"email": _email(), "password": "Str0ngPassw0rd!"}
    )

    assert existing.status_code == fresh.status_code == 202
    assert existing.content == fresh.content
    assert reminded == [email], "the existing address is told, by mail"
    assert email not in SENT_VERIFICATION_TOKENS, "and is not sent a second verification link"

    # And it created nothing: the original password still signs in.
    login = await async_client.post(
        "/api/auth/login", json={"email": email, "password": "Str0ngPassw0rd!"}
    )
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_registration_costs_one_hash_whether_or_not_the_address_has_an_account(async_client):
    """Same body is not enough if the response time differs: the new-address
    path hashes the password, so the existing-address path has to as well."""
    email, _ = await _register(async_client)

    with patch.object(auth_service, "get_password_hash", wraps=auth_service.get_password_hash) as spy:
        await async_client.post(
            "/api/auth/register", json={"email": email, "password": "Str0ngPassw0rd!"}
        )
        existing_hashes = spy.call_count
        spy.reset_mock()
        await async_client.post(
            "/api/auth/register", json={"email": _email(), "password": "Str0ngPassw0rd!"}
        )
        fresh_hashes = spy.call_count

    assert existing_hashes == fresh_hashes == 1


@pytest.mark.asyncio
async def test_a_fresh_registration_cannot_log_in_until_it_is_confirmed(async_client):
    """The contract `auth.js` has to respect.

    `registerUser()` used to call `loginUser()` straight after a 201 - correct
    when registration handed back a usable account, but every registration now
    creates an unconfirmed one, so that login could never succeed. The browser
    painted the 403 into the register form's *error* slot and suppressed every
    success signal, telling the visitor registration had failed when it had
    not. Pinned here so the client-side flow cannot drift back.
    """
    email = _email()
    password = "Str0ngPassw0rd!"

    created = await async_client.post(
        "/api/auth/register", json={"email": email, "password": password}
    )
    assert created.status_code == 202, created.text

    refused = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert refused.status_code == 403, "an unconfirmed address must not get a token pair"
    assert "confirm" in refused.json()["detail"].lower()

    # And the confirmation is the only thing standing in the way.
    await verify_registered_email(async_client, email)
    allowed = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert allowed.status_code == 200
    assert allowed.json()["access_token"]


@pytest.mark.asyncio
async def test_a_token_naming_a_purged_account_is_401_not_404(async_client):
    """`get_current_user` answered 404 for a well-formed token whose user row
    was gone, which reads to a client as "no such endpoint" rather than "this
    credential is dead" - so the browser kept a stale token forever. Every
    other path in the codebase answers 401 for this, `refresh_user_token`
    included."""
    from server.auth.security import create_access_token

    orphan = create_access_token(subject=str(uuid.uuid4()))
    response = await async_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {orphan}"}
    )
    assert response.status_code == 401, response.text
    assert response.headers.get("www-authenticate") == "Bearer"


@pytest.mark.asyncio
async def test_login_issues_a_token_pair(async_client):
    email, password = await _register(async_client)
    body = await _login(async_client, email, password)
    assert body["requires_2fa"] is False
    assert body["access_token"] and body["refresh_token"]


@pytest.mark.asyncio
async def test_login_rejects_a_wrong_password(async_client):
    email, _ = await _register(async_client)
    response = await async_client.post(
        "/api/auth/login", json={"email": email, "password": "not-the-password"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_rejects_a_token_signed_with_the_wrong_key(async_client):
    """Guards the removal of the hardcoded JWT_SECRET fallback."""
    import jwt

    forged = jwt.encode(
        {"sub": str(uuid.uuid4()), "type": "access", "exp": 4102444800},
        "supersecret_default_key_change_in_production",
        algorithm="HS256",
    )
    response = await async_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {forged}"}
    )
    assert response.status_code == 401


# --- routes that used to 500 ------------------------------------------------


@pytest.mark.asyncio
async def test_change_password_succeeds_and_the_new_password_works(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    response = await async_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": password, "new_password": "An0therPassw0rd!"},
    )
    assert response.status_code == 200, response.text

    assert (
        await async_client.post(
            "/api/auth/login", json={"email": email, "password": password}
        )
    ).status_code == 401, "the old password must stop working"
    await _login(async_client, email, "An0therPassw0rd!")


@pytest.mark.asyncio
async def test_change_password_rejects_a_wrong_current_password(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    response = await async_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": "wrong-password", "new_password": "An0therPassw0rd!"},
    )
    # 400, not 401: a 401 is what authenticatedFetch() answers by rotating the
    # refresh token and re-sending the same wrong password.
    assert response.status_code == 400
    assert "www-authenticate" not in response.headers


@pytest.mark.asyncio
async def test_forgot_password_then_reset_completes_the_round_trip(async_client, monkeypatch):
    email, password = await _register(async_client)

    captured: list[str] = []

    async def _capture(_recipient: str, token: str) -> None:
        captured.append(token)

    # Patching the sender also asserts the route hands `background_tasks` to the
    # service; without it the mail is silently never scheduled.
    monkeypatch.setattr(auth_service, "send_password_reset_email", _capture)

    response = await async_client.post("/api/auth/forgot-password", json={"email": email})
    assert response.status_code == 200, response.text
    assert captured, "the reset email was never scheduled"
    token = captured[0]

    response = await async_client.post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "R3setPassw0rd!"},
    )
    assert response.status_code == 200, response.text
    await _login(async_client, email, "R3setPassw0rd!")

    replay = await async_client.post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "Y3tAnotherPass!"},
    )
    assert replay.status_code == 400, "a reset token must be single-use"


@pytest.mark.asyncio
async def test_reset_password_rejects_a_garbage_token(async_client):
    response = await async_client.post(
        "/api/auth/reset-password",
        json={"token": "not-a-jwt", "new_password": "R3setPassw0rd!"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_a_login_shows_up_in_the_session_list(async_client):
    """The list used to be empty for everybody, forever.

    It read `user_sessions`, which only `POST /sessions` writes and which never
    carries a `user_id`, so the filter matched nothing. Asserting the response
    was *a list* was true of that bug too, which is how it survived.
    """
    email, password = await _register(async_client)
    tokens = await _login(async_client, email, password)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    response = await async_client.get(
        "/api/auth/sessions", headers={**headers, "User-Agent": "Mozilla/5.0 (iPhone)"}
    )
    assert response.status_code == 200, response.text
    sessions = response.json()
    assert len(sessions) == 1, "the caller's own login is a session"
    assert sessions[0]["is_current"] is True, "the caller is looking at their own session"


@pytest.mark.asyncio
async def test_the_session_list_records_the_device_that_signed_in(async_client):
    email, password = await _register(async_client)
    signin = await async_client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148"},
    )
    assert signin.status_code == 200, signin.text
    headers = {"Authorization": f"Bearer {signin.json()['access_token']}"}

    sessions = (await async_client.get("/api/auth/sessions", headers=headers)).json()
    assert sessions[0]["device_type"] == "mobile"
    assert "iPhone" in sessions[0]["user_agent"]


@pytest.mark.asyncio
async def test_revoking_a_session_actually_ends_it(async_client):
    """The point of the panel: revoking has to invalidate the credential.

    Against `user_sessions` this flipped `is_active` on an analytics row and
    left the refresh token live for its full thirty days, while telling the
    caller the device had been signed out.
    """
    email, password = await _register(async_client)
    doomed = await _login(async_client, email, password)
    keeper = await _login(async_client, email, password)
    keeper_headers = {"Authorization": f"Bearer {keeper['access_token']}"}

    sessions = (await async_client.get("/api/auth/sessions", headers=keeper_headers)).json()
    assert len(sessions) == 2
    target = next(s for s in sessions if not s["is_current"])

    revoked = await async_client.delete(
        f"/api/auth/sessions/{target['session_id']}", headers=keeper_headers
    )
    assert revoked.status_code == 200, revoked.text

    refused = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": doomed["refresh_token"]}
    )
    assert refused.status_code == 401, "a revoked session must not be able to refresh"

    survived = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": keeper["refresh_token"]}
    )
    assert survived.status_code == 200, "revoking one session must not touch the others"


@pytest.mark.asyncio
async def test_revoking_an_unknown_session_is_a_404(async_client):
    """It used to answer "Session revoked successfully." for any id at all."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    response = await async_client.delete(
        f"/api/auth/sessions/{uuid.uuid4()}", headers=headers
    )
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
async def test_a_session_cannot_be_revoked_from_another_account(async_client):
    email_a, password_a = await _register(async_client)
    email_b, password_b = await _register(async_client)
    headers_a = await _auth_header(async_client, email_a, password_a)
    victim = await _login(async_client, email_b, password_b)
    headers_b = {"Authorization": f"Bearer {victim['access_token']}"}

    target = (await async_client.get("/api/auth/sessions", headers=headers_b)).json()[0]
    response = await async_client.delete(
        f"/api/auth/sessions/{target['session_id']}", headers=headers_a
    )
    assert response.status_code == 404, "another account's session is not found, not revoked"

    still_works = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": victim["refresh_token"]}
    )
    assert still_works.status_code == 200


@pytest.mark.asyncio
async def test_delete_account_requires_the_confirmation_phrase(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    wrong = await async_client.request(
        "DELETE",
        "/api/auth/account",
        headers=headers,
        json={"current_password": password, "confirmation_phrase": "yes"},
    )
    assert wrong.status_code == 400

    response = await async_client.request(
        "DELETE",
        "/api/auth/account",
        headers=headers,
        json={"current_password": password, "confirmation_phrase": "DELETE"},
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_delete_account_rejects_a_wrong_current_password(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    wrong = await async_client.post(
        "/api/auth/delete-account",
        headers=headers,
        json={"current_password": "NotThePassword1!", "confirmation_phrase": "DELETE"},
    )
    assert wrong.status_code == 400, wrong.text
    assert "www-authenticate" not in wrong.headers

    # Still there.
    await _login(async_client, email, password)


# --- refresh rotation -------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_rotates_and_burns_the_old_token(async_client):
    email, password = await _register(async_client)
    first = await _login(async_client, email, password)

    rotated = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": first["refresh_token"]}
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["refresh_token"] != first["refresh_token"]

    replay = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": first["refresh_token"]}
    )
    assert replay.status_code == 401, "a rotated refresh token must not be reusable"


# --- 2FA --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_setup_2fa_cannot_rotate_a_live_secret(async_client):
    """Re-enrolling used to overwrite `totp_secret` while 2FA stayed enabled,
    locking the user out behind a factor their authenticator could no longer
    produce - and letting a stolen access token swap the second factor."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    setup = await async_client.post("/api/auth/2fa/setup", headers=headers)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]

    enabled = await async_client.post(
        "/api/auth/2fa/enable",
        headers=headers,
        json={"current_password": password, "code": _totp_now(secret)},
    )
    assert enabled.status_code == 200, enabled.text

    second = await async_client.post("/api/auth/2fa/setup", headers=headers)
    assert second.status_code == 400, "re-enrolment must be refused while 2FA is on"

    # The original authenticator still drives a full login, proving the stored
    # secret survived the rejected call.
    challenge = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert challenge.status_code == 200
    assert challenge.json()["requires_2fa"] is True

    verified = await async_client.post(
        "/api/auth/2fa/verify",
        json={
            "pre_auth_token": challenge.json()["pre_auth_token"],
            "code": _totp_now(secret),
        },
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["access_token"]


# --- routes the deployed frontend calls -------------------------------------


@pytest.mark.asyncio
async def test_logout_revokes_the_refresh_token(async_client):
    """auth.js discards the result of this call, so a broken route is invisible
    from the UI while the refresh token stays valid for another 30 days."""
    email, password = await _register(async_client)
    tokens = await _login(async_client, email, password)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    response = await async_client.post("/api/auth/logout", headers=headers)
    assert response.status_code == 200, response.text

    replay = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert replay.status_code == 401, "the refresh token must not survive a logout"


@pytest.mark.asyncio
async def test_logout_requires_authentication(async_client):
    assert (await async_client.post("/api/auth/logout")).status_code == 401


@pytest.mark.asyncio
async def test_logout_by_refresh_token_needs_no_bearer_and_ends_only_that_device(async_client):
    """The client sends the refresh token it holds and no bearer. Logging out
    used to revoke every refresh token the user had, so signing out of a phone
    signed out the laptop too."""
    email, password = await _register(async_client)
    other = await _login(async_client, email, password)
    this = await _login(async_client, email, password)

    response = await async_client.post(
        "/api/auth/logout", json={"refresh_token": this["refresh_token"]}
    )
    assert response.status_code == 200, response.text

    ended = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": this["refresh_token"]}
    )
    assert ended.status_code == 401, "the logged-out device must not refresh"

    survived = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": other["refresh_token"]}
    )
    assert survived.status_code == 200, "another device must stay signed in"


@pytest.mark.asyncio
async def test_logout_still_ends_the_session_once_the_access_token_has_expired(async_client):
    """The usual state after a long read. `get_current_user` used to refuse the
    expired bearer, nothing was revoked, and the 30-day refresh token outlived
    a UI that said "Signed out."."""
    from server.auth.security import create_access_token, verify_token

    email, password = await _register(async_client)
    tokens = await _login(async_client, email, password)
    claims = verify_token(tokens["refresh_token"], "refresh")
    expired = create_access_token(
        subject=claims["sub"], expires_delta=timedelta(minutes=-1), session_jti=claims["jti"]
    )

    response = await async_client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {expired}"},
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert response.status_code == 200, response.text

    replay = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert replay.status_code == 401


@pytest.mark.asyncio
async def test_an_expired_refresh_token_can_still_be_logged_out(async_client):
    """Expiry is not enforced on the way out: revoking a dead token is harmless,
    and refusing it would make signing out an error. The signature still is."""
    import jwt

    from server.auth.security import ALGORITHM, JWT_SECRET, verify_token

    email, password = await _register(async_client)
    tokens = await _login(async_client, email, password)
    claims = verify_token(tokens["refresh_token"], "refresh")
    expired_copy = jwt.encode(
        {
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
            "sub": claims["sub"],
            "type": "refresh",
            "jti": claims["jti"],
        },
        JWT_SECRET,
        algorithm=ALGORITHM,
    )

    response = await async_client.post("/api/auth/logout", json={"refresh_token": expired_copy})
    assert response.status_code == 200, response.text

    replay = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert replay.status_code == 401, "the session the expired copy named must be ended"


@pytest.mark.asyncio
async def test_bearer_only_logout_ends_only_the_calling_session(async_client):
    """A tab still on the pre-body auth.js sends only its bearer. The `sid`
    claim names its session, so it no longer takes every other device down."""
    email, password = await _register(async_client)
    other = await _login(async_client, email, password)
    this = await _login(async_client, email, password)

    response = await async_client.post(
        "/api/auth/logout", headers={"Authorization": f"Bearer {this['access_token']}"}
    )
    assert response.status_code == 200, response.text

    assert (await async_client.post(
        "/api/auth/refresh", json={"refresh_token": this["refresh_token"]}
    )).status_code == 401
    assert (await async_client.post(
        "/api/auth/refresh", json={"refresh_token": other["refresh_token"]}
    )).status_code == 200


@pytest.mark.asyncio
async def test_logout_refuses_a_refresh_token_it_cannot_verify(async_client):
    email, password = await _register(async_client)
    tokens = await _login(async_client, email, password)
    head, payload, _signature = tokens["refresh_token"].split(".")

    for bogus in ("not-a-jwt", f"{head}.{payload}.forged", tokens["access_token"]):
        response = await async_client.post("/api/auth/logout", json={"refresh_token": bogus})
        assert response.status_code == 401, f"{bogus[:20]}... was accepted"

    survived = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert survived.status_code == 200


@pytest.mark.asyncio
async def test_revoke_others_ends_every_session_but_the_caller_own(async_client):
    """"Every session except this one" has to actually mean that.

    The caller's own session is identified by the `sid` claim in their access
    token. Before that claim existed the route took an optional body parameter
    the frontend had no way to fill in, so it signed the caller out too.
    """
    email, password = await _register(async_client)
    other = await _login(async_client, email, password)
    caller = await _login(async_client, email, password)
    caller_headers = {"Authorization": f"Bearer {caller['access_token']}"}

    response = await async_client.post(
        "/api/auth/sessions/revoke-others", headers=caller_headers
    )
    assert response.status_code == 200, response.text

    refused = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": other["refresh_token"]}
    )
    assert refused.status_code == 401, "the other device must be signed out"

    survived = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": caller["refresh_token"]}
    )
    assert survived.status_code == 200, "the caller must not sign themselves out"

    remaining = (await async_client.get("/api/auth/sessions", headers=caller_headers)).json()
    assert len(remaining) == 1


@pytest.mark.asyncio
async def test_delete_account_is_reachable_at_the_path_the_frontend_uses(async_client):
    """The frontend POSTs /auth/delete-account; the API only served
    DELETE /auth/account, so the button 404'd."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    rejected = await async_client.post(
        "/api/auth/delete-account",
        headers=headers,
        json={"current_password": password, "confirmation_phrase": "nope"},
    )
    assert rejected.status_code == 400

    response = await async_client.post(
        "/api/auth/delete-account",
        headers=headers,
        json={"current_password": password, "confirmation_phrase": "DELETE"},
    )
    assert response.status_code == 200, response.text


# --- account enumeration ----------------------------------------------------


@pytest.mark.asyncio
async def test_forgot_password_does_not_reveal_whether_an_account_exists(async_client, monkeypatch):
    """A 404 for unknown addresses and a 200 for known ones let anyone confirm
    which emails hold accounts, one request at a time."""
    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(auth_service, "send_password_reset_email", _noop)
    email, _ = await _register(async_client)

    known = await async_client.post("/api/auth/forgot-password", json={"email": email})
    unknown = await async_client.post(
        "/api/auth/forgot-password", json={"email": f"absent-{uuid.uuid4().hex}@example.com"}
    )

    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json(), "responses must be byte-identical"


@pytest.mark.asyncio
async def test_magic_link_does_not_reveal_whether_an_account_exists(async_client):
    email, _ = await _register(async_client)
    known = await async_client.post("/api/auth/magic-link/request", json={"email": email})
    unknown = await async_client.post(
        "/api/auth/magic-link/request", json={"email": f"absent-{uuid.uuid4().hex}@example.com"}
    )
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


@pytest.mark.asyncio
async def test_a_reset_link_still_reaches_a_real_account(async_client, monkeypatch):
    """The generic response must not have turned the feature into a no-op."""
    captured: list[str] = []

    async def _capture(_recipient, token):
        captured.append(token)

    monkeypatch.setattr(auth_service, "send_password_reset_email", _capture)
    email, _ = await _register(async_client)

    await async_client.post("/api/auth/forgot-password", json={"email": email})
    assert captured, "a registered address must still be sent a link"

    await async_client.post(
        "/api/auth/forgot-password", json={"email": f"absent-{uuid.uuid4().hex}@example.com"}
    )
    assert len(captured) == 1, "an unknown address must not trigger mail"


# --- second factor brute force ----------------------------------------------


async def _enable_2fa(async_client, email, password):
    headers = await _auth_header(async_client, email, password)
    secret = (await async_client.post("/api/auth/2fa/setup", headers=headers)).json()["secret"]
    enabled = await async_client.post(
        "/api/auth/2fa/enable",
        headers=headers,
        json={"current_password": password, "code": _totp_now(secret)},
    )
    assert enabled.status_code == 200, enabled.text
    return secret


@pytest.mark.asyncio
async def test_a_pre_auth_token_cannot_be_replayed(async_client):
    """It carried no jti, so a captured token stayed usable for five minutes -
    long enough to walk a six-digit code space at leisure."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    challenge = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    pre_auth = challenge.json()["pre_auth_token"]

    first = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": pre_auth, "code": _totp_now(secret)},
    )
    assert first.status_code == 200

    replay = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": pre_auth, "code": _totp_now(secret)},
    )
    assert replay.status_code == 400, "a spent pre-auth token must not work twice"


@pytest.mark.asyncio
async def test_a_pre_auth_token_without_a_jti_is_refused(async_client):
    """The burn check used to read `if pre_auth_jti and not pre_auth_valid`.

    A token carrying no jti therefore skipped it entirely and was replayable for
    its full five minutes - the hole the jti was added to close. `jti` is now
    required when minting one, and this is the receiving half of that.
    """
    import jwt as pyjwt
    from datetime import datetime as dt

    from server.auth.security import ALGORITHM, JWT_SECRET

    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)
    challenge = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    subject = pyjwt.decode(
        challenge.json()["pre_auth_token"], JWT_SECRET, algorithms=[ALGORITHM]
    )["sub"]

    jti_less = pyjwt.encode(
        {
            "exp": dt.now(timezone.utc) + timedelta(minutes=5),
            "sub": subject,
            "type": "2fa_pre_auth",
        },
        JWT_SECRET,
        algorithm=ALGORITHM,
    )

    response = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": jti_less, "code": _totp_now(secret)},
    )
    assert response.status_code == 400, "a pre-auth token with no jti must not be spendable"


@pytest.mark.asyncio
async def test_repeated_bad_2fa_codes_lock_the_account(async_client):
    """Failed second-factor attempts were not counted at all, leaving the
    six-digit code the only thing between an attacker and the account."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    for _ in range(5):
        challenge = await async_client.post(
            "/api/auth/login", json={"email": email, "password": password}
        )
        assert challenge.status_code == 200
        attempt = await async_client.post(
            "/api/auth/2fa/verify",
            json={"pre_auth_token": challenge.json()["pre_auth_token"], "code": "000000"},
        )
        assert attempt.status_code == 400

    await _second_factor_refused_while_locked(async_client, email, password, secret)


# --- turning the second factor off ------------------------------------------


@pytest.mark.asyncio
async def test_2fa_can_be_disabled_and_re_enrolled(async_client):
    """The endpoint shipped with 2FA and nothing ever called it, so the only
    way off a second factor was a database edit - and `/2fa/setup` refuses to
    reissue a secret while one is live, which made a lost authenticator
    terminal."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)
    headers = await _auth_header_2fa(async_client, email, password, secret)

    disabled = await async_client.post(
        "/api/auth/2fa/disable",
        headers=headers,
        json={"current_password": password, "code": _totp_now(secret)},
    )
    assert disabled.status_code == 200, disabled.text

    # Off means off: the login no longer challenges...
    plain = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert plain.status_code == 200
    assert plain.json()["requires_2fa"] is False

    # ...and enrolment is reachable again, which is the whole point of disable.
    again = await async_client.post("/api/auth/2fa/setup", headers=headers)
    assert again.status_code == 200, again.text
    assert again.json()["secret"] != secret


@pytest.mark.asyncio
async def test_disable_2fa_needs_both_the_password_and_a_live_code(async_client):
    """Either credential alone must be useless. A stolen access token carries
    neither, and that is what stops it stripping the second factor off."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)
    headers = await _auth_header_2fa(async_client, email, password, secret)

    wrong_pw = await async_client.post(
        "/api/auth/2fa/disable",
        headers=headers,
        json={"current_password": "NotThePassword1!", "code": _totp_now(secret)},
    )
    assert wrong_pw.status_code == 400

    wrong_code = await async_client.post(
        "/api/auth/2fa/disable",
        headers=headers,
        json={"current_password": password, "code": "000000"},
    )
    assert wrong_code.status_code == 400

    # Still on after both refusals.
    challenge = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert challenge.json()["requires_2fa"] is True


@pytest.mark.asyncio
async def test_disable_2fa_is_refused_when_2fa_is_off(async_client):
    """A state error, not a guess - so it must not count toward the lockout
    tally the way a wrong password or a wrong code does."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    res = await async_client.post(
        "/api/auth/2fa/disable",
        headers=headers,
        json={"current_password": password, "code": "123456"},
    )
    assert res.status_code == 400
    assert "not enabled" in res.text.lower()

    # Six probes, well past the threshold of five, and the account still logs in.
    for _ in range(5):
        await async_client.post(
            "/api/auth/2fa/disable",
            headers=headers,
            json={"current_password": password, "code": "123456"},
        )
    still_fine = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert still_fine.status_code == 200


@pytest.mark.asyncio
async def test_repeated_bad_disable_codes_lock_the_account(async_client):
    """`/2fa/disable` counted nothing, so the six digits on it could be walked
    at will by anyone holding an access token and the password."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)
    headers = await _auth_header_2fa(async_client, email, password, secret)

    for _ in range(5):
        attempt = await async_client.post(
            "/api/auth/2fa/disable",
            headers=headers,
            json={"current_password": password, "code": "000000"},
        )
        assert attempt.status_code == 400

    # The live code is refused on the route that was being guessed at...
    blocked = await async_client.post(
        "/api/auth/2fa/disable",
        headers=headers,
        json={"current_password": password, "code": _totp_now(secret)},
    )
    assert blocked.status_code == 400
    assert "locked" in blocked.text.lower()
    # ...and at sign-in, because it is one tally for every code check.
    await _second_factor_refused_while_locked(async_client, email, password, secret)


@pytest.mark.asyncio
async def test_enabling_2fa_requires_the_current_password(async_client):
    """An access token was on its own enough to bind an authenticator to an
    account that had no second factor - which locks the real owner out rather
    than merely reading their data."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    secret = (await async_client.post("/api/auth/2fa/setup", headers=headers)).json()["secret"]

    missing = await async_client.post(
        "/api/auth/2fa/enable", headers=headers, json={"code": _totp_now(secret)}
    )
    assert missing.status_code == 422, "current_password is required"

    wrong = await async_client.post(
        "/api/auth/2fa/enable",
        headers=headers,
        json={"current_password": "NotThePassword1!", "code": _totp_now(secret)},
    )
    assert wrong.status_code == 400

    ok = await async_client.post(
        "/api/auth/2fa/enable",
        headers=headers,
        json={"current_password": password, "code": _totp_now(secret)},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_totp_codes_must_be_six_digits(async_client):
    """The code fields took any string and handed it straight to pyotp."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    await async_client.post("/api/auth/2fa/setup", headers=headers)

    for bad in ("12345", "1234567", "abcdef", ""):
        res = await async_client.post(
            "/api/auth/2fa/enable",
            headers=headers,
            json={"current_password": password, "code": bad},
        )
        assert res.status_code == 422, f"{bad!r} should not reach pyotp"


# --- the operator escape hatch ----------------------------------------------


def _load_clear_2fa():
    """Import scripts/clear_2fa.py by path.

    `scripts/` is not a package and pytest.ini scopes collection to
    tests/backend, so there is no import path to it. Cached in sys.modules
    because the module runs `load_dotenv` and touches sys.path at import.
    """
    import importlib.util

    if "clear_2fa" in sys.modules:
        return sys.modules["clear_2fa"]
    spec = importlib.util.spec_from_file_location("clear_2fa", ROOT / "scripts" / "clear_2fa.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["clear_2fa"] = module
    spec.loader.exec_module(module)
    return module


async def _run_clear_2fa(email: str, *, revoke_sessions: bool = True):
    """Drive the script's logic against the suite's database.

    Reaches it through the `get_db` override the conftest installed on the app,
    for the reason `_expire_the_lock` gives - importing the conftest from a test
    module builds a second, empty engine.
    """
    from server.db.database import get_db
    from server.main import app

    module = _load_clear_2fa()
    sessions = app.dependency_overrides[get_db]()
    session = await sessions.__anext__()
    try:
        user = await module.fetch_account(session, email)
        assert user is not None, f"the script could not find the account for {email}"
        return await module.clear_second_factor(session, user, revoke_sessions=revoke_sessions)
    finally:
        await sessions.aclose()


@pytest.mark.asyncio
async def test_the_unlock_script_reopens_an_account_whose_authenticator_is_gone(async_client):
    """`scripts/clear_2fa.py` is the only way back from a lost authenticator.

    Finding 9 in docs/review/2fa.md is still open - there are no recovery codes,
    so an enrolled user whose authenticator is gone has no route out at all:
    disable wants a live code, /2fa/setup refuses to reissue a secret, password
    reset does not touch the 2FA columns and the magic link re-challenges. This
    asserts the state the script has to leave behind for the account to be
    genuinely reachable again, not merely edited.
    """
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    # What the owner actually does first: try codes that cannot work. Each one
    # feeds the code tally, so the account arrives at the script locked as
    # well as enrolled - which is why clearing the secret alone is not enough.
    for _ in range(auth_service.LOCKOUT_THRESHOLD):
        challenge = await async_client.post(
            "/api/auth/login", json={"email": email, "password": password}
        )
        await async_client.post(
            "/api/auth/2fa/verify",
            json={"pre_auth_token": challenge.json()["pre_auth_token"], "code": "000000"},
        )

    await _second_factor_refused_while_locked(async_client, email, password, secret)

    outcome = await _run_clear_2fa(email)
    assert outcome.changed is True

    # Password login goes straight through: no challenge, and no lingering lock.
    reopened = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["requires_2fa"] is False

    # And enrolment is reachable again. This is the assertion that matters:
    # clearing `is_totp_enabled` while leaving `totp_secret` set would pass the
    # login check above and still leave /2fa/setup refusing to reissue.
    headers = {"Authorization": f"Bearer {reopened.json()['access_token']}"}
    again = await async_client.post("/api/auth/2fa/setup", headers=headers)
    assert again.status_code == 200, again.text


@pytest.mark.asyncio
async def test_the_unlock_script_ends_the_sessions_on_the_lost_device(async_client):
    """The usual reason to run it is a phone that is gone, so whatever is still
    authenticated on it must not survive the unlock."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    # The full second-factor login, kept rather than discarded: the refresh
    # token it hands back is what a session on the lost device actually holds.
    challenge = await _login(async_client, email, password)
    verified = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": challenge["pre_auth_token"], "code": _totp_now(secret)},
    )
    assert verified.status_code == 200, verified.text
    stale_refresh = verified.json()["refresh_token"]

    outcome = await _run_clear_2fa(email)
    assert outcome.changed is True
    assert outcome.sessions_revoked >= 1

    # Revoked, not merely stale: the token is inside its 30-day lifetime and is
    # still refused, which is what makes the device out rather than trusted.
    refused = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": stale_refresh}
    )
    assert refused.status_code == 401, refused.text


@pytest.mark.asyncio
async def test_the_unlock_script_can_leave_sessions_alone(async_client):
    """`--keep-sessions` is for the case the factor was rotated rather than
    lost, where signing every device out is gratuitous."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    challenge = await _login(async_client, email, password)
    verified = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": challenge["pre_auth_token"], "code": _totp_now(secret)},
    )
    kept_refresh = verified.json()["refresh_token"]

    outcome = await _run_clear_2fa(email, revoke_sessions=False)
    assert outcome.changed is True
    assert outcome.sessions_revoked == 0

    still_good = await async_client.post(
        "/api/auth/refresh", json={"refresh_token": kept_refresh}
    )
    assert still_good.status_code == 200, still_good.text


@pytest.mark.asyncio
async def test_the_unlock_script_changes_nothing_when_2fa_is_already_off(async_client):
    """An operator running it on the wrong account must not silently revoke that
    account's sessions as a side effect."""
    email, _ = await _register(async_client)

    outcome = await _run_clear_2fa(email)
    assert outcome.changed is False
    assert "already off" in outcome.reason
    assert outcome.sessions_revoked == 0


# --- single-use token isolation ---------------------------------------------


@pytest.mark.asyncio
async def test_a_reset_token_cannot_be_spent_as_a_magic_link(async_client, monkeypatch):
    """Reset, magic-link and pre-auth tokens all used to be rows in
    refresh_tokens with nothing recording what they were for, so the only thing
    keeping them apart was the `type` claim on the JWT presenting them. The
    stored record now carries a purpose and redemption checks it."""
    captured: list[str] = []

    async def _capture(_recipient, token):
        captured.append(token)

    monkeypatch.setattr(auth_service, "send_password_reset_email", _capture)
    email, _ = await _register(async_client)
    await async_client.post("/api/auth/forgot-password", json={"email": email})
    reset_token = captured[0]

    replayed = await async_client.post(
        "/api/auth/magic-link/verify", json={"token": reset_token}
    )
    assert replayed.status_code == 401, "a reset token must not authenticate a magic link"


@pytest.mark.asyncio
async def test_changing_the_password_voids_a_pending_reset_link(async_client, monkeypatch):
    """A link in flight is a live credential. Under the old shared table it was
    revoked as a side effect of sweeping refresh tokens; now it is explicit."""
    captured: list[str] = []

    async def _capture(_recipient, token):
        captured.append(token)

    monkeypatch.setattr(auth_service, "send_password_reset_email", _capture)
    email, password = await _register(async_client)

    await async_client.post("/api/auth/forgot-password", json={"email": email})
    pending = captured[0]

    headers = await _auth_header(async_client, email, password)
    changed = await async_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": password, "new_password": "Ch4ngedPassw0rd!"},
    )
    assert changed.status_code == 200

    stale = await async_client.post(
        "/api/auth/reset-password",
        json={"token": pending, "new_password": "H1jackedPassw0rd!"},
    )
    assert stale.status_code == 400, "a reset issued before the change must not still work"


@pytest.mark.asyncio
async def test_a_spent_reset_token_stays_spent(async_client, monkeypatch):
    captured: list[str] = []

    async def _capture(_recipient, token):
        captured.append(token)

    monkeypatch.setattr(auth_service, "send_password_reset_email", _capture)
    email, _ = await _register(async_client)
    await async_client.post("/api/auth/forgot-password", json={"email": email})

    first = await async_client.post(
        "/api/auth/reset-password",
        json={"token": captured[0], "new_password": "F1rstReset!x"},
    )
    assert first.status_code == 200
    second = await async_client.post(
        "/api/auth/reset-password",
        json={"token": captured[0], "new_password": "S3condReset!x"},
    )
    assert second.status_code == 400


# --- email verification ------------------------------------------------------
# Closes the "No email verification on registration" row in docs/SECURITY.md.


@pytest.mark.asyncio
async def test_an_unverified_account_cannot_log_in(async_client):
    email = _email()
    password = "Str0ngPassw0rd!"
    assert (
        await async_client.post(
            "/api/auth/register", json={"email": email, "password": password}
        )
    ).status_code == 202

    refused = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert refused.status_code == 403
    assert "Confirm your email" in refused.json()["detail"]

    await verify_registered_email(async_client, email)

    allowed = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert allowed.status_code == 200
    assert "access_token" in allowed.json()


@pytest.mark.asyncio
async def test_a_wrong_password_never_reveals_the_verification_state(async_client):
    """The gate sits after the password check, so it is not an enumeration oracle.

    An unverified account and a nonexistent one must answer identically to a
    bad password; otherwise 403-vs-401 tells anyone which addresses are
    registered.
    """
    email = _email()
    assert (
        await async_client.post(
            "/api/auth/register", json={"email": email, "password": "Str0ngPassw0rd!"}
        )
    ).status_code == 202

    unverified = await async_client.post(
        "/api/auth/login", json={"email": email, "password": "WrongPassw0rd!"}
    )
    unknown = await async_client.post(
        "/api/auth/login",
        json={"email": _email(), "password": "WrongPassw0rd!"},
    )
    assert unverified.status_code == unknown.status_code == 401
    assert unverified.json() == unknown.json()


@pytest.mark.asyncio
async def test_a_verification_link_is_single_use_but_a_second_click_is_not_an_error(async_client):
    email = _email()
    await register_verified_account(async_client, email)
    token = SENT_VERIFICATION_TOKENS[email]

    # Mail clients prefetch links and people click twice. The token is burned,
    # but the address is confirmed, so this is a success.
    again = await async_client.post("/api/auth/verify-email", json={"token": token})
    assert again.status_code == 200
    assert "already confirmed" in again.json()["message"]


@pytest.mark.asyncio
async def test_a_token_minted_for_another_purpose_cannot_confirm_an_address(async_client):
    """The purpose check on one_time_tokens is what makes the four flows distinct."""
    email, password = await _register(async_client)

    captured = {}

    async def _capture(_recipient, token):
        captured["token"] = token

    with patch.object(auth_service, "send_magic_link_email", _capture):
        await async_client.post("/api/auth/magic-link/request", json={"email": email})

    refused = await async_client.post(
        "/api/auth/verify-email", json={"token": captured["token"]}
    )
    assert refused.status_code == 400


@pytest.mark.asyncio
async def test_resend_answers_identically_whatever_the_address(async_client):
    """Same generic response as forgot-password, for the same reason."""
    email = _email()
    await async_client.post(
        "/api/auth/register", json={"email": email, "password": "Str0ngPassw0rd!"}
    )

    unverified = await async_client.post("/api/auth/resend-verification", json={"email": email})
    unknown = await async_client.post(
        "/api/auth/resend-verification", json={"email": _email()}
    )
    verified_email, _ = await _register(async_client)
    already = await async_client.post(
        "/api/auth/resend-verification", json={"email": verified_email}
    )

    assert unverified.status_code == unknown.status_code == already.status_code == 200
    assert unverified.json() == unknown.json() == already.json()


@pytest.mark.asyncio
async def test_a_resent_link_confirms_the_address(async_client):
    email = _email()
    await async_client.post(
        "/api/auth/register", json={"email": email, "password": "Str0ngPassw0rd!"}
    )
    first = SENT_VERIFICATION_TOKENS[email]

    await async_client.post("/api/auth/resend-verification", json={"email": email})
    resent = SENT_VERIFICATION_TOKENS[email]
    assert resent != first

    assert (
        await async_client.post("/api/auth/verify-email", json={"token": resent})
    ).status_code == 200
    assert (
        await async_client.post(
            "/api/auth/login", json={"email": email, "password": "Str0ngPassw0rd!"}
        )
    ).status_code == 200


@pytest.mark.asyncio
async def test_a_garbage_token_is_refused(async_client):
    assert (
        await async_client.post("/api/auth/verify-email", json={"token": "not-a-jwt"})
    ).status_code == 400


@pytest.mark.asyncio
async def test_the_response_reports_the_verification_state(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    me = await async_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email_verified_at"] is not None


# --- an emailed link confirms the address it was sent to ---------------------


async def _unverified(async_client, password="Str0ngPassw0rd!"):
    """An account that registered but never clicked the confirmation link."""
    email = _email()
    created = await async_client.post(
        "/api/auth/register", json={"email": email, "password": password}
    )
    assert created.status_code == 202
    refused = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert refused.status_code == 403, "precondition: this account cannot log in yet"
    return email, password


async def _capture_link(async_client, sender_name: str, path: str, email: str) -> str:
    captured = {}

    async def _capture(_recipient, token):
        captured["token"] = token

    with patch.object(auth_service, sender_name, _capture):
        await async_client.post(path, json={"email": email})
    assert "token" in captured, f"{path} sent no mail"
    return captured["token"]


@pytest.mark.asyncio
async def test_redeeming_a_magic_link_confirms_the_address(async_client):
    """Redeeming a link out of the inbox is the same proof clicking the
    verification link is. It was not recorded, so the account stayed flagged
    unverified for good: the magic link signed them in while their password
    kept being refused, with nothing explaining why."""
    email, password = await _unverified(async_client)

    token = await _capture_link(
        async_client, "send_magic_link_email", "/api/auth/magic-link/request", email
    )
    signed_in = await async_client.post("/api/auth/magic-link/verify", json={"token": token})
    assert signed_in.status_code == 200
    assert signed_in.json()["access_token"]

    # The dead end is gone: the password now works too.
    allowed = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_completing_a_password_reset_confirms_the_address(async_client):
    """Same proof, same link, and the worse dead end of the two - a reset that
    reports success and still leaves the visitor unable to log in reads as the
    new password not having taken."""
    email, _ = await _unverified(async_client)

    token = await _capture_link(
        async_client, "send_password_reset_email", "/api/auth/forgot-password", email
    )
    new_password = "An0therStr0ngPass!"
    reset = await async_client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": new_password}
    )
    assert reset.status_code == 200, reset.text

    allowed = await async_client.post(
        "/api/auth/login", json={"email": email, "password": new_password}
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_confirming_twice_does_not_move_the_timestamp(async_client):
    """A second redemption must not rewrite when the address was confirmed."""
    email, password = await _unverified(async_client)
    token = await _capture_link(
        async_client, "send_magic_link_email", "/api/auth/magic-link/request", email
    )
    await async_client.post("/api/auth/magic-link/verify", json={"token": token})

    login = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    first = (
        await async_client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        )
    ).json()["email_verified_at"]

    second_token = await _capture_link(
        async_client, "send_magic_link_email", "/api/auth/magic-link/request", email
    )
    await async_client.post("/api/auth/magic-link/verify", json={"token": second_token})
    after = (
        await async_client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        )
    ).json()["email_verified_at"]

    assert first == after


# --- an expired lockout clears the tally -------------------------------------


async def _expire_the_lock(email: str):
    """Move `locked_until` into the past, as fifteen minutes of clock would.

    Reaches the database through the `get_db` override the conftest already
    installed on the app, rather than importing the conftest - importing it
    from a test module runs it a second time and rebinds that override to a
    second, empty engine (see the note in tests/backend/helpers.py).
    """
    from server.db.database import get_db
    from server.main import app
    from server.models.user import User

    sessions = app.dependency_overrides[get_db]()
    session = await sessions.__anext__()
    try:
        await session.execute(
            update(User)
            .where(User.email == email)
            .values(locked_until=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        await session.commit()
    finally:
        await sessions.aclose()


async def _fail_login(async_client, email: str, times: int):
    for _ in range(times):
        await async_client.post(
            "/api/auth/login", json={"email": email, "password": "not-the-password"}
        )


@pytest.mark.asyncio
async def test_an_expired_lockout_restores_a_full_set_of_attempts(async_client):
    """`failed_login_attempts` only reset on a *successful* sign-in, so someone
    who had been locked out came back fifteen minutes later still carrying a
    tally of five. One more mistyped password took it to six, tripped the
    threshold again, and locked them out for another fifteen minutes - and
    nothing but getting it right first time could break that cycle."""
    email, password = await _register(async_client)

    await _fail_login(async_client, email, auth_service.LOCKOUT_THRESHOLD)
    locked = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    _assert_login_refused(locked)

    await _expire_the_lock(email)

    # One wrong password after the lock lifts must NOT re-lock the account.
    await _fail_login(async_client, email, 1)
    still_open = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert still_open.status_code == 200, (
        f"a single mistake after the lock expired re-locked the account: {still_open.text}"
    )


@pytest.mark.asyncio
async def test_an_expired_lockout_still_locks_again_after_a_full_run(async_client):
    """Clearing the tally must not remove the lockout, only re-arm it."""
    email, password = await _register(async_client)

    await _fail_login(async_client, email, auth_service.LOCKOUT_THRESHOLD)
    await _expire_the_lock(email)

    await _fail_login(async_client, email, auth_service.LOCKOUT_THRESHOLD)
    relocked = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    _assert_login_refused(relocked)


@pytest.mark.asyncio
async def test_a_live_lockout_is_still_enforced(async_client):
    email, password = await _register(async_client)
    await _fail_login(async_client, email, auth_service.LOCKOUT_THRESHOLD)

    refused = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    _assert_login_refused(refused)  # the correct password must not open a live lock


# --- guessing bounds (docs/review/codebase_review_20260924.md §2) ------------


async def _user_row(email: str):
    """The `users` row as stored, through the same override `_expire_the_lock` uses."""
    from sqlalchemy import select

    from server.db.database import get_db
    from server.main import app
    from server.models.user import User

    sessions = app.dependency_overrides[get_db]()
    session = await sessions.__anext__()
    try:
        return (await session.execute(select(User).where(User.email == email))).scalar_one()
    finally:
        await sessions.aclose()


@pytest.mark.asyncio
async def test_parallel_guesses_are_not_all_checked(async_client):
    """The count was taken after a wrong answer, as a read-modify-write on the
    row the request loaded first. Parallel guesses all read the same count, and
    all passed the lock check before any was recorded, so every one of them was
    checked. Each attempt is now numbered before the password is looked at."""
    import asyncio

    email, _ = await _register(async_client)

    with patch.object(
        auth_service, "verify_password_scheme", wraps=auth_service.verify_password_scheme
    ) as checked:
        responses = await asyncio.gather(*(
            async_client.post("/api/auth/login", json={"email": email, "password": f"guess-{n}"})
            for n in range(10)
        ))

    assert all(r.status_code == 401 for r in responses)
    assert checked.call_count <= auth_service.LOCKOUT_THRESHOLD, (
        f"{checked.call_count} of 10 parallel guesses reached the password check"
    )
    # The upper bound alone passes at zero, which is what a refactor that moved
    # the check out of this spy's reach would produce.
    assert checked.call_count >= 1, "no guess reached the spied password check"
    row = await _user_row(email)
    assert row.locked_until is not None, "the burst must leave the account locked"


@pytest.mark.asyncio
async def test_every_login_refusal_costs_the_same_two_verifications(async_client):
    """A wrong password costs two bcrypt checks - the prehash one, then the
    legacy raw-password one. The unknown-address path burned one and the
    locked and purged paths none, so response time told the paths apart even
    where the body did not."""
    from server.auth import security
    from server.models.user import User

    wrong_email, _ = await _register(async_client)
    locked_email, locked_password = await _register(async_client)
    await _fail_login(async_client, locked_email, auth_service.LOCKOUT_THRESHOLD)
    purged_email, purged_password = await _register(async_client)

    from server.db.database import get_db
    from server.main import app

    sessions = app.dependency_overrides[get_db]()
    session = await sessions.__anext__()
    try:
        await session.execute(
            update(User)
            .where(User.email == purged_email)
            .values(deleted_at=datetime.now(timezone.utc) - timedelta(days=31), is_active=False)
        )
        await session.commit()
    finally:
        await sessions.aclose()

    cases = {
        "unknown": (_email(), "Str0ngPassw0rd!"),
        "wrong password": (wrong_email, "not-the-password"),
        "locked": (locked_email, locked_password),
        "purged": (purged_email, purged_password),
    }
    for label, (email, password) in cases.items():
        with patch.object(security, "_checkpw", wraps=security._checkpw) as spy:
            response = await async_client.post(
                "/api/auth/login", json={"email": email, "password": password}
            )
        _assert_login_refused(response)
        assert spy.call_count == 2, f"{label}: {spy.call_count} verifications"


@pytest.mark.asyncio
async def test_password_hashing_never_runs_on_the_event_loop(async_client):
    """bcrypt ran inside the async handlers, so every ~250 ms check froze each
    request on the worker - chat streams, SSE frames and health checks
    included. A password change is fourteen checks. Every hash and every
    verification now runs on a worker thread."""
    import threading

    import bcrypt
    from server.auth import security

    on_loop = {"checkpw": [], "hashpw": []}
    real_checkpw, real_hashpw = security._checkpw, bcrypt.hashpw

    def checkpw(*args):
        on_loop["checkpw"].append(threading.current_thread() is threading.main_thread())
        return real_checkpw(*args)

    def hashpw(*args):
        on_loop["hashpw"].append(threading.current_thread() is threading.main_thread())
        return real_hashpw(*args)

    with patch.object(security, "_checkpw", checkpw), patch.object(bcrypt, "hashpw", hashpw):
        email, password = await _register(async_client)
        _assert_login_refused(
            await async_client.post("/api/auth/login", json={"email": email, "password": "wrong"})
        )
        headers = await _auth_header(async_client, email, password)
        response = await async_client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"current_password": password, "new_password": "An0therPassw0rd!"},
        )

    assert response.status_code == 200, response.text
    assert on_loop["checkpw"] and on_loop["hashpw"], f"nothing was recorded: {on_loop}"
    assert not any(on_loop["checkpw"] + on_loop["hashpw"]), "a bcrypt call ran on the event loop"


@pytest.mark.asyncio
async def test_a_wrong_login_does_not_stall_the_event_loop(async_client):
    """Anyone could freeze the worker for half a second per wrong password: two
    real bcrypt checks ran inline. Drive one wrong login and assert an
    unrelated coroutine keeps getting scheduled throughout."""
    import asyncio

    email, _ = await _register(async_client)
    ticks = 0

    async def heartbeat():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    beat = asyncio.create_task(heartbeat())
    try:
        response = await async_client.post(
            "/api/auth/login", json={"email": email, "password": "not-the-password"}
        )
    finally:
        beat.cancel()

    _assert_login_refused(response)
    # ~0.5 s of hashing against a 10 ms heartbeat: about 50 ticks off the loop
    # and next to none on it. The threshold sits far below 50 so timing jitter
    # cannot make this flaky.
    assert ticks >= 15, f"event loop was starved during the login (only {ticks} ticks)"


@pytest.mark.asyncio
async def test_a_password_lock_does_not_block_the_emailed_link_to_2fa(async_client):
    """Five wrong passwords from anywhere used to lock the owner out of every
    route, the magic link included, because `verify_2fa_login` checked the one
    shared tally. A pre-auth token already proves the password or the inbox, so
    only the code tally applies there - and the owner has a way in."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    await _fail_login(async_client, email, auth_service.LOCKOUT_THRESHOLD)
    _assert_login_refused(
        await async_client.post("/api/auth/login", json={"email": email, "password": password})
    )

    token = await _capture_link(
        async_client, "send_magic_link_email", "/api/auth/magic-link/request", email
    )
    challenge = await async_client.post("/api/auth/magic-link/verify", json={"token": token})
    assert challenge.status_code == 200, challenge.text
    assert challenge.json()["requires_2fa"] is True

    signed_in = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": challenge.json()["pre_auth_token"], "code": _totp_now(secret)},
    )
    assert signed_in.status_code == 200, signed_in.text
    assert signed_in.json()["access_token"]


@pytest.mark.asyncio
async def test_a_password_reset_does_not_clear_the_code_tally(async_client):
    """A reset cleared the one shared tally, so anyone holding the inbox could
    reset, sign in, try five codes and reset again: the second factor was
    bounded by the rate limiter, not the lock. The reset clears the password
    tally only."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    for _ in range(auth_service.LOCKOUT_THRESHOLD):
        challenge = await async_client.post(
            "/api/auth/login", json={"email": email, "password": password}
        )
        await async_client.post(
            "/api/auth/2fa/verify",
            json={"pre_auth_token": challenge.json()["pre_auth_token"], "code": "000000"},
        )

    token = await _capture_link(
        async_client, "send_password_reset_email", "/api/auth/forgot-password", email
    )
    new_password = "R3setPassw0rd!"
    reset = await async_client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": new_password}
    )
    assert reset.status_code == 200, reset.text

    await _second_factor_refused_while_locked(async_client, email, new_password, secret)


@pytest.mark.asyncio
async def test_a_totp_code_cannot_be_replayed_within_its_step(async_client):
    """A code is valid for its whole 30-second step. One seen over a shoulder or
    relayed by a phishing proxy used to work again until the step ran out."""
    email, password = await _register(async_client)
    secret = await _enable_2fa(async_client, email, password)

    async def _verify(code):
        challenge = await async_client.post(
            "/api/auth/login", json={"email": email, "password": password}
        )
        return await async_client.post(
            "/api/auth/2fa/verify",
            json={"pre_auth_token": challenge.json()["pre_auth_token"], "code": code},
        )

    # The code that enabled 2FA is spent: it cannot sign in within its step.
    assert (await _verify(_totp_current(secret))).status_code == 400

    first = await _verify(_totp_now(secret))
    assert first.status_code == 200, first.text

    replay = await _verify(_totp_current(secret))
    assert replay.status_code == 400
    assert replay.json()["detail"] == "Invalid 2FA code"
    # The sign-in between the two replays cleared the tally, so this is the
    # replay just made: it counts exactly as a wrong code does.
    assert (await _user_row(email)).totp_failed_attempts == 1

    assert (await _verify(_totp_now(secret))).status_code == 200, "the next step's code works"


@pytest.mark.asyncio
async def test_a_one_time_token_is_claimed_once(async_client):
    """It was read, checked in Python, then written - two concurrent
    redemptions of one magic link could both pass and both mint a session."""
    from server.db.database import get_db
    from server.main import app

    email, _ = await _register(async_client)
    user_id = (await _user_row(email)).id

    sessions = app.dependency_overrides[get_db]()
    session = await sessions.__anext__()
    try:
        jti = auth_service.issue_one_time_token(
            session, user_id, auth_service.PURPOSE_MAGIC_LINK, timedelta(minutes=10)
        )
        other = auth_service.issue_one_time_token(
            session, user_id, auth_service.PURPOSE_MAGIC_LINK, timedelta(minutes=10)
        )
        expired = auth_service.issue_one_time_token(
            session, user_id, auth_service.PURPOSE_MAGIC_LINK, timedelta(minutes=-1)
        )
        await session.commit()

        assert await auth_service.consume_one_time_token(session, jti, auth_service.PURPOSE_MAGIC_LINK)
        assert not await auth_service.consume_one_time_token(
            session, jti, auth_service.PURPOSE_MAGIC_LINK
        ), "the second claim of the same jti must fail, even before a commit"

        # A token for another flow is refused *and left unspent*.
        assert not await auth_service.consume_one_time_token(
            session, other, auth_service.PURPOSE_PASSWORD_RESET
        )
        assert await auth_service.consume_one_time_token(session, other, auth_service.PURPOSE_MAGIC_LINK)

        assert not await auth_service.consume_one_time_token(
            session, expired, auth_service.PURPOSE_MAGIC_LINK
        )
    finally:
        await sessions.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["change-password", "delete-account"])
async def test_re_authentication_is_held_to_the_password_lock(async_client, route):
    """Both checked the current password with no tally at all, so a stolen
    access token bought unlimited guesses at it."""
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)

    def _body(current):
        if route == "change-password":
            return {"current_password": current, "new_password": "Br4ndNewPassw0rd!"}
        return {"current_password": current, "confirmation_phrase": "DELETE"}

    for _ in range(auth_service.LOCKOUT_THRESHOLD):
        wrong = await async_client.post(f"/api/auth/{route}", headers=headers, json=_body("nope-Wr0ng!"))
        assert wrong.status_code == 400
        assert wrong.json()["detail"] == "Incorrect current password"

    locked = await async_client.post(f"/api/auth/{route}", headers=headers, json=_body(password))
    assert locked.status_code == 400
    assert locked.json()["detail"] == auth_service.PASSWORD_LOCKED_DETAIL

    row = await _user_row(email)
    assert row.deleted_at is None, "the locked request must not have deleted the account"
    await _expire_the_lock(email)
    await _login(async_client, email, password)  # and the password is unchanged


# --- deleted accounts are purged ---------------------------------------------


@pytest.mark.asyncio
async def test_deleted_accounts_are_purged_after_the_reactivation_window(async_client):
    """The UI said "scheduled for deletion" and nothing ran the schedule: the
    email, the password hash, the TOTP secret and every saved conversation were
    kept for good. The purge removes the row, and the foreign keys take the
    rest with it."""
    from sqlalchemy import func, select, text

    from server.db.database import get_db
    from server.main import app
    from server.models.ai_conversation import AIConversation
    from server.models.token import RefreshToken
    from server.models.user import User
    from server.services.chat_history_service import save_or_update_conversation

    expired_email, expired_password = await _register(async_client)
    await _login(async_client, expired_email, expired_password)  # leaves a refresh token
    recent_email, _ = await _register(async_client)
    active_email, _ = await _register(async_client)

    now = datetime.now(timezone.utc)
    sessions = app.dependency_overrides[get_db]()
    session = await sessions.__anext__()
    sqlite = session.bind.dialect.name == "sqlite"
    try:
        expired_id = (await _user_row(expired_email)).id
        await save_or_update_conversation(
            session, expired_id, None, "dummy-model-id",
            [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
        )
        for email, age in ((expired_email, 31), (recent_email, 29)):
            await session.execute(
                update(User)
                .where(User.email == email)
                .values(deleted_at=now - timedelta(days=age), is_active=False)
            )
        await session.commit()

        # SQLite enforces ON DELETE CASCADE only with this set, and only
        # outside a transaction; PostgreSQL always enforces it.
        if sqlite:
            await session.execute(text("PRAGMA foreign_keys=ON"))
        try:
            purged = await auth_service.purge_deleted_accounts(session, now)
        finally:
            if sqlite:
                await session.commit()
                await session.execute(text("PRAGMA foreign_keys=OFF"))

        # At least this one: the suite shares a database, and other tests
        # leave accounts soft-deleted past the window too.
        assert purged >= 1

        async def _count(model, column, value):
            return (await session.execute(
                select(func.count()).select_from(model).where(column == value)
            )).scalar_one()

        assert await _count(User, User.email, expired_email) == 0
        assert await _count(RefreshToken, RefreshToken.user_id, expired_id) == 0
        assert await _count(AIConversation, AIConversation.user_id, expired_id) == 0
        assert await _count(User, User.email, recent_email) == 1, "still inside its window"
        assert await _count(User, User.email, active_email) == 1
    finally:
        await sessions.aclose()


# --- passlib -> bcrypt --------------------------------------------------------

# Made by passlib 1.7.4 over bcrypt 3.2.2, the pair this code used before it
# called bcrypt directly. Every stored hash was made that way, so these are the
# rows the swap must keep verifying.
PASSLIB_CURRENT_SCHEME = "$2b$12$XHE3TFUQ4M.uSUgX8TLooOzyR7UqlC6XheRvXEPdtrPy6zrSTvfvK"  # sha256 hex of "Str0ngPassw0rd!"
PASSLIB_LEGACY_SCHEME = "$2b$12$Zp.OH3V0nUXQFUmWEpg.Su089VxyfsHgRVjKSNbYe6eWaN6/eAUJS"  # raw 81-byte password
LEGACY_PASSWORD = "L" * 70 + "egacy-tail!"


def test_hashes_made_by_passlib_still_verify():
    from server.auth.security import verify_password_scheme

    assert verify_password_scheme("Str0ngPassw0rd!", PASSLIB_CURRENT_SCHEME) == (True, False)
    assert verify_password_scheme("wrong", PASSLIB_CURRENT_SCHEME) == (False, False)


def test_a_legacy_hash_of_a_long_password_still_verifies_and_asks_for_a_rehash():
    """bcrypt < 4 cut every input at 72 bytes without a word, so an 81-byte
    password was stored as its first 72. bcrypt 5 raises on the same input
    instead - the legacy check truncates, exactly as the old library did."""
    from server.auth.security import verify_password_scheme

    assert len(LEGACY_PASSWORD.encode()) == 81
    assert verify_password_scheme(LEGACY_PASSWORD, PASSLIB_LEGACY_SCHEME) == (True, True)
    assert verify_password_scheme("L" * 70 + "different!", PASSLIB_LEGACY_SCHEME) == (False, False)


def test_a_malformed_stored_hash_fails_the_check_rather_than_the_request():
    from server.auth.security import verify_password_scheme

    assert verify_password_scheme("anything", "not-a-bcrypt-hash") == (False, False)


# --- mailed tokens stay out of the query string -------------------------------


@pytest.mark.asyncio
async def test_mailed_links_carry_their_token_in_the_fragment(monkeypatch):
    """In the query string, opening `/?magic_token=…` wrote the token to Apache's
    access log, and the service worker cached the page under its full URL. A
    fragment never leaves the browser."""
    from server.services import notification_service

    bodies = []

    async def _capture(subject, recipient, plain, html, log_event):
        bodies.append(plain + html)
        return True

    monkeypatch.setattr(notification_service, "_send", _capture)
    await notification_service.send_password_reset_email("a@example.com", "RESET.TOKEN")
    await notification_service.send_email_verification_email("a@example.com", "VERIFY.TOKEN")
    await notification_service.send_magic_link_email("a@example.com", "MAGIC.TOKEN")

    for body, kind, token in zip(
        bodies,
        ("reset_token", "verify_token", "magic_token"),
        ("RESET.TOKEN", "VERIFY.TOKEN", "MAGIC.TOKEN"),
        strict=True,
    ):
        assert f"https://rjasti.com/#{kind}={token}" in body
        assert f"?{kind}=" not in body
