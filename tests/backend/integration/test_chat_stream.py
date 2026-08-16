import json
import pytest
from unittest.mock import MagicMock, patch

@pytest.mark.asyncio
async def test_chat_stream_endpoint_success(async_client):
    """Test /api/chat/stream SSE endpoint returns text chunks and metrics payload."""
    
    mock_events = [
        {
            "chunk": {
                "bytes": json.dumps({
                    "type": "message_start",
                    "message": {
                        "usage": {
                            "input_tokens": 1200,
                            "cache_read_input_tokens": 1000,
                            "cache_creation_input_tokens": 0,
                        }
                    }
                }).encode("utf-8")
            }
        },
        {
            "chunk": {
                "bytes": json.dumps({
                    "type": "content_block_delta",
                    "delta": {"text": "Hello! I am Rajeev's AI assistant."}
                }).encode("utf-8")
            }
        },
        {
            "chunk": {
                "bytes": json.dumps({
                    "type": "message_delta",
                    "usage": {"output_tokens": 15}
                }).encode("utf-8")
            }
        }
    ]

    mock_bedrock_response = {"body": mock_events}

    with patch("server.services.bedrock_service.bedrock_service.client.invoke_model_with_response_stream") as mock_invoke:
        mock_invoke.return_value = mock_bedrock_response

        payload = {
            "messages": [
                {"role": "user", "content": "Hello, tell me about Rajeev Jasti."}
            ]
        }

        response = await async_client.post(
            "/api/chat/stream",
            json=payload,
            headers={"X-Session-ID": "123e4567-e89b-12d3-a456-426614174000"}
        )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        body_text = response.text
        assert "Hello! I am Rajeev's AI assistant." in body_text
        assert '"type": "metrics"' in body_text
        assert '"cache_hit": true' in body_text


@pytest.mark.asyncio
async def test_chat_stream_consecutive_user_messages(async_client):
    """Test /api/chat/stream automatically merges consecutive user messages before Bedrock invocation."""
    mock_events = [
        {
            "chunk": {
                "bytes": json.dumps({
                    "type": "content_block_delta",
                    "delta": {"text": "Response to merged prompt."}
                }).encode("utf-8")
            }
        }
    ]
    mock_bedrock_response = {"body": mock_events}

    with patch("server.services.bedrock_service.bedrock_service.client.invoke_model_with_response_stream") as mock_invoke:
        mock_invoke.return_value = mock_bedrock_response

        payload = {
            "messages": [
                {"role": "user", "content": "Question 1"},
                {"role": "user", "content": "Question 2"}
            ]
        }

        response = await async_client.post(
            "/api/chat/stream",
            json=payload
        )

        assert response.status_code == 200
        # Verify Bedrock received sanitized payload with single merged message
        args, kwargs = mock_invoke.call_args
        body_sent = json.loads(kwargs["body"])
        assert len(body_sent["messages"]) == 1
        assert body_sent["messages"][0]["role"] == "user"
        assert body_sent["messages"][0]["content"] == "Question 1\n\nQuestion 2"

