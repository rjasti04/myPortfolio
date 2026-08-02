import json
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any, Literal
from uuid import UUID

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
