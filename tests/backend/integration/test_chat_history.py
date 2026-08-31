"""Coverage for conversation history.

This file was empty. The feature had a model, a service and a migration
(`g9b0c1d2e3f4_add_ai_conversations`), but the only code that called any of it
lived in `chat_controller.py`, which no router ever included - so no route
existed and nothing ever wrote a row to `ai_conversations`.
"""

import json
import uuid

import pytest
from unittest.mock import patch

from server.services.chat_history_service import (
    compress_messages,
    decompress_messages,
    generate_title_from_messages,
)


def _stream(text: str):
    return {
        "stream": [
            {"contentBlockDelta": {"delta": {"text": text}}},
            {"metadata": {"usage": {"inputTokens": 5, "outputTokens": 7}}},
        ]
    }


async def _register_and_login(async_client):
    email = f"hist-{uuid.uuid4().hex[:12]}@example.com"
    password = "Str0ngPassw0rd!"
    assert (
        await async_client.post(
            "/api/auth/register", json={"email": email, "password": password}
        )
    ).status_code == 201
    login = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


# --- compression round trip --------------------------------------------------


def test_compression_round_trip():
    messages = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
    ]
    assert decompress_messages(compress_messages(messages)) == messages


def test_compression_actually_shrinks_a_realistic_transcript():
    messages = [{"role": "user", "content": "the quick brown fox " * 200}]
    raw = len(json.dumps(messages).encode("utf-8"))
    assert len(compress_messages(messages)) < raw


def test_decompress_tolerates_an_empty_payload():
    assert decompress_messages(b"") == []


@pytest.mark.parametrize(
    "messages, expected",
    [
        ([{"role": "user", "content": "Short question"}], "Short question"),
        ([{"role": "assistant", "content": "ignored"}], "New Conversation"),
        ([], "New Conversation"),
    ],
)
def test_title_derivation(messages, expected):
    assert generate_title_from_messages(messages) == expected


def test_long_titles_are_truncated():
    title = generate_title_from_messages([{"role": "user", "content": "x" * 200}])
    assert len(title) == 45 and title.endswith("...")


# --- endpoints ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_history_requires_authentication(async_client):
    assert (await async_client.get("/api/chat/history")).status_code == 401


@pytest.mark.asyncio
async def test_streaming_while_signed_in_saves_a_conversation(async_client):
    """The end-to-end path that had no way to run: a signed-in chat writes a row
    and the caller can read it back."""
    headers = await _register_and_login(async_client)

    empty = await async_client.get("/api/chat/history", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["conversations"] == []

    with patch(
        "server.services.bedrock_service.bedrock_service.client.converse_stream"
    ) as mock_converse:
        mock_converse.return_value = _stream("Rajeev is a data engineer.")
        response = await async_client.post(
            "/api/chat/stream",
            headers=headers,
            json={
                "model_id": "google.gemma-3-4b-it",
                "messages": [{"role": "user", "content": "Who is Rajeev?"}],
            },
        )
    assert response.status_code == 200
    assert "Rajeev is a data engineer." in response.text

    listing = await async_client.get("/api/chat/history", headers=headers)
    assert listing.status_code == 200
    conversations = listing.json()["conversations"]
    assert len(conversations) == 1
    assert conversations[0]["title"] == "Who is Rajeev?"
    assert conversations[0]["message_count"] == 2

    detail = await async_client.get(
        f"/api/chat/history/{conversations[0]['id']}", headers=headers
    )
    assert detail.status_code == 200
    assert detail.json()["messages"] == [
        {"role": "user", "content": "Who is Rajeev?"},
        {"role": "assistant", "content": "Rajeev is a data engineer."},
    ]


@pytest.mark.asyncio
async def test_a_conversation_is_not_readable_by_another_user(async_client):
    owner = await _register_and_login(async_client)
    with patch(
        "server.services.bedrock_service.bedrock_service.client.converse_stream"
    ) as mock_converse:
        mock_converse.return_value = _stream("secret answer")
        await async_client.post(
            "/api/chat/stream",
            headers=owner,
            json={
                "model_id": "google.gemma-3-4b-it",
                "messages": [{"role": "user", "content": "private question"}],
            },
        )
    listing = await async_client.get("/api/chat/history", headers=owner)
    conversation_id = listing.json()["conversations"][0]["id"]

    intruder = await _register_and_login(async_client)
    assert (
        await async_client.get(f"/api/chat/history/{conversation_id}", headers=intruder)
    ).status_code == 404
    assert (
        await async_client.delete(
            f"/api/chat/history/{conversation_id}", headers=intruder
        )
    ).status_code == 404
    # Still there for its owner.
    assert (
        await async_client.get(f"/api/chat/history/{conversation_id}", headers=owner)
    ).status_code == 200


@pytest.mark.asyncio
async def test_delete_removes_the_conversation(async_client):
    headers = await _register_and_login(async_client)
    with patch(
        "server.services.bedrock_service.bedrock_service.client.converse_stream"
    ) as mock_converse:
        mock_converse.return_value = _stream("answer")
        await async_client.post(
            "/api/chat/stream",
            headers=headers,
            json={
                "model_id": "google.gemma-3-4b-it",
                "messages": [{"role": "user", "content": "throwaway"}],
            },
        )
    listing = await async_client.get("/api/chat/history", headers=headers)
    conversation_id = listing.json()["conversations"][0]["id"]

    assert (
        await async_client.delete(f"/api/chat/history/{conversation_id}", headers=headers)
    ).status_code == 200
    assert (
        await async_client.get(f"/api/chat/history/{conversation_id}", headers=headers)
    ).status_code == 404
    assert (
        await async_client.delete(f"/api/chat/history/{conversation_id}", headers=headers)
    ).status_code == 404


@pytest.mark.asyncio
async def test_anonymous_streaming_saves_nothing(async_client):
    """Only signed-in transcripts are persisted."""
    with patch(
        "server.services.bedrock_service.bedrock_service.client.converse_stream"
    ) as mock_converse:
        mock_converse.return_value = _stream("anonymous reply")
        response = await async_client.post(
            "/api/chat/stream",
            json={
                "model_id": "google.gemma-3-4b-it",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
    assert response.status_code == 200

    headers = await _register_and_login(async_client)
    assert (await async_client.get("/api/chat/history", headers=headers)).json()[
        "conversations"
    ] == []
