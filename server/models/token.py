from sqlalchemy import Column, String, Boolean, DateTime, UUID, ForeignKey, func
from server.db.database import Base
import uuid

class RefreshToken(Base):
    """One row per live login. Also what `GET /auth/sessions` reports.

    The session panel used to read `user_sessions`, which is written only by the
    anonymous `POST /sessions` and so never carried a `user_id` - the list was
    always empty and revoking from it ended nothing. This table already tracked
    one row per login with working rotation and revocation; the four context
    columns below are what it was missing to be displayable, and revoking a row
    here genuinely signs that device out.
    """

    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_jti = Column(String(255), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    # Captured when the token is minted, so the panel can tell one device from
    # another. Nullable: tokens issued before this shipped have no request to
    # read, and a token with no recorded device is still worth listing.
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    device_type = Column(String(50), nullable=True)
    # Bumped on rotation, so recency reflects use rather than first sign-in.
    last_used_at = Column(DateTime(timezone=True), nullable=True)
