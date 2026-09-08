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
async def test_a_conversation_id_keeps_one_row_across_turns(async_client):
    """Two turns carrying the same conversation_id are one conversation.

    This is the defect the browser had: chat.js sent no conversation_id, so
    save_or_update_conversation took its create branch every turn and wrote a
    fresh row holding the whole transcript so far. A ten-turn conversation was
    ten rows, each larger than the last, and nothing read the table so nothing
    showed it.
    """
    headers = await _register_and_login(async_client)
    conversation_id = str(uuid.uuid4())

    async def turn(question: str, answer: str) -> None:
        with patch(
            "server.services.bedrock_service.bedrock_service.client.converse_stream"
        ) as mock_converse:
            mock_converse.return_value = _stream(answer)
            response = await async_client.post(
                "/api/chat/stream",
                headers=headers,
                json={
                    "model_id": "google.gemma-3-4b-it",
                    "conversation_id": conversation_id,
                    "messages": messages + [{"role": "user", "content": question}],
                },
            )
        assert response.status_code == 200
        messages.append({"role": "user", "content": question})
        messages.append({"role": "assistant", "content": answer})

    messages: list[dict] = []
    await turn("Who is Rajeev?", "A data engineer.")
    await turn("Where does he work?", "Nicholas and Company.")
    await turn("What does he use?", "FastAPI and Redshift.")

    conversations = (
        await async_client.get("/api/chat/history", headers=headers)
    ).json()["conversations"]
    assert len(conversations) == 1, "three turns must be one row, not three"
    assert conversations[0]["id"] == conversation_id
    assert conversations[0]["message_count"] == 6

    detail = await async_client.get(
        f"/api/chat/history/{conversation_id}", headers=headers
    )
    assert detail.json()["messages"] == messages


@pytest.mark.asyncio
async def test_omitting_the_conversation_id_still_writes_a_row_per_turn(async_client):
    """The behaviour the client's conversation_id exists to avoid.

    Pinned deliberately: the server cannot tell a second turn from a new
    conversation without being told, so this is correct server behaviour and a
    client that stops sending the id silently regresses to it.
    """
    headers = await _register_and_login(async_client)

    for question in ("First?", "Second?"):
        with patch(
            "server.services.bedrock_service.bedrock_service.client.converse_stream"
        ) as mock_converse:
            mock_converse.return_value = _stream("An answer.")
            await async_client.post(
                "/api/chat/stream",
                headers=headers,
                json={
                    "model_id": "google.gemma-3-4b-it",
                    "messages": [{"role": "user", "content": question}],
                },
            )

    conversations = (
        await async_client.get("/api/chat/history", headers=headers)
    ).json()["conversations"]
    assert len(conversations) == 2


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
