import json
import uuid
import logging
import asyncio
from typing import AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from sqlalchemy.ext.asyncio import AsyncSession

from server.db.database import get_db
from server.schemas.chat import ChatStreamRequest
from server.services.bedrock_service import bedrock_service
from server.models.event import UserActivityEvent
from server.utils.role_utils import ensure_alternating_roles
from server.config.settings import ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID
from server.config.bedrock import acquire_bedrock_slot

router = APIRouter(prefix="/chat", tags=["Chat & AI"])
logger = logging.getLogger("server.chat_routes")

@router.post("", summary="Stream Bedrock Chat Completion")
@router.post("/", summary="Stream Bedrock Chat Completion")
@router.post("/stream", summary="Stream Bedrock Chat Completion with Prompt Caching")
async def chat_stream_endpoint(
    request_data: ChatStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events (SSE) chat streaming endpoint.
    Leverages Bedrock prompt caching for system prompts and logs telemetry to PostgreSQL.
    """
    requested_model = request_data.model_id or DEFAULT_MODEL_ID
    if ALLOWED_MODEL_IDS and requested_model not in ALLOWED_MODEL_IDS:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {requested_model}")

    messages_payload = ensure_alternating_roles([msg.model_dump() for msg in request_data.messages])
    session_id_raw = request.headers.get("X-Session-ID") or request.cookies.get("session_id")

    session_uuid = None
    if session_id_raw:
        try:
            session_uuid = uuid.UUID(session_id_raw)
        except ValueError:
            pass

    slot = await acquire_bedrock_slot("AI streaming service is busy. Try again shortly.")

    async def event_generator() -> AsyncGenerator[str, None]:
        complete_text = ""
        telemetry_metrics = None
        try:
            async for chunk in bedrock_service.stream_chat_response(
                messages=messages_payload,
                system_prompt=request_data.system_prompt,
                model_id=requested_model,
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
async def chat_summarize_endpoint(request_data: ChatStreamRequest):
    """Summarize long conversation history to fit within token limits."""
    messages_payload = ensure_alternating_roles([msg.model_dump() for msg in request_data.messages])

    # This calls Bedrock exactly like the streaming route does, but used to take
    # no slot at all, so it could drive unbounded concurrent inference straight
    # past CHAT_MAX_CONCURRENCY.
    slot = await acquire_bedrock_slot("AI summarization service is busy. Try again shortly.")
    try:
        summary_text = ""
        async for chunk in bedrock_service.stream_chat_response(
            messages=messages_payload,
            system_prompt="Summarize the key points of the preceding conversation concisely in 2-3 sentences.",
        ):
            if chunk.get("type") == "delta":
                summary_text += chunk.get("text", "")
        if not summary_text:
            summary_text = "Summary of preceding conversation."
        return {"summary": summary_text}
    finally:
        await slot.release()

