from fastapi import FastAPI, HTTPException, Request, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from typing import Optional, Any
from uuid import UUID
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from collections import defaultdict
import asyncpg
import asyncio
import os
import json
import time
import logging

import boto3
import orjson

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATABASE_URL = os.getenv("DATABASE_URL")
AWS_REGION = os.getenv("AWS_REGION")
DEFAULT_MODEL_ID = os.getenv("DEFAULT_MODEL_ID")

_raw_origins = os.getenv("CORS_ORIGINS", "")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

API_KEY = os.getenv("API_KEY", "")
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", str(1_048_576)))  # 1 MB

# Boto3 Bedrock clients
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION
)
bedrock_mgmt = boto3.client(
    "bedrock",
    region_name=AWS_REGION
)

# ---------------------------------------------------------------------------
# Rate Limiting Middleware (in-memory, per-IP)
# ---------------------------------------------------------------------------

class RateLimitMiddleware:
    """Simple sliding-window rate limiter. Good enough for single-instance
    deployments; use Redis-backed limiting for multi-instance."""

    def __init__(self, app, max_requests: int = 60, window_seconds: int = 60):
        self.app = app
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        forwarded = request.headers.get("x-forwarded-for")
        client_ip = (
            forwarded.split(",")[0].strip()
            if forwarded
            else (request.client.host if request.client else "unknown")
        )

        now = time.time()
        window = self.window_seconds
        self._hits[client_ip] = [
            t for t in self._hits[client_ip] if now - t < window
        ]

        # Prune empty entries to prevent unbounded dict growth
        if not self._hits[client_ip]:
            del self._hits[client_ip]

        if len(self._hits.get(client_ip, [])) >= self.max_requests:
            from starlette.responses import JSONResponse

            response = JSONResponse(
                {"detail": "Rate limit exceeded. Try again later."},
                status_code=429,
            )
            await response(scope, receive, send)
            return

        self._hits[client_ip].append(now)
        await self.app(scope, receive, send)

# ---------------------------------------------------------------------------
# Body Size Limit Middleware
# ---------------------------------------------------------------------------

class BodySizeLimitMiddleware:
    """Reject requests whose Content-Length exceeds a threshold."""

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                cl = int(content_length)
            except (ValueError, TypeError):
                cl = 0
            if cl > self.max_bytes:
                from starlette.responses import JSONResponse

                response = JSONResponse(
                    {"detail": "Request body too large"},
                    status_code=413,
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    yield
    await app.state.pool.close()

app = FastAPI(title="Activity Tracker API", version="1.0.0", lifespan=lifespan)

app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_BODY_BYTES)
app.add_middleware(RateLimitMiddleware, max_requests=60, window_seconds=60)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# ---------------------------------------------------------------------------
# Auth helper (optional â€” only enforced when API_KEY env var is set)
# ---------------------------------------------------------------------------

async def verify_api_key(request: Request):
    """Guard for read endpoints. Skipped when API_KEY is not configured."""
    if not API_KEY:
        return
    key = request.headers.get("x-api-key", "")
    if key != API_KEY:
        raise HTTPException(403, "Invalid or missing API key")

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SessionCreate(BaseModel):
    ip_address:  Optional[str] = None
    user_agent:  Optional[str] = None
    device_type: Optional[str] = None  # "desktop" | "mobile" | "tablet" | etc.

class SessionEnd(BaseModel):
    end_reason: Optional[str] = None   # "logout" | "timeout" | "closed" | etc.

class SessionUpdate(BaseModel):
    """Lightweight heartbeat â€” just bumps last_active_at."""
    pass

class EventCreate(BaseModel):
    session_id: UUID
    event_type: str                    # "page_view" | "click" | "scroll" | etc.
    page_path:  Optional[str] = None
    event_data: Optional[dict[str, Any]] = None

    @field_validator("event_type")
    @classmethod
    def event_type_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("event_type must not be blank")
        return v.strip()

    @field_validator("event_data")
    @classmethod
    def event_data_size_limit(cls, v):
        if v is not None:
            if len(json.dumps(v)) > 4096:
                raise ValueError("event_data exceeds 4 KB limit")
        return v

class BulkEventCreate(BaseModel):
    events: list[EventCreate]

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None  # Bedrock model ID; falls back to DEFAULT_MODEL_ID

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)

