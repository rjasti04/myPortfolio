"""Endpoint coverage for the auth surface.

This file was previously empty, which is how five routes shipped calling
`auth_service` functions that do not exist: `pytest` stayed green while
/auth/change-password, /auth/reset-password, /auth/account and both
/auth/sessions routes returned 500 to every caller. The happy-path tests below
exist mainly so that class of wiring break cannot pass CI again.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone

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
async def test_register_returns_the_created_user(async_client):
    email, _ = await _register(async_client)
    response = await async_client.post(
        "/api/auth/register", json={"email": email, "password": "Str0ngPassw0rd!"}
    )
    assert response.status_code == 400, "a duplicate registration must not create a second user"


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
    assert created.status_code == 201, created.text

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
    assert response.status_code == 401


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
        "/api/auth/2fa/enable", headers=headers, json={"code": pyotp.TOTP(secret).now()}
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
            "code": pyotp.TOTP(secret).now(),
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
        "/api/auth/2fa/enable", headers=headers, json={"code": pyotp.TOTP(secret).now()}
    )
    assert enabled.status_code == 200
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
        json={"pre_auth_token": pre_auth, "code": pyotp.TOTP(secret).now()},
    )
    assert first.status_code == 200

    replay = await async_client.post(
        "/api/auth/2fa/verify",
        json={"pre_auth_token": pre_auth, "code": pyotp.TOTP(secret).now()},
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
        json={"pre_auth_token": jti_less, "code": pyotp.TOTP(secret).now()},
    )
    assert response.status_code == 400, "a pre-auth token with no jti must not be spendable"


@pytest.mark.asyncio
async def test_repeated_bad_2fa_codes_lock_the_account(async_client):
    """Failed second-factor attempts were not counted at all, leaving the
    six-digit code the only thing between an attacker and the account."""
    email, password = await _register(async_client)
    await _enable_2fa(async_client, email, password)

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

    locked = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert locked.status_code == 400
    assert "locked" in locked.text.lower()


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
    ).status_code == 201

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
    ).status_code == 201

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
    assert created.status_code == 201
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
    assert locked.status_code == 400
    assert "locked" in locked.text.lower()

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
    assert relocked.status_code == 400
    assert "locked" in relocked.text.lower()


@pytest.mark.asyncio
async def test_a_live_lockout_is_still_enforced(async_client):
    email, password = await _register(async_client)
    await _fail_login(async_client, email, auth_service.LOCKOUT_THRESHOLD)

    refused = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert refused.status_code == 400, "the correct password must not open a live lock"
