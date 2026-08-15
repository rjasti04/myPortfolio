from pydantic import BaseModel, Field
from typing import Optional, Literal

class SessionCreate(BaseModel):
    user_agent: Optional[str] = Field(default=None, max_length=2048)
    device_type: Optional[Literal["desktop", "mobile", "tablet", "unknown"]] = None

class SessionEnd(BaseModel):
    end_reason: Optional[
        Literal["logout", "timeout", "closed", "tab_closed_or_hidden", "unknown"]
    ] = None

class SessionUpdate(BaseModel):
    """Lightweight heartbeat - bumps last_active_at."""
    pass