@app.get("/health", summary="Health check endpoint")
async def health_check():
    """Verify application and database health."""
    try:
        if not hasattr(app.state, "pool"):
            return JSONResponse(status_code=503, content={"status": "starting up"})
        
        # Check DB connection
        async with app.state.pool.acquire() as conn:
            await conn.execute("SELECT 1")
            
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(status_code=503, content={"status": "error", "detail": "Database unavailable"})

# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------

@app.post(
    "/sessions",
    status_code=201,
    summary="Start a new session",
    dependencies=[Depends(verify_api_key)],
)
async def create_session(payload: SessionCreate, request: Request):
    """
    Creates a new row in user_sessions and returns the generated session_id.
    ip_address can be passed explicitly or auto-detected from the request.
    """
    # Support reverse proxies like Nginx/Caddy by checking X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    ip = payload.ip_address or client_ip

    async with request.app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO user_sessions (ip_address, user_agent, device_type)
            VALUES ($1, $2, $3)
            RETURNING session_id, started_at
            """,
            ip,
            payload.user_agent,
            payload.device_type,
        )

    return {"session_id": str(row["session_id"]), "started_at": row["started_at"]}


@app.patch("/sessions/{session_id}/heartbeat", summary="Update last_active_at")
async def session_heartbeat(session_id: UUID, request: Request):
    """Call periodically (e.g. every 60 s) to keep the session alive."""
    async with request.app.state.pool.acquire() as conn:
        # Removing `AND is_active = true` so a heartbeat can revive an inactive session
        result = await conn.execute(
            """
            UPDATE user_sessions
               SET last_active_at = now(),
                   is_active = true
             WHERE session_id = $1
            """,
            session_id,
        )

    if result == "UPDATE 0":
        raise HTTPException(404, "Session not found")

    return {"status": "ok", "last_active_at": _now()}


@app.patch("/sessions/{session_id}/end", summary="End a session")
async def end_session(session_id: UUID, payload: SessionEnd, request: Request):
    """Marks the session inactive and records ended_at + end_reason."""
    async with request.app.state.pool.acquire() as conn:
        # Removing `AND is_active = true` allows multiple repeat "end" calls 
        # (e.g. from tab visibility toggling) to succeed without throwing 404s.
        result = await conn.execute(
            """
            UPDATE user_sessions
               SET is_active      = false,
                   ended_at       = now(),
                   last_active_at = now(),
                   end_reason     = $2
             WHERE session_id = $1
            """,
            session_id,
            payload.end_reason,
        )

    if result == "UPDATE 0":
        raise HTTPException(404, "Session not found")

    return {"status": "ended", "ended_at": _now()}


@app.get(
    "/sessions/{session_id}",
    summary="Get session details",
    dependencies=[Depends(verify_api_key)],
)
async def get_session(session_id: UUID, request: Request):
    async with request.app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT session_id, started_at, ended_at, is_active,
                   device_type, user_agent, last_active_at, end_reason
              FROM user_sessions
             WHERE session_id = $1
            """,
            session_id,
        )

    if not row:
        raise HTTPException(404, "Session not found")

    return dict(row)

# ---------------------------------------------------------------------------
# Event endpoints
# ---------------------------------------------------------------------------

@app.post(
    "/events",
    status_code=201,
    summary="Record a single activity event",
    dependencies=[Depends(verify_api_key)],
)
async def create_event(payload: EventCreate, request: Request):
    """
    Inserts one row into user_activity_events.
    The session must exist in user_sessions.
    """
    async with request.app.state.pool.acquire() as conn:
        # Verify session exists (optional guard â€” remove if perf-sensitive)
        exists = await conn.fetchval(
            "SELECT 1 FROM user_sessions WHERE session_id = $1", payload.session_id
        )
        if not exists:
            raise HTTPException(404, f"session_id {payload.session_id} not found")

        row = await conn.fetchrow(
            """
            INSERT INTO user_activity_events (session_id, event_type, page_path, event_data)
            VALUES ($1, $2, $3, $4::jsonb)
            RETURNING event_id, created_at
            """,
            payload.session_id,
            payload.event_type,
            payload.page_path,
            orjson.dumps(payload.event_data).decode('utf-8') if payload.event_data is not None else None,
        )

    return {"event_id": row["event_id"], "created_at": row["created_at"]}


