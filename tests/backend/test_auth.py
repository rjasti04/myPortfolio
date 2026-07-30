import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_register_and_login(async_client: AsyncClient):
    # Test Registration
    reg_response = await async_client.post(
        "/auth/register",
        json={"email": "testuser@example.com", "password": "password123"}
    )
    assert reg_response.status_code == 201
    data = reg_response.json()
    assert data["email"] == "testuser@example.com"
    assert "id" in data

    # Test Login
    login_response = await async_client.post(
        "/auth/login",
        json={"email": "testuser@example.com", "password": "password123"}
    )
    assert login_response.status_code == 200
    login_data = login_response.json()
    assert "access_token" in login_data
    assert "refresh_token" in login_data

    # Test Get Current User Profile (/auth/me)
    token = login_data["access_token"]
    me_response = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "testuser@example.com"

@pytest.mark.asyncio
async def test_register_existing_user(async_client: AsyncClient):
    await async_client.post(
        "/auth/register",
        json={"email": "duplicate@example.com", "password": "password123"}
    )
    res = await async_client.post(
        "/auth/register",
        json={"email": "duplicate@example.com", "password": "password123"}
    )
    assert res.status_code == 400
    assert "already registered" in res.json()["detail"].lower()

@pytest.mark.asyncio
async def test_invalid_login(async_client: AsyncClient):
    res = await async_client.post(
        "/auth/login",
        json={"email": "nonexistent@example.com", "password": "password123"}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_email_case_insensitivity(async_client: AsyncClient):
    # Register with mixed casing
    reg_res = await async_client.post(
        "/auth/register",
        json={"email": "MixedCasingUser@Example.com", "password": "password123"}
    )
    assert reg_res.status_code == 201

    # Try duplicate registration with lowercase (should be rejected)
    dup_res = await async_client.post(
        "/auth/register",
        json={"email": "mixedcasinguser@example.com", "password": "password123"}
    )
    assert dup_res.status_code == 400

    # Log in with lowercase (should succeed)
    login_res = await async_client.post(
        "/auth/login",
        json={"email": "mixedcasinguser@example.com", "password": "password123"}
    )
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()


@pytest.mark.asyncio
async def test_long_password_bypass(async_client: AsyncClient):
    long_pwd = "A" * 100
    email = "longpassword@example.com"
    # Register with 100 character password
    reg_res = await async_client.post(
        "/auth/register",
        json={"email": email, "password": long_pwd}
    )
    assert reg_res.status_code == 201

    # Login should succeed with full 100 chars
    login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": long_pwd}
    )
    assert login_res.status_code == 200

    # Login should fail if any character after the 72-byte mark is modified
    # (under standard Bcrypt this would succeed because it would ignore characters after 72nd byte)
    modified_pwd = long_pwd[:-1] + "B"
    login_fail_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": modified_pwd}
    )
    assert login_fail_res.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_rotation_and_logout(async_client: AsyncClient):
    email = "tokentest@example.com"
    await async_client.post(
        "/auth/register",
        json={"email": email, "password": "password123"}
    )

    login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": "password123"}
    )
    tokens = login_res.json()
    access_token = tokens["access_token"]
    refresh_token = tokens["refresh_token"]

    # 1. Use refresh token to get a new pair
    refresh_res = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": refresh_token}
    )
    assert refresh_res.status_code == 200
    new_tokens = refresh_res.json()
    new_refresh_token = new_tokens["refresh_token"]
    assert new_refresh_token != refresh_token

    # 2. Try using the old refresh token again (should fail due to revocation/rotation)
    old_refresh_res = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": refresh_token}
    )
    assert old_refresh_res.status_code == 401

    # 3. Verify user profile using new access token
    me_res = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {new_tokens['access_token']}"}
    )
    assert me_res.status_code == 200

    # 4. Perform logout
    logout_res = await async_client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {new_tokens['access_token']}"}
    )
    assert logout_res.status_code == 200

    # 5. Refresh token should now be invalid
    post_logout_refresh_res = await async_client.post(
        "/auth/refresh",
        json={"refresh_token": new_refresh_token}
    )
    assert post_logout_refresh_res.status_code == 401


