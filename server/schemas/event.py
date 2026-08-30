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
]

# Ordered tuple of every accepted event type. The summary endpoint emits a row
# per entry (zero-filled) so the client tile grid never reflows as counts land.
EVENT_TYPES: tuple[str, ...] = get_args(EventTypeName)

class EventCreate(BaseModel):
    session_id: UUID
    event_type: EventTypeName
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

class EventTypeCount(BaseModel):
    event_type: str
    count: int
    last_at: Optional[datetime] = None

class SessionEventSummary(BaseModel):
    session_id: UUID
    total_events: int
    distinct_paths: int
    first_event_at: Optional[datetime] = None
    last_event_at: Optional[datetime] = None
    by_type: list[EventTypeCount]
