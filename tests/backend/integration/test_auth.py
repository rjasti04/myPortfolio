"""Endpoint coverage for the auth surface.

This file was previously empty, which is how five routes shipped calling
`auth_service` functions that do not exist: `pytest` stayed green while
/auth/change-password, /auth/reset-password, /auth/account and both
/auth/sessions routes returned 500 to every caller. The happy-path tests below
exist mainly so that class of wiring break cannot pass CI again.
"""

import re
import uuid

import pyotp
import pytest

from server.routes import auth_routes
from server.services import auth_service


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
    email = _email()
    response = await async_client.post(
        "/api/auth/register", json={"email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return email, password


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
async def test_list_active_sessions_returns_a_list(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    response = await async_client.get("/api/auth/sessions", headers=headers)
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)


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
async def test_revoke_other_sessions_is_routed(async_client):
    email, password = await _register(async_client)
    headers = await _auth_header(async_client, email, password)
    response = await async_client.post("/api/auth/sessions/revoke-others", headers=headers)
    assert response.status_code == 200, response.text
    assert "message" in response.json()


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
