from sqlalchemy import Column, String, DateTime, UUID, ForeignKey, func, BigInteger
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import JSON
from server.db.database import Base

_JsonType = JSON().with_variant(JSONB, "postgresql")

class UserActivityEvent(Base):
    __tablename__ = "user_activity_events"

    event_id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("user_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    page_path = Column(String(256), nullable=True)
    event_data = Column(_JsonType, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
