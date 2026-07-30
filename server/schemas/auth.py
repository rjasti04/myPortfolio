from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional
import datetime
from uuid import UUID

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Password must be at least 8 characters long")
    username: Optional[str] = Field(None, min_length=3, max_length=50)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class TokenPayload(BaseModel):
    sub: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, description="Password must be at least 8 characters long")

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8, description="Password must be at least 8 characters long")

class DeleteAccountRequest(BaseModel):
    current_password: str
    confirmation_phrase: str

class Setup2FAResponse(BaseModel):
    secret: str
    qr_code: str

class Enable2FARequest(BaseModel):
    code: str

class Disable2FARequest(BaseModel):
    current_password: str
    code: str

class Verify2FARequest(BaseModel):
    pre_auth_token: str
    code: str

class MagicLinkRequest(BaseModel):
    email: EmailStr

class MagicLinkVerifyRequest(BaseModel):
    token: str

class UserSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    session_id: UUID
    ip_address: str
    user_agent: Optional[str] = None
    device_type: Optional[str] = None
    started_at: datetime.datetime
    last_active_at: datetime.datetime
    is_current: bool = False

class TokenResponseOr2FA(BaseModel):
    requires_2fa: bool = False
    pre_auth_token: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_type: str = "bearer"

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    username: Optional[str] = None
    created_at: datetime.datetime
    is_active: bool
    is_totp_enabled: bool = False
