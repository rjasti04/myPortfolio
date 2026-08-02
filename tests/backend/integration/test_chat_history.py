import pytest
import uuid
from httpx import AsyncClient

from server.models.user import User
from server.services.chat_history_service import (
    compress_messages,
    decompress_messages,
    generate_title_from_messages,
    save_or_update_conversation,
    get_user_conversations,
    get_conversation_detail,
    delete_conversation,
)


@pytest.mark.asyncio
async def test_compression_roundtrip_and_ratio():
    sample_messages = [
        {"role": "user", "content": "How do I optimize PostgreSQL query performance for large tables?"},
        {"role": "assistant", "content": "To optimize PostgreSQL performance: 1. Use appropriate B-Tree, GIN, or BRIN indexes. 2. Vacuum & analyze tables regularly. 3. Adjust work_mem and shared_buffers settings."},
        {"role": "user", "content": "Can you explain BRIN indexes further?"},
        {"role": "assistant", "content": "BRIN (Block Range Index) is extremely lightweight for naturally ordered data like timestamps or sequential IDs."}
    ]

    compressed_bytes = compress_messages(sample_messages)
    decompressed = decompress_messages(compressed_bytes)

    assert decompressed == sample_messages
    assert isinstance(compressed_bytes, bytes)
    # Compression ratio test
    raw_size = len(str(sample_messages).encode('utf-8'))
    assert len(compressed_bytes) < raw_size


@pytest.mark.asyncio
async def test_title_generation():
    messages = [
        {"role": "user", "content": "Tell me a story about quantum computing and supercomputers"}
    ]
    title = generate_title_from_messages(messages)
    assert "quantum computing" in title
    assert len(title) <= 45


@pytest.mark.asyncio
async def test_chat_history_db_crud(async_client: AsyncClient):
    from tests.backend.conftest import TestingSessionLocal, engine
    from server.db.database import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    async with TestingSessionLocal() as db:
        # Create user for foreign key constraint
        test_user = User(
            id=user_id,
            email=f"chattest_{uuid.uuid4()}@example.com",
            hashed_password="dummy_hashed_password"
        )
        db.add(test_user)
        await db.commit()

        messages_v1 = [
            {"role": "user", "content": "Hello AI!"},
            {"role": "assistant", "content": "Hello User! How can I help?"}
        ]

        # 1. Save new conversation
        conv = await save_or_update_conversation(
            db=db,
            user_id=user_id,
            conversation_id=None,
            model_id="us.anthropic.claude-3-5-sonnet",
            messages=messages_v1,
        )
        assert conv.id is not None
        assert conv.message_count == 2
        assert conv.title == "Hello AI!"

        conv_id = conv.id

        # 2. Get summaries
        summaries = await get_user_conversations(db=db, user_id=user_id)
        assert len(summaries) == 1
        assert summaries[0]["id"] == str(conv_id)
        assert summaries[0]["message_count"] == 2

        # 3. Get detailed conversation (decompressed)
        detail = await get_conversation_detail(db=db, user_id=user_id, conversation_id=conv_id)
        assert detail is not None
        assert detail["messages"] == messages_v1

        # 4. Update conversation with new messages
        messages_v2 = messages_v1 + [
            {"role": "user", "content": "What is Python?"},
            {"role": "assistant", "content": "Python is a high-level programming language."}
        ]
        updated_conv = await save_or_update_conversation(
            db=db,
            user_id=user_id,
            conversation_id=conv_id,
            model_id="us.anthropic.claude-3-5-sonnet",
            messages=messages_v2,
        )
        assert updated_conv.message_count == 4

        detail_v2 = await get_conversation_detail(db=db, user_id=user_id, conversation_id=conv_id)
        assert len(detail_v2["messages"]) == 4

        # 5. Delete conversation
        deleted = await delete_conversation(db=db, user_id=user_id, conversation_id=conv_id)
        assert deleted is True

        detail_after_delete = await get_conversation_detail(db=db, user_id=user_id, conversation_id=conv_id)
        assert detail_after_delete is None