@app.post(
    "/events/bulk",
    status_code=201,
    summary="Record multiple events in one shot",
    dependencies=[Depends(verify_api_key)],
)
async def create_events_bulk(payload: BulkEventCreate, request: Request):
    """
    Inserts up to 500 events in a single transaction using executemany.
    Useful for batching client-side queued events on page unload.
    """
    if not payload.events:
        raise HTTPException(400, "events list is empty")
    if len(payload.events) > 500:
        raise HTTPException(400, "Maximum 500 events per bulk request")

    rows = [
        (e.session_id, e.event_type, e.page_path, orjson.dumps(e.event_data).decode('utf-8') if e.event_data is not None else None)
        for e in payload.events
    ]

    async with request.app.state.pool.acquire() as conn:
        try:
            async with conn.transaction():
                await conn.executemany(
                    """
                    INSERT INTO user_activity_events (session_id, event_type, page_path, event_data)
                    VALUES ($1, $2, $3, $4::jsonb)
                    """,
                    rows,
                )
        except asyncpg.exceptions.ForeignKeyViolationError:
            raise HTTPException(422, "One or more session IDs not found in database")
        except Exception:
            logger.exception("Bulk event insert failed")
            raise HTTPException(500, "Internal server error")

    return {"inserted": len(rows)}


@app.get(
    "/sessions/{session_id}/events",
    summary="List events for a session",
    dependencies=[Depends(verify_api_key)],
)
async def get_session_events(
    session_id: UUID,
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT event_id, event_type, page_path, event_data, created_at
              FROM user_activity_events
             WHERE session_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3
            """,
            session_id,
            limit,
             offset,
        )

    return [dict(r) for r in rows]

# ---------------------------------------------------------------------------
# HTTP Chat Endpoint  (Bedrock Converse API – model-agnostic)
# ---------------------------------------------------------------------------

@app.post("/chat", dependencies=[Depends(verify_api_key)])
async def chat_endpoint(request: ChatRequest):
    model_id = request.model or DEFAULT_MODEL_ID

    # Build Converse-compatible message list
    converse_messages = [
        {"role": msg.role, "content": [{"text": msg.content}]}
        for msg in request.messages
    ]

    async def generate_response():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _stream_worker():
            """Runs in a thread – reads the synchronous Bedrock stream and
            pushes chunks (or a sentinel) into the async queue."""
            try:
                response = bedrock_runtime.converse_stream(
                    modelId=model_id,
                    messages=converse_messages,
                )
                stream = response.get("stream")
                if stream:
                    for event in stream:
                        delta = event.get("contentBlockDelta")
                        if delta:
                            text = delta.get("delta", {}).get("text", "")
                            if text:
                                loop.call_soon_threadsafe(queue.put_nowait, text)
            except Exception as exc:
                loop.call_soon_threadsafe(
                    queue.put_nowait, exc
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

        # Kick off the blocking reader in a background thread
        thread_future = loop.run_in_executor(None, _stream_worker)

        # Yield chunks as they arrive
        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                logger.exception("Error calling Bedrock model %s", model_id, exc_info=item)
                yield f"\n(Error: {item})"
                break
            yield item

        # Ensure the thread has finished
        await thread_future

    return StreamingResponse(
        generate_response(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disables Nginx buffering
        },
    )


# ---------------------------------------------------------------------------
# Model listing endpoint
# ---------------------------------------------------------------------------

@app.get(
    "/models",
    summary="List available Bedrock foundation models",
    dependencies=[Depends(verify_api_key)],
)
async def list_models():
    """Returns Bedrock foundation models available in the configured region."""
    try:
        resp = await asyncio.to_thread(
            bedrock_mgmt.list_foundation_models,
        )
        models = [
            {
                "modelId": m["modelId"],
                "modelName": m.get("modelName", ""),
                "provider": m.get("providerName", ""),
                "inputModalities": m.get("inputModalities", []),
                "outputModalities": m.get("outputModalities", []),
            }
            for m in resp.get("modelSummaries", [])
        ]
        return {"models": models}
    except Exception as e:
        logger.error(f"Error listing Bedrock models: {e}")
        raise HTTPException(500, "Unable to list models")