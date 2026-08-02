import asyncio
import threading
from uuid import UUID
from typing import Optional
from concurrent.futures import TimeoutError as FutureTimeoutError

import structlog
from fastapi import Request, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from server.db.database import get_db, engine
from server.models.user import User
from server.auth.dependencies import get_current_user, get_optional_current_user
from server.config.settings import (
    DEFAULT_MODEL_ID,
    ALLOWED_MODEL_IDS,
    CHAT_STREAM_QUEUE_SIZE,
    BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS,
)
from server.config.bedrock import (
    bedrock_runtime,
    acquire_bedrock_slot,
    bedrock_semaphore,
)
from server.utils.role_utils import ensure_alternating_roles
from server.schemas.chat import ChatRequest
from server.services.chat_history_service import (
    save_or_update_conversation,
    get_user_conversations,
    get_conversation_detail,
    delete_conversation,
)

logger = structlog.get_logger(__name__)


def _resolve_model_id(requested_model: Optional[str]) -> str:
    model_id = requested_model or DEFAULT_MODEL_ID
    if model_id not in ALLOWED_MODEL_IDS:
        raise HTTPException(400, "Unsupported model")
    return model_id


async def chat_endpoint(
    payload: ChatRequest,
    http_request: Request,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    request_id = http_request.scope.get("request_id", "unknown")

    # Restrict unauthenticated users to max 6 messages in the payload
    user_message_count = sum(1 for m in payload.messages if m.role == "user")
    if not current_user and user_message_count > 6:
        raise HTTPException(
            status_code=401,
            detail="You have reached the maximum number of free messages. Please log in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    model_id = _resolve_model_id(payload.model)
    logger.info(
        "chat_request",
        request_id=request_id,
        model_id=model_id,
        message_count=len(payload.messages),
    )

    # Build Converse-compatible message list (enforce alternation)
    converse_messages = ensure_alternating_roles([
        {"role": msg.role, "content": [{"text": msg.content}]}
        for msg in payload.messages
    ])

    await acquire_bedrock_slot("Chat service is busy. Try again shortly.")

    async def generate_response():
        queue: asyncio.Queue = asyncio.Queue(maxsize=CHAT_STREAM_QUEUE_SIZE)
        loop = asyncio.get_running_loop()
        stop_stream = threading.Event()
        assistant_chunks: list[str] = []

        def enqueue_from_thread(item) -> bool:
            if stop_stream.is_set():
                return False
            try:
                future = asyncio.run_coroutine_threadsafe(queue.put(item), loop)
                future.result(timeout=BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS)
                return True
            except (FutureTimeoutError, RuntimeError):
                stop_stream.set()
                return False

        def _stream_worker():
            """Runs in a thread – reads the synchronous Bedrock stream and
            pushes chunks (or a sentinel) into the async queue."""
            try:
                response = bedrock_runtime.converse_stream(
                    modelId=model_id,
                    messages=converse_messages,
                    inferenceConfig={"maxTokens": 2000},
                )
                stream = response.get("stream")
                if stream:
                    try:
                        for event in stream:
                            if stop_stream.is_set():
                                break
                            delta = event.get("contentBlockDelta")
                            if delta:
                                text = delta.get("delta", {}).get("text", "")
                                if text and not enqueue_from_thread(text):
                                    break
                            stop_event = event.get("messageStop")
                            if stop_event and stop_event.get("stopReason") == "max_tokens":
                                enqueue_from_thread("\n[__TRUNCATED__]")
                    finally:
                        close_stream = getattr(stream, "close", None)
                        if callable(close_stream):
                            close_stream()
            except Exception as exc:
                enqueue_from_thread(exc)
            finally:
                enqueue_from_thread(None)

        thread_future = None
        try:
            thread_future = loop.run_in_executor(None, _stream_worker)

            while True:
                if await http_request.is_disconnected():
                    stop_stream.set()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=1)
                except asyncio.TimeoutError:
                    if stop_stream.is_set():
                        break
                    continue
                if item is None:
                    break
                if isinstance(item, Exception):
                    logger.error(
                        "bedrock_stream_error",
                        request_id=request_id,
                        model_id=model_id,
                        error=str(item),
                        error_type=type(item).__name__,
                    )
                    yield "\n(Error: AI service unavailable)"
                    break
                if isinstance(item, str):
                    assistant_chunks.append(item)
                yield item

            stop_stream.set()
            if thread_future:
                try:
                    await asyncio.wait_for(thread_future, timeout=5)
                except asyncio.TimeoutError:
                    logger.warning("Bedrock stream worker did not stop promptly")

            # Persist compressed conversation history if user is authenticated
            if current_user and assistant_chunks:
                try:
                    assistant_response = "".join(assistant_chunks).replace("\n[__TRUNCATED__]", "")
                    full_transcript = [
                        {"role": m.role, "content": m.content}
                        for m in payload.messages
                    ] + [{"role": "assistant", "content": assistant_response}]

                    conv_uuid = UUID(payload.conversation_id) if payload.conversation_id else None
                    async with AsyncSession(engine) as db_session:
                        await save_or_update_conversation(
                            db=db_session,
                            user_id=current_user.id,
                            conversation_id=conv_uuid,
                            model_id=model_id,
                            messages=full_transcript,
                        )
                except Exception as save_err:
                    logger.error("failed_to_save_chat_history", user_id=str(current_user.id), error=str(save_err))
        finally:
            stop_stream.set()
            bedrock_semaphore.release()

    return StreamingResponse(
        generate_response(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def list_chat_histories(
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve compressed conversation summaries for the logged in user."""
    histories = await get_user_conversations(db=db, user_id=current_user.id, limit=limit)
    return {"conversations": histories}


async def get_chat_history_detail(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch and decompress full message transcript for a specific conversation."""
    detail = await get_conversation_detail(db=db, user_id=current_user.id, conversation_id=conversation_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return detail


async def delete_chat_history(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a conversation belonging to the logged in user."""
    deleted = await delete_conversation(db=db, user_id=current_user.id, conversation_id=conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"detail": "Conversation deleted successfully"}


async def chat_summarize_endpoint(
    payload: ChatRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    user_message_count = sum(1 for m in payload.messages if m.role == "user")
    if not current_user and user_message_count > 6:
        raise HTTPException(
            status_code=401,
            detail="You have reached the maximum number of free messages. Please log in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    model_id = _resolve_model_id(payload.model)

    converse_messages = ensure_alternating_roles([
        {"role": msg.role, "content": [{"text": msg.content}]}
        for msg in payload.messages
    ])

    await acquire_bedrock_slot()
    try:
        response = await asyncio.to_thread(
            bedrock_runtime.converse,
            modelId=model_id,
            messages=converse_messages,
            system=[{"text": "You are a helpful assistant. Please provide a concise summary of the key facts, user preferences, and context established in the conversation above. Omit pleasantries."}],
            inferenceConfig={"maxTokens": 500}
        )
        summary_text = response.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")
        return {"summary": summary_text}
    except Exception as e:
        logger.exception("Error summarizing chat history: %s", e)
        raise HTTPException(500, "Summarization failed")
    finally:
        bedrock_semaphore.release()
