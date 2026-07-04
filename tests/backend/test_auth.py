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
