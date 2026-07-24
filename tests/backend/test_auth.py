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

    # Test request reset for unknown email (anti-enumeration check)
    res2 = await async_client.post(
        "/auth/forgot-password",
        json={"email": "nonexistent_forgot@example.com"}
    )
    assert res2.status_code == 200
    assert "sent" in res2.json()["message"].lower()


@pytest.mark.asyncio
async def test_reset_password_flow(async_client: AsyncClient):
    from server.auth.security import create_password_reset_token

    email = "resetflow@example.com"
    old_pwd = "OldPass123!"
    new_pwd = "NewBrandPassword456!"

    reg_res = await async_client.post(
        "/auth/register",
        json={"email": email, "password": old_pwd}
    )
    user_id = reg_res.json()["id"]

    # Generate token
    token = create_password_reset_token(subject=user_id)

    # Reset password with valid token
    reset_res = await async_client.post(
        "/auth/reset-password",
        json={"token": token, "new_password": new_pwd}
    )
    assert reset_res.status_code == 200

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
    assert reset_res.status_code == 401



