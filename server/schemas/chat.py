from pydantic import BaseModel, Field, field_validator
from typing import Optional, List

class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of the message sender, e.g. 'user' or 'assistant'")
    content: str = Field(..., description="Text content of the message")

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not isinstance(v, str):
            v = str(v) if v is not None else ""
        return v.strip()

class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1)
    model: Optional[str] = Field(default=None, max_length=256)
    conversation_id: Optional[str] = Field(default=None, max_length=36)

class ChatStreamRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1, description="Conversation history list")
    conversation_id: Optional[str] = Field(None, description="Optional UUID string of the conversation session")
    model_id: Optional[str] = Field(None, description="Target Bedrock model ID")
    system_prompt: Optional[str] = Field(None, description="Custom system prompt override")
    stream: Optional[bool] = Field(default=True, description="Enable streaming mode")

class ChatTelemetryEvent(BaseModel):
    model_id: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    cache_hit: bool
    latency_ms: float
