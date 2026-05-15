import pytest
from httpx import AsyncClient
import httpx
from unittest.mock import AsyncMock, patch, MagicMock

import os
# Set env vars BEFORE importing main.py
os.environ["DATABASE_URL"] = "postgresql://user:password@localhost:5432/dbname"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["DEFAULT_MODEL_ID"] = "anthropic.claude-v2"
os.environ["ALLOWED_MODEL_IDS"] = "model-1,model-2"
os.environ["TRUSTED_PROXY_IPS"] = "192.168.1.0/24,10.0.0.1"
os.environ["CORS_ORIGINS"] = "http://localhost,https://example.com"

from server.main import (
    app,
    _resolve_model_id,
    _ensure_alternating_roles,
    _is_trusted_proxy,
    _client_ip_from_request,
)
from fastapi import Request

@pytest.mark.asyncio
async def test_health_check_without_pool():
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "starting up"

def test_resolve_model_id():
    # Test valid models
    assert _resolve_model_id(None) == "anthropic.claude-v2"
    assert _resolve_model_id("anthropic.claude-v2") == "anthropic.claude-v2"
    assert _resolve_model_id("model-1") == "model-1"

    # Test invalid model
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as excinfo:
        _resolve_model_id("invalid-model")
    assert excinfo.value.status_code == 400

def test_ensure_alternating_roles():
    # Empty
    assert _ensure_alternating_roles([]) == []

    # Needs prepending user
    messages = [{"role": "assistant", "content": [{"text": "Hello"}]}]
    merged = _ensure_alternating_roles(messages)
    assert len(merged) == 2
    assert merged[0]["role"] == "user"
    assert merged[0]["content"][0]["text"] == "[conversation context]"
    assert merged[1]["role"] == "assistant"

    # Merging
    messages = [
        {"role": "user", "content": [{"text": "Hello"}]},
        {"role": "user", "content": [{"text": "World"}]},
        {"role": "assistant", "content": [{"text": "Hi"}]},
    ]
    merged = _ensure_alternating_roles(messages)
    assert len(merged) == 2
    assert merged[0]["role"] == "user"
    assert merged[0]["content"][0]["text"] == "Hello\nWorld"
    assert merged[1]["role"] == "assistant"

def test_is_trusted_proxy():
    assert _is_trusted_proxy("10.0.0.1") is True
    assert _is_trusted_proxy("192.168.1.50") is True
    assert _is_trusted_proxy("8.8.8.8") is False
    assert _is_trusted_proxy(None) is False
    assert _is_trusted_proxy("invalid-ip") is False

@pytest.mark.asyncio
async def test_client_ip_from_request():
    scope = {
        "type": "http",
        "client": ("8.8.8.8", 1234),
        "headers": [(b"x-forwarded-for", b"1.1.1.1, 2.2.2.2")]
    }
    request = Request(scope)
    # direct ip is not trusted, so it returns direct ip
    assert _client_ip_from_request(request) == "8.8.8.8"

    scope_trusted = {
        "type": "http",
        "client": ("10.0.0.1", 1234),
        "headers": [(b"x-forwarded-for", b"1.1.1.1, 2.2.2.2")]
    }
    request_trusted = Request(scope_trusted)
    # direct ip is trusted, looks at forwarded. 2.2.2.2 is not trusted, returns 2.2.2.2
    assert _client_ip_from_request(request_trusted) == "2.2.2.2"

@pytest.mark.asyncio
async def test_session_endpoints_mocked_db():
    # We will mock the database pool to test the session endpoints.
    mock_pool = MagicMock()
    mock_conn = AsyncMock()
    mock_pool.acquire.return_value.__aenter__.return_value = mock_conn

    # We need to inject our mock pool into the app state
    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        app.state.pool = mock_pool

        # Test POST /sessions
        import uuid
        mock_uuid = uuid.uuid4()
        mock_conn.fetchrow.return_value = {
            "session_id": mock_uuid,
            "started_at": "2023-01-01T00:00:00Z"
        }

        response = await ac.post("/sessions", json={
            "user_agent": "test-agent",
            "device_type": "desktop"
        })

        assert response.status_code == 201
        assert response.json()["session_id"] == str(mock_uuid)
        mock_conn.fetchrow.assert_called_once()

        # Test GET /sessions/{session_id}
        mock_conn.fetchrow.reset_mock()
        mock_conn.fetchrow.return_value = {
            "session_id": str(mock_uuid),
            "started_at": "2023-01-01T00:00:00Z",
            "ended_at": None,
            "is_active": True,
            "device_type": "desktop",
            "user_agent": "test-agent",
            "last_active_at": "2023-01-01T00:00:00Z",
            "end_reason": None
        }

        response = await ac.get(f"/sessions/{mock_uuid}")
        assert response.status_code == 200
        assert response.json()["session_id"] == str(mock_uuid)
        mock_conn.fetchrow.assert_called_once()

        # Test GET /sessions/{session_id} not found
        mock_conn.fetchrow.reset_mock()
        mock_conn.fetchrow.return_value = None
        response = await ac.get(f"/sessions/{mock_uuid}")
        assert response.status_code == 404

        # Test PATCH /sessions/{session_id}/heartbeat
        mock_conn.execute.reset_mock()
        mock_conn.execute.return_value = "UPDATE 1"
        response = await ac.patch(f"/sessions/{mock_uuid}/heartbeat")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        mock_conn.execute.assert_called_once()

        # Test PATCH /sessions/{session_id}/heartbeat not found
        mock_conn.execute.reset_mock()
        mock_conn.execute.return_value = "UPDATE 0"
        response = await ac.patch(f"/sessions/{mock_uuid}/heartbeat")
        assert response.status_code == 404

        # Test PATCH /sessions/{session_id}/end
        mock_conn.execute.reset_mock()
        mock_conn.execute.return_value = "UPDATE 1"
        response = await ac.patch(f"/sessions/{mock_uuid}/end", json={
            "end_reason": "logout"
        })
        assert response.status_code == 200
        assert response.json()["status"] == "ended"
        mock_conn.execute.assert_called_once()

