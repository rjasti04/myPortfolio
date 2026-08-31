import asyncio
import json
import time

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
            # Named explicitly. The service used to pick the raw-invoke path
            # when it detected a MagicMock on the client, so this test passed
            # only because it was mocked - the branch was chosen by the test
            # double rather than by the model id. The model now decides.
            "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
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
async def test_chat_stream_gemma_model_converse_stream(async_client):
    """Test /api/chat/stream SSE endpoint using google.gemma-3-4b-it with Bedrock converse_stream."""
    mock_events = [
        {"contentBlockDelta": {"delta": {"text": "Hello from Gemma 3!"}}},
        {"metadata": {"usage": {"inputTokens": 100, "outputTokens": 20}}}
    ]
    mock_bedrock_response = {"stream": mock_events}

    with patch("server.services.bedrock_service.bedrock_service.client.converse_stream") as mock_converse:
        mock_converse.return_value = mock_bedrock_response

        payload = {
            "model_id": "google.gemma-3-4b-it",
            "messages": [
                {"role": "user", "content": "Hello Gemma!"}
            ]
        }

        response = await async_client.post(
            "/api/chat/stream",
            json=payload
        )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        body_text = response.text
        assert "Hello from Gemma 3!" in body_text
        assert '"type": "metrics"' in body_text
        assert '"model_id": "google.gemma-3-4b-it"' in body_text
        assert '"input_tokens": 100' in body_text
        assert '"output_tokens": 20' in body_text


@pytest.mark.asyncio
async def test_chat_stream_consecutive_user_messages(async_client):
    """Test /api/chat/stream automatically merges consecutive user messages before Bedrock invocation."""
    mock_events = [
        {"contentBlockDelta": {"delta": {"text": "Response to merged prompt."}}}
    ]
    mock_bedrock_response = {"stream": mock_events}

    with patch("server.services.bedrock_service.bedrock_service.client.converse_stream") as mock_converse:
        mock_converse.return_value = mock_bedrock_response

        payload = {
            "model_id": "google.gemma-3-4b-it",
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
        # Verify Bedrock converse_stream received sanitized payload with single merged message
        args, kwargs = mock_converse.call_args
        messages_sent = kwargs["messages"]
        assert len(messages_sent) == 1
        assert messages_sent[0]["role"] == "user"
        assert messages_sent[0]["content"][0]["text"] == "Question 1\n\nQuestion 2"


@pytest.mark.asyncio
async def test_chat_stream_invalid_model(async_client):
    """Test /api/chat/stream rejects unsupported model IDs with HTTP 400."""
    payload = {
        "model_id": "unsupported.fake-model-id",
        "messages": [{"role": "user", "content": "Hi"}]
    }
    with patch("server.routes.chat_routes.ALLOWED_MODEL_IDS", {"google.gemma-3-4b-it"}):
        response = await async_client.post(
            "/api/chat/stream",
            json=payload
        )
        assert response.status_code == 400
        assert "Unsupported model" in response.text


class _BlockingEventStream:
    """Stands in for botocore's EventStream: a *synchronous* iterator whose
    `__next__` blocks on I/O. A plain list cannot reproduce the bug this guards,
    because iterating a list never blocks."""

    def __init__(self, events, delay_seconds):
        self._events = list(events)
        self._delay = delay_seconds

    def __iter__(self):
        return self

    def __next__(self):
        if not self._events:
            raise StopIteration
        time.sleep(self._delay)  # the socket read
        return self._events.pop(0)


@pytest.mark.asyncio
async def test_streaming_does_not_block_the_event_loop(async_client):
    """The service used to iterate the Bedrock stream synchronously inside an
    async generator, pinning the loop for the whole response: one chat stalled
    every other request on the worker, SSE keep-alives and the deploy's health
    check included. Drive a stream that blocks for ~0.3s in total and assert an
    unrelated coroutine still gets scheduled throughout."""
    events = [{"contentBlockDelta": {"delta": {"text": f"chunk-{i} "}}} for i in range(6)]
    events.append({"metadata": {"usage": {"inputTokens": 10, "outputTokens": 6}}})

    ticks = 0

    async def heartbeat():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    with patch("server.services.bedrock_service.bedrock_service.client.converse_stream") as mock_converse:
        mock_converse.return_value = {"stream": _BlockingEventStream(events, 0.05)}

        beat = asyncio.create_task(heartbeat())
        try:
            response = await async_client.post(
                "/api/chat/stream",
                json={
                    "model_id": "google.gemma-3-4b-it",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        finally:
            beat.cancel()

    assert response.status_code == 200
    assert "chunk-0" in response.text and "chunk-5" in response.text

    # ~0.35s of blocking reads against a 10ms heartbeat. If the loop were held
    # by the stream the counter would barely move; the threshold is deliberately
    # far below the theoretical ~35 so timing jitter cannot make this flaky.
    assert ticks >= 8, f"event loop was starved during streaming (only {ticks} ticks)"
