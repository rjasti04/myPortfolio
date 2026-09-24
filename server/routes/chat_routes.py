import json
import uuid
import logging
import asyncio
from typing import AsyncGenerator, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from sqlalchemy.ext.asyncio import AsyncSession

from server.auth.dependencies import get_current_user, get_optional_current_user
from server.auth.session_token import verified_session_id
from server.db.database import get_db
from server.models.user import User
from server.schemas.chat import ChatStreamRequest
from server.services.bedrock_service import bedrock_service
from server.services.chat_history_service import (
    conversation_belongs_to_other_user,
    delete_all_conversations,
    delete_conversation,
    get_conversation_detail,
    get_user_conversations,
    save_or_update_conversation,
)
from server.models.event import UserActivityEvent
from server.utils.role_utils import ensure_alternating_roles
from server.config.settings import (
    ALLOWED_MODEL_IDS,
    CHAT_FREE_MESSAGE_LIMIT,
    DEFAULT_MODEL_ID,
)
from server.config.bedrock import acquire_bedrock_slot

router = APIRouter(prefix="/chat", tags=["Chat & AI"])
logger = logging.getLogger("server.chat_routes")


def enforce_free_message_limit(messages, current_user: Optional[User]) -> None:
    """Refuse an anonymous conversation past CHAT_FREE_MESSAGE_LIMIT user turns.

    chat.js caps anonymous conversations and already handles this 401, but the
    limit was only ever enforced in the browser: calling the API directly gave
    an anonymous caller unlimited inference at our expense. Both routes that
    reach Bedrock call this - `/chat/summarize` used to skip it, so the two
    enforced different contracts for the same anonymous caller (ADR-023).

    A plain function rather than a dependency: as a dependency it would have
    to declare the request body a second time beside the route's own.
    """
    if current_user is not None:
        return
    user_messages = sum(1 for message in messages if message.role == "user")
    if user_messages > CHAT_FREE_MESSAGE_LIMIT:
        raise HTTPException(
            status_code=401,
            detail="You have reached the maximum number of free messages. Please log in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("", summary="Stream Bedrock Chat Completion")
@router.post("/", summary="Stream Bedrock Chat Completion")
@router.post("/stream", summary="Stream Bedrock Chat Completion with Prompt Caching")
async def chat_stream_endpoint(
    request_data: ChatStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Server-Sent Events (SSE) chat streaming endpoint.
    Leverages Bedrock prompt caching for system prompts and logs telemetry to PostgreSQL.
    """
    requested_model = request_data.model_id or DEFAULT_MODEL_ID
    if ALLOWED_MODEL_IDS and requested_model not in ALLOWED_MODEL_IDS:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {requested_model}")

    enforce_free_message_limit(request_data.messages, current_user)

    messages_payload = ensure_alternating_roles([msg.model_dump() for msg in request_data.messages])

    # Bedrock rejects an empty `messages` array, and the service turns that
    # ValidationException into an error frame inside an otherwise-successful 200
    # - after spending a concurrency slot and a rate-limit token. A blank
    # message is refused by `ChatMessage.content` before it reaches here; this
    # is the backstop for any other way the payload could come back empty.
    if not messages_payload:
        raise HTTPException(status_code=400, detail="A message cannot be empty.")

    # Before the slot is taken and the stream begins, while a status code can
    # still reach the client. A conversation_id naming somebody else's row used
    # to fall through to an INSERT on their primary key; the IntegrityError was
    # swallowed by the generator's except-clause and the transcript was lost
    # without the visitor being told anything.
    if current_user is not None and request_data.conversation_id:
        try:
            claimed_id = uuid.UUID(request_data.conversation_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid conversation_id.") from None
        if await conversation_belongs_to_other_user(db, current_user.id, claimed_id):
            # 404, not 403: confirming the id exists would make this an oracle
            # for other people's conversation ids.
            raise HTTPException(status_code=404, detail="Conversation not found")

    # Nothing in the frontend ever sent this header, and nothing set the
    # `session_id` cookie read alongside it, so no production turn was ever
    # attributed to a session and the telemetry row below was never written.
    session_uuid = verified_session_id(request)

    slot = await acquire_bedrock_slot("AI streaming service is busy. Try again shortly.")

    async def event_generator() -> AsyncGenerator[str, None]:
        complete_text = ""
        telemetry_metrics = None
        try:
            # No system_prompt: the service falls back to DEFAULT_SYSTEM_PROMPT.
            # Callers used to be able to override it, unauthenticated and
            # uncapped - see the note on ChatStreamRequest.
            async for chunk in bedrock_service.stream_chat_response(
                messages=messages_payload,
                model_id=requested_model,
                session_id=str(session_uuid) if session_uuid else None,
            ):
                if chunk["type"] == "delta":
                    text_delta = chunk["text"]
                    complete_text += text_delta
                    yield f"data: {json.dumps({'text': text_delta})}\n\n"
                    await asyncio.sleep(0)

                elif chunk["type"] == "metrics":
                    telemetry_metrics = chunk["metrics"]
                    yield f"data: {json.dumps({'type': 'metrics', 'metrics': telemetry_metrics})}\n\n"
                    await asyncio.sleep(0)

                elif chunk["type"] == "error":
                    logger.error(f"Bedrock streaming error for model {requested_model}: {chunk['error']}")
                    yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                    await asyncio.sleep(0)

            # Log observability telemetry event to PostgreSQL if session_id exists
            if telemetry_metrics and session_uuid:
                try:
                    activity_event = UserActivityEvent(
                        session_id=session_uuid,
                        event_type="ai_llm_telemetry",
                        page_path=request.url.path,
                        event_data={
                            "model_id": telemetry_metrics.get("model_id"),
                            "input_tokens": telemetry_metrics.get("input_tokens"),
                            "output_tokens": telemetry_metrics.get("output_tokens"),
                            "cache_read_tokens": telemetry_metrics.get("cache_read_tokens"),
                            "cache_creation_tokens": telemetry_metrics.get("cache_creation_tokens"),
                            "cache_hit": telemetry_metrics.get("cache_hit"),
                            "latency_ms": telemetry_metrics.get("latency_ms"),
                            "conversation_id": request_data.conversation_id,
                        },
                    )
                    db.add(activity_event)
                    await db.commit()
                except Exception as exc:
                    logger.warning(f"Failed to record LLM telemetry event: {exc}")
                    await db.rollback()

            # Persist the transcript for signed-in users. ai_conversations, its
            # service and its migration all shipped, but nothing ever wrote to
            # the table because the only code that called this lived in an
            # unrouted module.
            if current_user is not None and complete_text:
                try:
                    transcript = [
                        {"role": message.role, "content": message.content}
                        for message in request_data.messages
                    ] + [{"role": "assistant", "content": complete_text}]
                    conversation_uuid = (
                        uuid.UUID(request_data.conversation_id)
                        if request_data.conversation_id
                        else None
                    )
                    # The request-scoped session, same as the telemetry write
                    # above: it stays open for the life of the streaming
                    # response. The unrouted controller opened its own session
                    # straight off the engine, which also made it untestable,
                    # since a dependency override cannot reach past it.
                    await save_or_update_conversation(
                        db=db,
                        user_id=current_user.id,
                        conversation_id=conversation_uuid,
                        model_id=requested_model,
                        messages=transcript,
                    )
                except (ValueError, TypeError) as exc:
                    logger.warning(f"Skipping history save, bad conversation_id: {exc}")
                except Exception as exc:
                    logger.error(f"Failed to save chat history: {exc}")
        finally:
            await slot.release()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
        # Backstop for the case where the body is never iterated at all, so the
        # generator's `finally` above never runs. Releasing twice is a no-op.
        background=BackgroundTask(slot.release),
    )

@router.post("/summarize", summary="Summarize Conversation History")
async def chat_summarize_endpoint(
    request_data: ChatStreamRequest,
    request: Request,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """Summarize long conversation history to fit within token limits."""
    # Before the slot is taken, so a refused call costs nothing.
    enforce_free_message_limit(request_data.messages, current_user)
    messages_payload = ensure_alternating_roles([msg.model_dump() for msg in request_data.messages])

    # This calls Bedrock exactly like the streaming route does, but used to take
    # no slot at all, so it could drive unbounded concurrent inference straight
    # past CHAT_MAX_CONCURRENCY.
    if not messages_payload:
        raise HTTPException(status_code=400, detail="There is nothing to summarize.")

    session_uuid = verified_session_id(request)
    slot = await acquire_bedrock_slot("AI summarization service is busy. Try again shortly.")
    try:
        summary_text = ""
        stream_error = None
        async for chunk in bedrock_service.stream_chat_response(
            messages=messages_payload,
            system_prompt="Summarize the key points of the preceding conversation concisely in 2-3 sentences.",
            session_id=str(session_uuid) if session_uuid else None,
        ):
            if chunk.get("type") == "delta":
                summary_text += chunk.get("text", "")
            elif chunk.get("type") == "error":
                stream_error = chunk.get("error")

        # A failed call used to be indistinguishable from a successful one: this
        # loop read only `delta` frames, so an error frame left `summary_text`
        # empty and the placeholder below was returned with a 200 - a summary
        # the model never produced, cached by the client as if it had.
        if stream_error:
            logger.error(f"Bedrock summarization failed: {stream_error}")
            raise HTTPException(status_code=502, detail="Could not summarize the conversation.")
        if not summary_text.strip():
            raise HTTPException(status_code=502, detail="Could not summarize the conversation.")
        return {"summary": summary_text}
    finally:
        await slot.release()


# --- Conversation history ---------------------------------------------------
# These were implemented in a controller module that no router ever included,
# so the whole feature was unreachable despite having a model and a migration.

@router.get("/history", summary="List the caller's saved conversations")
async def list_chat_history(
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return {"conversations": await get_user_conversations(db=db, user_id=current_user.id, limit=limit)}


@router.get("/history/{conversation_id}", summary="Fetch one conversation transcript")
async def get_chat_history_detail(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    detail = await get_conversation_detail(
        db=db, user_id=current_user.id, conversation_id=conversation_id
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return detail


# Registered before the parameterised route so the intent reads in one place;
# the two paths are distinct, so ordering is style rather than precedence.
@router.delete("/history", summary="Delete every conversation the caller owns")
async def delete_all_chat_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Empty the caller's server-side history.

    The rail's "Delete all" only ever cleared `localStorage`, so every
    transcript stayed in `ai_conversations` and the next sync listed them
    straight back. The client cannot fix that by looping over the rail: the
    listing is capped and the rail is truncated at `MAX_SESSIONS`, so rows
    older than the newest 50 are not reachable from the browser at all.
    """
    return {"deleted": await delete_all_conversations(db=db, user_id=current_user.id)}


@router.delete("/history/{conversation_id}", summary="Delete one conversation")
async def delete_chat_history(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await delete_conversation(
        db=db, user_id=current_user.id, conversation_id=conversation_id
    ):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"detail": "Conversation deleted successfully"}
