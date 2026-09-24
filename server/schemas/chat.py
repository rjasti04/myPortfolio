from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import List, Literal, Optional

# Ceilings for one inference request. Every one of these is a cost control, not
# an ergonomics choice: `/chat` is unauthenticated by design, so whatever the
# schema accepts is what an anonymous caller can bill to the Bedrock account.
#
# MAX_TOTAL_CONTENT_CHARS is the load-bearing one. chat.js summarises its own
# history once it estimates ~6000 tokens (SUMMARIZE_TOKEN_THRESHOLD), so a
# legitimate client never sends more than roughly that; 24000 characters is the
# same bound expressed server side, where it cannot be edited away.
MAX_MESSAGES = 60
MAX_MESSAGE_CHARS = 8_000
MAX_TOTAL_CONTENT_CHARS = 24_000


class ChatMessage(BaseModel):
    # Was a bare `str`, so any value round-tripped into the Bedrock payload.
    # ensure_alternating_roles only ever produces these two.
    role: Literal["user", "assistant"] = Field(
        ..., description="Role of the message sender"
    )
    content: str = Field(
        ..., max_length=MAX_MESSAGE_CHARS, description="Text content of the message"
    )

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        """Strips, and refuses what is left empty.

        `max_length` bounded the top but nothing bounded the bottom, so "   "
        validated as "". `ensure_alternating_roles` then dropped it and Bedrock
        was called with no messages at all - a ValidationException the service
        turned into an error frame inside a 200 response. The same guard
        `ContactRequest` already applies to its own free-text fields.
        """
        if not isinstance(v, str):
            v = str(v) if v is not None else ""
        stripped = v.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

class ChatStreamRequest(BaseModel):
    # Unknown fields are dropped, not rejected. Pydantic's default, stated so
    # that a later `extra="forbid"` is a decision rather than an accident: the
    # SPA never sends anything else, and refusing a stray field buys nothing.
    model_config = ConfigDict(extra="ignore")

    messages: List[ChatMessage] = Field(
        ..., min_length=1, max_length=MAX_MESSAGES, description="Conversation history list"
    )
    conversation_id: Optional[str] = Field(
        None, max_length=36, description="Optional UUID string of the conversation session"
    )
    stream: Optional[bool] = Field(default=True, description="Enable streaming mode")

    # `system_prompt` used to be accepted here and passed straight through to
    # Bedrock. It was unauthenticated and had no length limit, so a caller could
    # both replace the portfolio persona - turning the site's AWS account into a
    # free general-purpose LLM - and bill up to MAX_BODY_BYTES of input tokens
    # per request. CHAT_FREE_MESSAGE_LIMIT counts user-role *messages*, so one
    # short message carrying a megabyte of system prompt passed every check.
    # The server owns the persona now; bedrock_service.DEFAULT_SYSTEM_PROMPT is
    # the only one a caller can reach.
    #
    # `model_id` went for the same reason (ADR-023). Anonymous callers could
    # name any allowlisted model, and the allowlist always carried a
    # Sonnet-class id whatever the environment said, so one request could be
    # upgraded to several times the default's price. A supplied `model_id` is
    # now ignored, and every turn runs on DEFAULT_MODEL_ID.

    @model_validator(mode="after")
    def limit_total_content(self) -> "ChatStreamRequest":
        total = sum(len(message.content) for message in self.messages)
        if total > MAX_TOTAL_CONTENT_CHARS:
            raise ValueError(
                f"Conversation exceeds {MAX_TOTAL_CONTENT_CHARS} characters "
                f"({total}). Summarize the history and retry."
            )
        return self
