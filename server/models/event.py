from sqlalchemy import Column, String, DateTime, UUID, ForeignKey, func, BigInteger, Integer, JSON
from server.db.database import Base

class UserActivityEvent(Base):
    __tablename__ = "user_activity_events"

    # SQLite only autoincrements INTEGER PRIMARY KEY, so BIGINT columns come
    # back NOT NULL on insert. The variant keeps BIGINT on PostgreSQL and
    # only swaps the type under SQLite, which the test harness uses.
    event_id = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    session_id = Column(UUID(as_uuid=True), ForeignKey("user_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    page_path = Column(String(256), nullable=True)
    event_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
