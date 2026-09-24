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
    session_id = Column(UUID(as_uuid=True), ForeignKey("user_sessions.session_id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(100), nullable=False)
    page_path = Column(String(256), nullable=True)
    # JSONB on PostgreSQL: binary storage, parsed once on write rather than on
    # every read, and open to GIN and containment operators should a payload
    # filter ever need them. SQLite has no JSONB, so the variant keeps the test
    # harness on plain JSON.
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
        # The owner dashboard's date window. Every analytics query filters on
        # `created_at >= since`, and some add an `event_type`; with the window
        # leading, one index serves both shapes, and /overview's per-type and
        # per-day counts are index-only. The reverse order would serve only the
        # queries that name a type: PostgreSQL 16 cannot skip a leading column.
        # `created_at` only grows, so inserts append at the right-hand edge.
        #
        # The composite above also leads with `session_id`, so it serves the
        # foreign-key cascade too; a separate index on that column only cost
        # every insert. So did a GIN index on `event_data` that no query used:
        # nothing filters with `@>` or `?`, and `->>` extraction is not what
        # GIN's `jsonb_ops` indexes.
        Index("ix_events_created_type", "created_at", "event_type"),
    )

