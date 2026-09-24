from sqlalchemy import Column, String, Boolean, DateTime, UUID, ForeignKey, func
from server.db.database import Base
import uuid

class UserSession(Base):
    __tablename__ = "user_sessions"

    session_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    ip_address = Column(String(64), nullable=False)
    user_agent = Column(String(512), nullable=True)
    device_type = Column(String(50), nullable=True)
    # Indexed for the owner dashboard's date window (/admin/analytics/overview).
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    last_active_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    end_reason = Column(String(50), nullable=True)
