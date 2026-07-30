import uuid
from sqlalchemy import Column, String, Integer, LargeBinary, DateTime, UUID, ForeignKey, Index, func
from server.db.database import Base

class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="New Conversation")
    model_id = Column(String(100), nullable=False)
    compressed_payload = Column(LargeBinary, nullable=False)
    message_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_ai_conversations_user_updated", "user_id", updated_at.desc()),
    )
