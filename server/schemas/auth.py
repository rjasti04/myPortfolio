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
    # Re-authentication, not decoration. Without it an access token was on its
    # own enough to bind an authenticator to an account that had no second
    # factor - which locks the real owner out rather than merely reading their
    # data. `change-password` and `delete-account` already re-auth; this is the
    # third credential change and it belongs on the same footing.
    current_password: str
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

class Disable2FARequest(BaseModel):
    current_password: str
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

class Verify2FARequest(BaseModel):
    pre_auth_token: str = Field(..., max_length=2048)
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

class MagicLinkRequest(BaseModel):
    email: EmailStr

class MagicLinkVerifyRequest(BaseModel):
    token: str

class VerifyEmailRequest(BaseModel):
    token: str

class ResendVerificationRequest(BaseModel):
    email: EmailStr

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
    # Exposed so the account UI can say why a login was refused, and offer to
    # send another link. NULL until the address is confirmed.
    email_verified_at: Optional[datetime.datetime] = None
