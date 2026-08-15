import json
import uuid
import logging
from typing import AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from server.db.database import get_db
from server.schemas.chat import ChatStreamRequest
from server.services.bedrock_service import bedrock_service
from server.models.event import UserActivityEvent

router = APIRouter(prefix="/chat", tags=["Chat & AI"])
logger = logging.getLogger("server.chat_routes")

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
    messages_payload = [msg.model_dump() for msg in request_data.messages]
    session_id_raw = request.headers.get("X-Session-ID") or request.cookies.get("session_id")

    session_uuid = None
    if session_id_raw:
        try:
            session_uuid = uuid.UUID(session_id_raw)
        except ValueError:
            pass

    async def event_generator() -> AsyncGenerator[str, None]:
        complete_text = ""
        telemetry_metrics = None

        async for chunk in bedrock_service.stream_chat_response(
            messages=messages_payload,
            system_prompt=request_data.system_prompt,
            model_id=request_data.model_id,
        ):
            if chunk["type"] == "delta":
                text_delta = chunk["text"]
                complete_text += text_delta
                yield f"data: {json.dumps({'text': text_delta})}\n\n"

            elif chunk["type"] == "metrics":
                telemetry_metrics = chunk["metrics"]
                yield f"data: {json.dumps({'type': 'metrics', 'metrics': telemetry_metrics})}\n\n"

            elif chunk["type"] == "error":
                logger.error(f"Bedrock streaming error: {chunk['error']}")
                yield f"data: {json.dumps({'error': chunk['error']})}\n\n"

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

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
