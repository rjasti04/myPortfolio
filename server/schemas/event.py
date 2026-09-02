import json
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any, Literal, get_args
from uuid import UUID
from datetime import datetime

EventTypeName = Literal[
    "page_view",
    "click",
    "scroll_depth",
    "terminal_command",
    "theme_change",
    "copy_email",
    "contact_submission",
    # Emitted by form.js when a visitor loads a contact prompt chip. It was
    # never declared here, so every batch carrying one was rejected whole -
    # taking the contact_submission event flushed alongside it.
    "contact_prompt",
    # Written server side by chat_routes after a stream completes. It goes in
    # through the model rather than this schema, so it was already in the table
    # while the summary endpoint reported it as an unknown type.
    "ai_llm_telemetry",
    # Uncaught exceptions and unhandled rejections, forwarded by
    # error-handler.js. Production JS failures previously reached nobody: they
    # went to console.error and nothing collected them. Routed through the
    # existing bulk pipeline rather than a dedicated endpoint, so it needs no
    # new surface, no new auth and no new table.
    "client_error",
]

# Ordered tuple of every accepted event type. The summary endpoint emits a row
# per entry (zero-filled) so the client tile grid never reflows as counts land.
EVENT_TYPES: tuple[str, ...] = get_args(EventTypeName)

EVENT_DATA_MAX_BYTES = 4096


def _check_event_data_size(v):
    """Shared by EventCreate and BulkEventItem so the cap cannot drift apart."""
    if v is not None and len(json.dumps(v)) > EVENT_DATA_MAX_BYTES:
        raise ValueError(f"event_data exceeds {EVENT_DATA_MAX_BYTES // 1024} KB limit")
    return v


class EventCreate(BaseModel):
    session_id: UUID
    event_type: EventTypeName
    page_path: Optional[str] = Field(default=None, max_length=256)
    event_data: Optional[dict[str, Any]] = None

    @field_validator("event_data")
    @classmethod
    def event_data_size_limit(cls, v):
        return _check_event_data_size(v)

FlushReason = Literal["threshold", "timer", "unload", "hidden", "manual"]


class BulkEventItem(BaseModel):
    """One event inside a bulk batch, with `event_type` left as a plain string.

    `EventCreate` types it as a `Literal`, which makes FastAPI reject the entire
    request for one unrecognised row. That is the wrong failure mode for a
    batch: a client emitting a type the server has not declared yet destroyed
    every valid event flushed alongside it, and analytics.js only re-queues on
    5xx/429, so the batch was gone for good.

    The vocabulary is still enforced - `create_events_bulk` checks each row
    against EVENT_TYPES and reports the rejects - but one unknown type now costs
    one event instead of up to five hundred. Everything structural
    (`session_id`, sizes) stays strict here, because those are client bugs
    rather than schema drift.
    """

    session_id: UUID
    event_type: str = Field(..., min_length=1, max_length=100)
    page_path: Optional[str] = Field(default=None, max_length=256)
    event_data: Optional[dict[str, Any]] = None

    @field_validator("event_data")
    @classmethod
    def event_data_size_limit(cls, v):
        return _check_event_data_size(v)


class BulkEventCreate(BaseModel):
    events: list[BulkEventItem] = Field(..., min_length=1, max_length=500)
    # Client clock at flush time. Purely diagnostic - never trusted for
    # ordering, since the browser clock can be arbitrarily wrong.
    client_ts: Optional[int] = None
    # Which client trigger produced this batch. Distinguishes healthy timed
    # flushes from the unreliable unload path, which is worth measuring.
    flush_reason: Optional[FlushReason] = None

class EventTypeCount(BaseModel):
    event_type: str
    count: int
    last_at: Optional[datetime] = None

class RejectedEvent(BaseModel):
    """One row `create_events_bulk` declined, so the client can see what it lost."""

    index: int
    event_type: str
    reason: str


class BulkEventResult(BaseModel):
    inserted: int
    # Additive: callers that only read `inserted` are unaffected.
    rejected: list[RejectedEvent] = []


class SessionEventSummary(BaseModel):
    session_id: UUID
    total_events: int
    distinct_paths: int
    first_event_at: Optional[datetime] = None
    last_event_at: Optional[datetime] = None
    by_type: list[EventTypeCount]
