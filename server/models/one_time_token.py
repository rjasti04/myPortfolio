import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, UUID, func

from server.db.database import Base


class OneTimeToken(Base):
    """Single-use tokens: password reset, magic link, 2FA pre-auth.

    These were stored as rows in `refresh_tokens`, which conflated three
    unrelated things. Nothing recorded what a row was for, so the type could
    only be inferred from the JWT presenting it; `revoke_user_tokens` swept
    pending password resets away as if they were sessions; and a table meaning
    "this user has a live session" also meant "this user asked for a link".
    """

    __tablename__ = "one_time_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    jti = Column(String(64), unique=True, index=True, nullable=False)
    # password_reset | magic_link | 2fa_pre_auth. Checked on redemption, so a
    # token issued for one purpose cannot be spent on another.
    purpose = Column(String(32), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Set on redemption rather than a boolean, so the audit trail keeps when.
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_one_time_tokens_user_purpose", "user_id", "purpose"),
    )