@pytest.mark.asyncio
async def test_change_password_success(async_client: AsyncClient):
    email = "changepw@example.com"
    old_pwd = "OldPassword123!"
    new_pwd = "NewPassword456!"

    await async_client.post(
        "/auth/register",
        json={"email": email, "password": old_pwd}
    )

    login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": old_pwd}
    )
    token = login_res.json()["access_token"]

    # Change password
    change_res = await async_client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": old_pwd, "new_password": new_pwd}
    )
    assert change_res.status_code == 200
    assert change_res.json()["message"] == "Password changed successfully"

    # Verify old password fails
    old_login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": old_pwd}
    )
    assert old_login_res.status_code == 401

    # Verify new password succeeds
    new_login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": new_pwd}
    )
    assert new_login_res.status_code == 200


@pytest.mark.asyncio
async def test_change_password_invalid_current_password(async_client: AsyncClient):
    email = "changepw_fail@example.com"
    pwd = "RealPassword123!"

    await async_client.post(
        "/auth/register",
        json={"email": email, "password": pwd}
    )

    login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": pwd}
    )
    token = login_res.json()["access_token"]

    # Try changing password with wrong current password (returns 401 Unauthorized)
    change_res = await async_client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "WrongPassword123!", "new_password": "BrandNewPassword123!"}
    )
    assert change_res.status_code == 401
    assert "incorrect current password" in change_res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_change_password_reuse_prevention(async_client: AsyncClient):
    email = "reusepw@example.com"
    pwd1 = "Password123!Alpha"
    pwd2 = "Password123!Beta"

    await async_client.post(
        "/auth/register",
        json={"email": email, "password": pwd1}
    )

    login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": pwd1}
    )
    token = login_res.json()["access_token"]

    # Try reusing active password (pwd1)
    reuse_res = await async_client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": pwd1, "new_password": pwd1}
    )
    assert reuse_res.status_code == 400
    assert "cannot reuse" in reuse_res.json()["detail"].lower()

    # Change to pwd2 successfully
    change_res = await async_client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": pwd1, "new_password": pwd2}
    )
    assert change_res.status_code == 200

    # Login with pwd2
    login_res2 = await async_client.post(
        "/auth/login",
        json={"email": email, "password": pwd2}
    )
    token2 = login_res2.json()["access_token"]

    # Try reusing pwd1 (in password history)
    reuse_history_res = await async_client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token2}"},
        json={"current_password": pwd2, "new_password": pwd1}
    )
    assert reuse_history_res.status_code == 400
    assert "cannot reuse" in reuse_history_res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_change_password_breached_password(async_client: AsyncClient):
    email = "breachedpw@example.com"
    pwd1 = "SecureInitialPass123!"
    breached_pwd = "password123"

    await async_client.post(
        "/auth/register",
        json={"email": email, "password": pwd1}
    )

    login_res = await async_client.post(
        "/auth/login",
        json={"email": email, "password": pwd1}
    )
    token = login_res.json()["access_token"]

    # Attempt to change to a known breached password
    breach_res = await async_client.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": pwd1, "new_password": breached_pwd}
    )
    assert breach_res.status_code == 400
    assert "data breach" in breach_res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_forgot_password(async_client: AsyncClient):
    email = "forgotpw@example.com"
    await async_client.post(
        "/auth/register",
        json={"email": email, "password": "InitialPass123!"}
    )

    # Test request reset for existing user
    res1 = await async_client.post(
        "/auth/forgot-password",
        json={"email": email}
    )
    assert res1.status_code == 200
    assert "sent" in res1.json()["message"].lower()

    # Test request reset for unknown email (returns 404 as email is not registered)
    res2 = await async_client.post(
        "/auth/forgot-password",
        json={"email": "nonexistent_forgot@example.com"}
    )
    assert res2.status_code == 404
    assert "not registered" in res2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_reset_password_flow(async_client: AsyncClient):
    email = "resetflow@example.com"
    old_pwd = "OldPass123!"
    new_pwd = "NewBrandPassword456!"

    await async_client.post(
        "/auth/register",
        json={"email": email, "password": old_pwd}
    )

    from unittest.mock import patch

    with patch("server.services.auth_service.send_password_reset_email") as mock_send:
        forgot_res = await async_client.post(
            "/auth/forgot-password",
            json={"email": email}
        )
        assert forgot_res.status_code == 200
        assert mock_send.called
        token = mock_send.call_args[0][1]

    # Reset password with valid single-use token
    reset_res = await async_client.post(
        "/auth/reset-password",
        json={"token": token, "new_password": new_pwd}
    )
    assert reset_res.status_code == 200

    # Attempting to reuse the same token should fail
    reuse_res = await async_client.post(
        "/auth/reset-password",
        json={"token": token, "new_password": "AnotherNewPassword789!"}
    )
    assert reuse_res.status_code == 400
    assert "already been used" in reuse_res.json()["detail"].lower()

    # Old password login should fail
    login_old = await async_client.post(
        "/auth/login",
        json={"email": email, "password": old_pwd}
    )
    assert login_old.status_code == 401

    # New password login should succeed
    login_new = await async_client.post(
        "/auth/login",
        json={"email": email, "password": new_pwd}
    )
    assert login_new.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_invalid_token(async_client: AsyncClient):
    reset_res = await async_client.post(
        "/auth/reset-password",
        json={"token": "invalid.jwt.token", "new_password": "NewBrandPassword456!"}
    )
    assert reset_res.status_code == 400