@pytest.mark.asyncio
async def test_events_endpoints_mocked_db():
    mock_pool = MagicMock()
    mock_conn = AsyncMock()
    mock_pool.acquire.return_value.__aenter__.return_value = mock_conn

    # Fix for transaction mock
    mock_tx = AsyncMock()
    # transaction() is a method that returns an async context manager
    mock_conn.transaction = MagicMock()
    mock_conn.transaction.return_value.__aenter__.return_value = mock_tx

    transport = httpx.ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        app.state.pool = mock_pool
        import uuid
        mock_uuid = uuid.uuid4()

        # Test POST /events
        mock_conn.fetchval.return_value = 1 # Session exists
        mock_conn.fetchrow.return_value = {
            "event_id": 123,
            "created_at": "2023-01-01T00:00:00Z"
        }

        response = await ac.post("/events", json={
            "session_id": str(mock_uuid),
            "event_type": "page_view",
            "page_path": "/",
            "event_data": {"foo": "bar"}
        })
        assert response.status_code == 201
        assert response.json()["event_id"] == 123

        # Test POST /events/bulk
        mock_conn.executemany.return_value = None

        response = await ac.post("/events/bulk", json={
            "events": [
                {
                    "session_id": str(mock_uuid),
                    "event_type": "page_view",
                    "page_path": "/",
                },
                {
                    "session_id": str(mock_uuid),
                    "event_type": "click",
                    "page_path": "/about",
                }
            ]
        })
        assert response.status_code == 201
        assert response.json()["inserted"] == 2
        mock_conn.executemany.assert_called_once()

        # Test GET /sessions/{session_id}/events
        mock_conn.fetch.return_value = [
            {
                "event_id": 1,
                "event_type": "page_view",
                "page_path": "/",
                "event_data": None,
                "created_at": "2023-01-01T00:00:00Z"
            }
        ]
        response = await ac.get(f"/sessions/{mock_uuid}/events?limit=10&offset=0")
        assert response.status_code == 200
        assert len(response.json()) == 1
        assert response.json()[0]["event_id"] == 1


@pytest.mark.asyncio
async def test_chat_summarize_endpoint():
    # Need to mock the asyncio.to_thread and _acquire_bedrock_slot
    with patch("server.main._acquire_bedrock_slot", new_callable=AsyncMock) as mock_acquire:
        with patch("asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread:
            # Mock the bedrock_semaphore release
            with patch("server.main.bedrock_semaphore.release") as mock_release:

                mock_to_thread.return_value = {
                    "output": {
                        "message": {
                            "content": [{"text": "This is a summary."}]
                        }
                    }
                }

                transport = httpx.ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as ac:
                    response = await ac.post("/chat/summarize", json={
                        "messages": [
                            {"role": "user", "content": "Hello"},
                            {"role": "assistant", "content": "Hi there!"}
                        ]
                    })

                    assert response.status_code == 200
                    assert response.json() == {"summary": "This is a summary."}

                    mock_acquire.assert_called_once()
                    mock_to_thread.assert_called_once()
                    mock_release.assert_called_once()

@pytest.mark.asyncio
async def test_models_endpoint():
    with patch("server.main._acquire_bedrock_slot", new_callable=AsyncMock) as mock_acquire:
        with patch("asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread:
            with patch("server.main.bedrock_semaphore.release") as mock_release:

                mock_to_thread.return_value = {
                    "modelSummaries": [
                        {
                            "modelId": "model-1",
                            "modelName": "Model One",
                            "providerName": "Provider A",
                            "inputModalities": ["TEXT"],
                            "outputModalities": ["TEXT"]
                        }
                    ]
                }

                transport = httpx.ASGITransport(app=app)
                async with AsyncClient(transport=transport, base_url="http://test") as ac:
                    response = await ac.get("/models")

                    assert response.status_code == 200
                    assert response.json()["models"][0]["modelId"] == "model-1"

                    mock_acquire.assert_called_once()
                    mock_to_thread.assert_called_once()
                    mock_release.assert_called_once()
