import json
import zlib
import uuid
from typing import Optional, Any
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from server.models.ai_conversation import AIConversation

COMPRESSION_LEVEL = 6


def compress_messages(messages: list[dict[str, Any]]) -> bytes:
    """Serialize messages list to JSON and compress using zlib (level 6)."""
    raw_json = json.dumps(messages, ensure_ascii=False)
    return zlib.compress(raw_json.encode("utf-8"), level=COMPRESSION_LEVEL)


def decompress_messages(compressed_data: bytes) -> list[dict[str, Any]]:
    """Decompress zlib BYTEA blob back into messages list."""
    if not compressed_data:
        return []
    decompressed_bytes = zlib.decompress(compressed_data)
    return json.loads(decompressed_bytes.decode("utf-8"))


def generate_title_from_messages(messages: list[dict[str, Any]]) -> str:
    """Derive a succinct conversation title from the first user message."""
    for msg in messages:
        if msg.get("role") == "user" and msg.get("content"):
            content = str(msg["content"]).strip().replace("\n", " ")
            if len(content) > 45:
                return content[:42] + "..."
            return content or "New Conversation"
    return "New Conversation"


class ConversationNotOwned(Exception):
    """A conversation_id that names a row belonging to somebody else.

    The lookup below is scoped by `user_id`, so another user's row simply misses
    and control used to fall through to the create branch - which built the row
    with `id=conversation_id`, an INSERT onto an occupied primary key. The
    IntegrityError was caught and logged by the streaming route, so the
    visitor's transcript was silently never saved.
    """


async def conversation_belongs_to_other_user(
    db: AsyncSession, user_id: UUID, conversation_id: UUID
) -> bool:
    """True when the id exists but is not this user's.

    Lets the route answer before it starts streaming, when a status code can
    still reach the client.
    """
    result = await db.execute(
        select(AIConversation.user_id).where(AIConversation.id == conversation_id)
    )
    owner = result.scalar_one_or_none()
    return owner is not None and owner != user_id


async def save_or_update_conversation(
    db: AsyncSession,
    user_id: UUID,
    conversation_id: Optional[UUID],
    model_id: str,
    messages: list[dict[str, Any]],
    custom_title: Optional[str] = None,
) -> AIConversation:
    """
    Save or update an AI conversation compressed in PostgreSQL.
    If conversation_id is provided and exists, update it.
    Otherwise create a new record.

    Raises ConversationNotOwned when the id names another user's row, rather
    than colliding with it on insert.
    """
    compressed_blob = compress_messages(messages)
    message_count = len(messages)
    now = datetime.now(timezone.utc)

    if conversation_id:
        result = await db.execute(
            select(AIConversation).where(
                AIConversation.id == conversation_id,
                AIConversation.user_id == user_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.compressed_payload = compressed_blob
            existing.message_count = message_count
            existing.model_id = model_id
            existing.updated_at = now
            if custom_title:
                existing.title = custom_title
            await db.commit()
            await db.refresh(existing)
            return existing

        # The scoped lookup missing does not mean the id is free. Falling
        # through to the create branch with it would INSERT onto a primary key
        # another account already holds.
        if await conversation_belongs_to_other_user(db, user_id, conversation_id):
            raise ConversationNotOwned(str(conversation_id))

    # Create new conversation
    new_title = custom_title or generate_title_from_messages(messages)
    conversation = AIConversation(
        id=conversation_id or uuid.uuid4(),
        user_id=user_id,
        title=new_title,
        model_id=model_id,
        compressed_payload=compressed_blob,
        message_count=message_count,
        created_at=now,
        updated_at=now,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def get_user_conversations(
    db: AsyncSession, user_id: UUID, limit: int = 50
) -> list[dict[str, Any]]:
    """Fetch conversation summaries (excluding compressed binary payload for efficiency)."""
    result = await db.execute(
        select(
            AIConversation.id,
            AIConversation.title,
            AIConversation.model_id,
            AIConversation.message_count,
            AIConversation.created_at,
            AIConversation.updated_at,
        )
        .where(AIConversation.user_id == user_id)
        .order_by(AIConversation.updated_at.desc())
        .limit(limit)
    )

    rows = result.all()
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "model_id": row.model_id,
            "message_count": row.message_count,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


async def get_conversation_detail(
    db: AsyncSession, user_id: UUID, conversation_id: UUID
) -> Optional[dict[str, Any]]:
    """Retrieve full conversation details including decompressed message history."""
    result = await db.execute(
        select(AIConversation).where(
            AIConversation.id == conversation_id,
            AIConversation.user_id == user_id,
        )
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        return None

    decompressed_history = decompress_messages(conversation.compressed_payload)

    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "model_id": conversation.model_id,
        "message_count": conversation.message_count,
        "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
        "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
        "messages": decompressed_history,
    }


async def delete_conversation(
    db: AsyncSession, user_id: UUID, conversation_id: UUID
) -> bool:
    """Delete a conversation belonging to user_id."""
    result = await db.execute(
        delete(AIConversation).where(
            AIConversation.id == conversation_id,
            AIConversation.user_id == user_id,
        )
    )
    await db.commit()
    return result.rowcount > 0


async def delete_all_conversations(db: AsyncSession, user_id: UUID) -> int:
    """Delete every conversation belonging to user_id. Returns the row count.

    Clearing all history was a browser-only operation: it emptied
    `rj_chat_sessions` and left every `ai_conversations` row in place, so the
    next `syncServerHistory()` listed them all again and the history the
    visitor had just deleted came back. Deleting them one at a time from the
    client would not have fixed it either - `GET /chat/history` is capped at
    100 rows and `MAX_SESSIONS` truncates the rail at 50, so rows the browser
    has never seen are unreachable from it by construction. One statement,
    scoped by `user_id`, is the only thing that actually empties the account.
    """
    result = await db.execute(
        delete(AIConversation).where(AIConversation.user_id == user_id)
    )
    await db.commit()
    return result.rowcount or 0
