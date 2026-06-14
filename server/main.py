from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any, Literal
from uuid import UUID, uuid4
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from collections import defaultdict
from concurrent.futures import TimeoutError as FutureTimeoutError
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, desc
from server.db.database import get_db, engine
from server.models.session import UserSession
from server.models.event import UserActivityEvent
from server.routers import auth
from server.auth.dependencies import get_optional_current_user
from server.models.user import User
from fastapi import Depends
import os
import json
import time
import logging
import ipaddress
import threading
import random

import boto3
import orjson
from botocore.config import Config
import structlog

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(message)s",
)
logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise RuntimeError(f"{name} must be an integer")
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


DATABASE_URL = _required_env("DATABASE_URL")
AWS_REGION = _required_env("AWS_REGION")
DEFAULT_MODEL_ID = _required_env("DEFAULT_MODEL_ID")

_raw_origins = os.getenv("CORS_ORIGINS", "")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not _origins:
    _origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ]

MAX_BODY_BYTES = _env_int("MAX_BODY_BYTES", 1_048_576)  # 1 MB
CHAT_MAX_CONCURRENCY = _env_int("CHAT_MAX_CONCURRENCY", 4)
CHAT_STREAM_QUEUE_SIZE = _env_int("CHAT_STREAM_QUEUE_SIZE", 128)
BEDROCK_TIMEOUT_SECONDS = _env_int("BEDROCK_TIMEOUT_SECONDS", 30)
BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS = _env_int("BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS", 10)

_raw_allowed_models = os.getenv("ALLOWED_MODEL_IDS", "")
ALLOWED_MODEL_IDS = {
    model.strip()
    for model in _raw_allowed_models.split(",")
    if model.strip()
}
ALLOWED_MODEL_IDS.add(DEFAULT_MODEL_ID)


