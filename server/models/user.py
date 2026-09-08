from sqlalchemy import Column, String, Boolean, DateTime, Integer, UUID, func
from server.db.database import Base
import uuid

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(50), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False, server_default="0")
    locked_until = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    # NULL until the address is confirmed. A timestamp rather than a boolean
    # for the same reason one_time_tokens.used_at is one: it keeps *when*.
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    totp_secret = Column(String(255), nullable=True)
    is_totp_enabled = Column(Boolean, default=False, nullable=False, server_default="false")
