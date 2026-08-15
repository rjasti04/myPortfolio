from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of the message sender, e.g. 'user' or 'assistant'")
    content: str = Field(..., description="Text content of the message")

class ChatStreamRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1, description="Conversation history list")
    conversation_id: Optional[str] = Field(None, description="Optional UUID string of the conversation session")
    model_id: Optional[str] = Field(None, description="Target Bedrock model ID")
    system_prompt: Optional[str] = Field(None, description="Custom system prompt override")

class ChatTelemetryEvent(BaseModel):
    model_id: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    cache_hit: bool
    latency_ms: float