def _parse_proxy_networks(raw: str) -> list[Any]:
    networks = []
    for item in raw.split(","):
        candidate = item.strip()
        if not candidate:
            continue
        try:
            networks.append(ipaddress.ip_network(candidate, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXY_IPS entry: %s", candidate)
    return networks


TRUSTED_PROXY_NETWORKS = _parse_proxy_networks(os.getenv("TRUSTED_PROXY_IPS", ""))

bedrock_config = Config(
    connect_timeout=10,
    read_timeout=BEDROCK_TIMEOUT_SECONDS,
    retries={"max_attempts": 2, "mode": "standard"},
)

# Boto3 Bedrock clients
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    config=bedrock_config,
)
bedrock_mgmt = boto3.client(
    "bedrock",
    region_name=AWS_REGION,
    config=bedrock_config,
)

bedrock_semaphore = asyncio.Semaphore(CHAT_MAX_CONCURRENCY)


async def _acquire_bedrock_slot(
    busy_message: str = "AI service is busy. Try again shortly.",
) -> None:
    try:
        await asyncio.wait_for(bedrock_semaphore.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(429, busy_message)


def _is_trusted_proxy(ip: Optional[str]) -> bool:
    if not ip:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(address in network for network in TRUSTED_PROXY_NETWORKS)


def _client_ip_from_request(request: Request) -> str:
    direct_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded and _is_trusted_proxy(direct_ip):
        forwarded_ips = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
        for candidate in reversed(forwarded_ips):
            try:
                ipaddress.ip_address(candidate)
            except ValueError:
                continue
            if not _is_trusted_proxy(candidate):
                return candidate[:64]
    return direct_ip

# ---------------------------------------------------------------------------
# Request ID Middleware
# ---------------------------------------------------------------------------

class RequestIDMiddleware:
    """Add unique request ID to each request for tracing and logging."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = str(uuid4())
        scope["request_id"] = request_id

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_request_id)

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
        client_ip = _client_ip_from_request(request)

        now = time.time()
        window = self.window_seconds
        
        # Filter existing hits for this IP
        self._hits[client_ip] = [
            t for t in self._hits[client_ip] if now - t < window
        ]

        if len(self._hits[client_ip]) >= self.max_requests:
            response = JSONResponse(
                {"detail": "Rate limit exceeded. Try again later."},
                status_code=429,
            )
            await response(scope, receive, send)
            return

        # Record new hit
        self._hits[client_ip].append(now)

        # Prune empty or expired entries from other IPs to prevent unbounded memory growth
        # We do a randomized cleanup check (1% of requests) to prevent performance overhead
        if random.random() < 0.01:
            for ip in list(self._hits.keys()):
                self._hits[ip] = [t for t in self._hits[ip] if now - t < window]
                if not self._hits[ip]:
                    del self._hits[ip]

        await self.app(scope, receive, send)

# ---------------------------------------------------------------------------
# Body Size Limit Middleware
# ---------------------------------------------------------------------------

class BodyTooLargeError(Exception):
    pass


class BodySizeLimitMiddleware:
    """Reject requests whose Content-Length or streamed body exceeds a threshold."""

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
                cl = self.max_bytes + 1
            if cl > self.max_bytes:
                response = JSONResponse(
                    {"detail": "Request body too large"},
                    status_code=413,
                )
                await response(scope, receive, send)
                return

        received = 0

        async def receive_limited():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLargeError
            return message

        try:
            await self.app(scope, receive_limited, send)
        except BodyTooLargeError:
            response = JSONResponse(
                {"detail": "Request body too large"},
                status_code=413,
            )
            await response(scope, receive, send)

# ---------------------------------------------------------------------------
# FastAPI app setup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()

app = FastAPI(title="Activity Tracker API", version="1.0.0", lifespan=lifespan)

app.include_router(auth.router)

app.add_middleware(RequestIDMiddleware)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_BODY_BYTES)
app.add_middleware(RateLimitMiddleware, max_requests=60, window_seconds=60)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SessionCreate(BaseModel):
    user_agent: Optional[str] = Field(default=None, max_length=2048)
    device_type: Optional[Literal["desktop", "mobile", "tablet", "unknown"]] = None

class SessionEnd(BaseModel):
    end_reason: Optional[
        Literal["logout", "timeout", "closed", "tab_closed_or_hidden", "unknown"]
    ] = None

class SessionUpdate(BaseModel):
    """Lightweight heartbeat â€” just bumps last_active_at."""
    pass

class EventCreate(BaseModel):
    session_id: UUID
    event_type: Literal[
        "page_view",
        "click",
        "scroll_depth",
        "terminal_command",
        "theme_change",
        "copy_email",
        "contact_submission",
    ]
    page_path: Optional[str] = Field(default=None, max_length=256)
    event_data: Optional[dict[str, Any]] = None

    @field_validator("event_data")
    @classmethod
    def event_data_size_limit(cls, v):
        if v is not None:
            if len(json.dumps(v)) > 4096:
                raise ValueError("event_data exceeds 4 KB limit")
        return v

class BulkEventCreate(BaseModel):
    events: list[EventCreate] = Field(..., min_length=1, max_length=500)

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=8_000)

class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=24)
    model: Optional[str] = Field(default=None, max_length=256)

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)

@app.get("/health", summary="Health check endpoint")
async def health_check(request: Request, db: AsyncSession = Depends(get_db)):
    """Verify application and database health."""
    request_id = request.scope.get("request_id", "unknown")
    try:
        # Check DB connection
        await db.execute(select(1))
            
        logger.info(
            "health_check_ok",
            request_id=request_id,
        )
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        logger.error(
            "health_check_failed",
            request_id=request_id,
            error=str(e),
            error_type=type(e).__name__
        )
        return JSONResponse(status_code=503, content={"status": "error", "detail": "Database unavailable"})

# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------

@app.post(
    "/sessions",
    status_code=201,
    summary="Start a new session",
)
async def create_session(payload: SessionCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Creates a new row in user_sessions and returns the generated session_id.
    Client IP is auto-detected from the request.
    """
    request_id = request.scope.get("request_id", "unknown")
    client_ip = _client_ip_from_request(request)

    user_agent_truncated = payload.user_agent[:512] if payload.user_agent else None
    session_db = UserSession(
        ip_address=client_ip,
        user_agent=user_agent_truncated,
        device_type=payload.device_type
    )
    db.add(session_db)
    await db.commit()
    await db.refresh(session_db)

    logger.info(
        "session_created",
        request_id=request_id,
        session_id=str(session_db.session_id),
        device_type=payload.device_type,
        ip_address=client_ip[:15] + "..." if len(client_ip) > 15 else client_ip
    )
    return {"session_id": str(session_db.session_id), "started_at": session_db.started_at}


@app.patch(
    "/sessions/{session_id}/heartbeat",
    summary="Update last_active_at",
)
async def session_heartbeat(session_id: UUID, request: Request, db: AsyncSession = Depends(get_db)):
    """Call periodically (e.g. every 60 s) to keep the session alive."""
    result = await db.execute(
        update(UserSession)
        .where(UserSession.session_id == session_id)
        .values(last_active_at=_now(), is_active=True)
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(404, "Session not found")

    return {"status": "ok", "last_active_at": _now()}


@app.patch(
    "/sessions/{session_id}/end",
    summary="End a session",
)
async def end_session(session_id: UUID, payload: SessionEnd, request: Request, db: AsyncSession = Depends(get_db)):
    """Marks the session inactive and records ended_at + end_reason."""
    result = await db.execute(
        update(UserSession)
        .where(UserSession.session_id == session_id)
        .values(
            is_active=False,
            ended_at=_now(),
            last_active_at=_now(),
            end_reason=payload.end_reason
        )
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(404, "Session not found")

    return {"status": "ended", "ended_at": _now()}


@app.get(
    "/sessions/{session_id}",
    summary="Get session details",
)
async def get_session(session_id: UUID, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserSession).where(UserSession.session_id == session_id))
    session = result.scalars().first()

    if not session:
        raise HTTPException(404, "Session not found")

    return {
        "session_id": session.session_id,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "is_active": session.is_active,
        "device_type": session.device_type,
        "user_agent": session.user_agent,
        "last_active_at": session.last_active_at,
        "end_reason": session.end_reason
    }

# ---------------------------------------------------------------------------
# Event endpoints
# ---------------------------------------------------------------------------

@app.post(
    "/events",
    status_code=201,
    summary="Record a single activity event",
)
async def create_event(payload: EventCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Inserts one row into user_activity_events.
    The session must exist in user_sessions.
    """
    # Verify session exists
    session_exists = await db.execute(select(UserSession).where(UserSession.session_id == payload.session_id))
    if not session_exists.scalars().first():
        raise HTTPException(404, f"session_id {payload.session_id} not found")

    event = UserActivityEvent(
        session_id=payload.session_id,
        event_type=payload.event_type,
        page_path=payload.page_path,
        event_data=payload.event_data
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    return {"event_id": event.event_id, "created_at": event.created_at}


@app.post(
    "/events/bulk",
    status_code=201,
    summary="Record multiple events in one shot",
)
async def create_events_bulk(payload: BulkEventCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Inserts up to 500 events in a single transaction.
    """
    if not payload.events:
        raise HTTPException(400, "events list is empty")
    if len(payload.events) > 500:
        raise HTTPException(400, "Maximum 500 events per bulk request")

    events = [
        UserActivityEvent(
            session_id=e.session_id,
            event_type=e.event_type,
            page_path=e.page_path,
            event_data=e.event_data
        )
        for e in payload.events
    ]

    try:
        db.add_all(events)
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.exception("Bulk event insert failed")
        raise HTTPException(422, "Failed to insert events (possibly invalid session_id)")

    return {"inserted": len(events)}


@app.get(
    "/sessions/{session_id}/events",
    summary="List events for a session",
)
async def get_session_events(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=1_000_000),
):
    limit = int(limit)
    offset = int(offset)
    
    result = await db.execute(
        select(UserActivityEvent)
        .where(UserActivityEvent.session_id == session_id)
        .order_by(desc(UserActivityEvent.created_at))
        .limit(limit)
        .offset(offset)
    )
    events = result.scalars().all()

    return [
        {
            "event_id": e.event_id,
            "event_type": e.event_type,
            "page_path": e.page_path,
            "event_data": e.event_data,
            "created_at": e.created_at
        }
        for e in events
    ]

# ---------------------------------------------------------------------------
# HTTP Chat Endpoint  (Bedrock Converse API – model-agnostic)
# ---------------------------------------------------------------------------

def _ensure_alternating_roles(messages: list[dict]) -> list[dict]:
    """Ensure Bedrock-compatible role alternation (user/assistant/user/...).

    - Merges consecutive same-role messages into one.
    - Prepends a synthetic user message if the conversation starts with assistant.
    """
    if not messages:
        return messages

    merged: list[dict] = []
    for msg in messages:
        if merged and merged[-1]["role"] == msg["role"]:
            # Merge text content into the previous message
            merged[-1]["content"][0]["text"] += "\n" + msg["content"][0]["text"]
        else:
            merged.append({"role": msg["role"], "content": [{"text": msg["content"][0]["text"]}]})

    # Bedrock requires the first message to be 'user'
    if merged and merged[0]["role"] != "user":
        merged.insert(0, {"role": "user", "content": [{"text": "[conversation context]"}]})

    return merged


def _resolve_model_id(requested_model: Optional[str]) -> str:
    model_id = requested_model or DEFAULT_MODEL_ID
    if model_id not in ALLOWED_MODEL_IDS:
        raise HTTPException(400, "Unsupported model")
    return model_id


@app.post("/chat")
async def chat_endpoint(payload: ChatRequest, http_request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    request_id = http_request.scope.get("request_id", "unknown")

    # Restrict unauthenticated users to max 6 messages in the payload
    # Count messages by the user (not assistant)
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
        message_count=len(payload.messages)
    )

    # Build Converse-compatible message list (enforce alternation)
    converse_messages = _ensure_alternating_roles([
        {"role": msg.role, "content": [{"text": msg.content}]}
        for msg in payload.messages
    ])

    await _acquire_bedrock_slot("Chat service is busy. Try again shortly.")

    async def generate_response():
        queue: asyncio.Queue = asyncio.Queue(maxsize=CHAT_STREAM_QUEUE_SIZE)
        loop = asyncio.get_running_loop()
        stop_stream = threading.Event()

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
            # Kick off the blocking reader in a background thread
            thread_future = loop.run_in_executor(None, _stream_worker)

            # Yield chunks as they arrive, checking for client disconnects.
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
                        error_type=type(item).__name__
                    )
                    yield "\n(Error: AI service unavailable)"
                    break
                yield item

            stop_stream.set()
            if thread_future:
                try:
                    await asyncio.wait_for(thread_future, timeout=5)
                except asyncio.TimeoutError:
                    logger.warning("Bedrock stream worker did not stop promptly")
        finally:
            stop_stream.set()
            bedrock_semaphore.release()

    return StreamingResponse(
        generate_response(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disables Nginx buffering
        },
    )


@app.post("/chat/summarize")
async def chat_summarize_endpoint(payload: ChatRequest, current_user: Optional[User] = Depends(get_optional_current_user)):
    user_message_count = sum(1 for m in payload.messages if m.role == "user")
    if not current_user and user_message_count > 6:
        raise HTTPException(
            status_code=401,
            detail="You have reached the maximum number of free messages. Please log in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    model_id = _resolve_model_id(payload.model)

    converse_messages = _ensure_alternating_roles([
        {"role": msg.role, "content": [{"text": msg.content}]}
        for msg in payload.messages
    ])

    await _acquire_bedrock_slot()
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


# ---------------------------------------------------------------------------
# Model listing endpoint
# ---------------------------------------------------------------------------

@app.get(
    "/models",
    summary="List available Bedrock foundation models",
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
