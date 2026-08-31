from sqlalchemy import Column, String, DateTime, UUID, ForeignKey, func, BigInteger, Integer, Index, JSON, text
from sqlalchemy.dialects.postgresql import JSONB
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
    # JSONB on PostgreSQL: binary storage, indexable with GIN, and supports the
    # containment operators payload filtering needs. SQLite has no JSONB, so
    # the variant keeps the test harness on plain JSON.
    event_data = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        # Mirrors the list endpoint's ORDER BY exactly, so pagination is an
        # index scan rather than a sort over the session's whole event set.
        Index(
            "ix_events_session_created",
            "session_id",
            text("created_at DESC"),
            text("event_id DESC"),
        ),
        # Containment lookups over the payload (e.g. event_data @> '{"theme":"dark"}').
        Index(
            "ix_events_data_gin",
            "event_data",
            postgresql_using="gin",
        ),
    )