@pytest.mark.asyncio
async def test_account_lockout_after_failed_logins(async_client: AsyncClient):
    email = "lockout_user@example.com"
    pwd = "CorrectPass123!"

    await async_client.post(
        "/auth/register",
        json={"email": email, "password": pwd}
    )

    # Fail login 4 times (should return 401)
    for _ in range(4):
        res = await async_client.post(
            "/auth/login",
            json={"email": email, "password": "WrongPassword123!"}
        )
        assert res.status_code == 401

    # 5th failed attempt locks out the account
    res5 = await async_client.post(
        "/auth/login",
        json={"email": email, "password": "WrongPassword123!"}
    )
    assert res5.status_code == 401

    # 6th attempt (even with CORRECT password) should fail with 400 account locked
    res6 = await async_client.post(
        "/auth/login",
        json={"email": email, "password": pwd}
    )
    assert res6.status_code == 400
    assert "locked" in res6.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_account_validation_and_reactivation(async_client: AsyncClient):
    email = "deluser@example.com"
    pwd = "Password123!"

    # 1. Register & Login
    await async_client.post("/auth/register", json={"email": email, "password": pwd})
    login_res = await async_client.post("/auth/login", json={"email": email, "password": pwd})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Try deletion with invalid phrase
    bad_phrase_res = await async_client.post(
        "/auth/delete-account",
        headers=headers,
        json={"current_password": pwd, "confirmation_phrase": "NOPE"}
    )
    assert bad_phrase_res.status_code == 400
    assert "DELETE" in bad_phrase_res.json()["detail"]

    # 3. Try deletion with invalid password
    bad_pwd_res = await async_client.post(
        "/auth/delete-account",
        headers=headers,
        json={"current_password": "WrongPassword123!", "confirmation_phrase": "DELETE"}
    )
    assert bad_pwd_res.status_code == 401

    # 4. Successful soft deletion
    del_res = await async_client.post(
        "/auth/delete-account",
        headers=headers,
        json={"current_password": pwd, "confirmation_phrase": "DELETE"}
    )
    assert del_res.status_code == 200
    assert "scheduled for deletion" in del_res.json()["message"].lower()

    # 5. Access token should now return 400 Inactive User (or 401)
    me_res = await async_client.get("/auth/me", headers=headers)
    assert me_res.status_code == 400
    assert "inactive" in me_res.json()["detail"].lower()

    # 6. Logging back in auto-reactivates the account
    relogin_res = await async_client.post("/auth/login", json={"email": email, "password": pwd})
    assert relogin_res.status_code == 200
    new_token = relogin_res.json()["access_token"]

    # 7. Me request should succeed after reactivation
    me_reactivated = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {new_token}"})
    assert me_reactivated.status_code == 200
    assert me_reactivated.json()["email"] == email
    assert me_reactivated.json()["is_active"] is True


