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
    response = await async_client.post(
        "/auth/register",
        json={"email": "duplicate@example.com", "password": "password123"}
    )
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"].lower()

@pytest.mark.asyncio
async def test_login_invalid_password(async_client: AsyncClient):
    await async_client.post(
        "/auth/register",
        json={"email": "wrongpass@example.com", "password": "correctpassword"}
    )
    response = await async_client.post(
        "/auth/login",
        json={"email": "wrongpass@example.com", "password": "wrongpassword"}
    )
    assert response.status_code == 401
    assert "incorrect" in response.json()["detail"].lower()