@pytest.mark.asyncio
async def test_2fa_setup_enable_and_verify(async_client: AsyncClient):
    import pyotp
    email = "2fa_user@example.com"
    pwd = "Password123!"

    # 1. Register & Login
    await async_client.post("/auth/register", json={"email": email, "password": pwd})
    login_res = await async_client.post("/auth/login", json={"email": email, "password": pwd})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Setup 2FA
    setup_res = await async_client.post("/auth/2fa/setup", headers=headers)
    assert setup_res.status_code == 200
    setup_data = setup_res.json()
    assert "secret" in setup_data
    assert "data:image/png;base64," in setup_data["qr_code"]
    secret = setup_data["secret"]

    # 3. Enable 2FA with invalid code
    bad_enable = await async_client.post("/auth/2fa/enable", headers=headers, json={"code": "000000"})
    assert bad_enable.status_code == 400

    # 4. Enable 2FA with valid TOTP code
    totp = pyotp.TOTP(secret)
    valid_code = totp.now()
    enable_res = await async_client.post("/auth/2fa/enable", headers=headers, json={"code": valid_code})
    assert enable_res.status_code == 200

    # 5. Subsequent Login should return 2FA Challenge
    login_2fa_res = await async_client.post("/auth/login", json={"email": email, "password": pwd})
    assert login_2fa_res.status_code == 200
    challenge_data = login_2fa_res.json()
    assert challenge_data["requires_2fa"] is True
    assert "pre_auth_token" in challenge_data

    # 6. Verify 2FA challenge with valid code
    pre_token = challenge_data["pre_auth_token"]
    verify_res = await async_client.post("/auth/2fa/verify", json={"pre_auth_token": pre_token, "code": totp.now()})
    assert verify_res.status_code == 200
    final_data = verify_res.json()
    assert final_data["requires_2fa"] is False
    assert "access_token" in final_data


@pytest.mark.asyncio
async def test_magic_link_unregistered_and_registered(async_client: AsyncClient):
    # 1. Unregistered email should return 404
    req_bad = await async_client.post("/auth/magic-link/request", json={"email": "unknown_magic@example.com"})
    assert req_bad.status_code == 404
    assert "not registered" in req_bad.json()["detail"].lower()

    # 2. Register user
    email = "magic_user@example.com"
    pwd = "Password123!"
    await async_client.post("/auth/register", json={"email": email, "password": pwd})

    # 3. Request magic link for registered user
    req_good = await async_client.post("/auth/magic-link/request", json={"email": email})
    assert req_good.status_code == 200
    assert "magic login link sent" in req_good.json()["message"].lower()


@pytest.mark.asyncio
async def test_active_sessions_endpoint(async_client: AsyncClient):
    email = "session_user@example.com"
    pwd = "Password123!"

    await async_client.post("/auth/register", json={"email": email, "password": pwd})
    login_res = await async_client.post("/auth/login", json={"email": email, "password": pwd})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Fetch sessions
    sessions_res = await async_client.get("/auth/sessions", headers=headers)
    assert sessions_res.status_code == 200
    assert isinstance(sessions_res.json(), list)



