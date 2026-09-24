from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from server.db.database import get_db
from server.schemas.auth import (
    UserCreate, UserLogin, Token, UserResponse, RegisterResponse, RefreshTokenRequest, LogoutRequest, ChangePasswordRequest,
    ForgotPasswordRequest, ResetPasswordRequest, DeleteAccountRequest,
    Setup2FAResponse, Enable2FARequest, Disable2FARequest, Verify2FARequest,
    MagicLinkRequest, MagicLinkVerifyRequest, UserSessionResponse, TokenResponseOr2FA,
    VerifyEmailRequest, ResendVerificationRequest
)
from server.services import auth_service
from server.auth.dependencies import (
    get_current_session_jti,
    get_current_user,
    get_optional_current_user,
)
from server.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

# 202, not 201: the answer is the same whether or not an account was created,
# so it cannot promise one. What happened goes to the address's inbox.
@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_202_ACCEPTED)
async def register(
    user: UserCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.register_user(db, user, background_tasks)


@router.post("/verify-email")
async def verify_email(data: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    """Confirms the address a registration was made with.

    Takes no credential: the token in the link is the credential, single-use
    through one_time_tokens and purpose-checked so a reset or magic-link token
    cannot be spent here.
    """
    return await auth_service.verify_email_with_token(db, data.token)


@router.post("/resend-verification")
async def resend_verification(
    data: ResendVerificationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.resend_verification_email(db, data, background_tasks)

@router.post("/login", response_model=TokenResponseOr2FA)
async def login(user: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    return await auth_service.authenticate_user(db, user, request)

@router.post("/refresh", response_model=Token)
async def refresh_token(
    token_data: RefreshTokenRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    return await auth_service.refresh_user_token(db, token_data, request)

@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/2fa/setup", response_model=Setup2FAResponse)
async def setup_2fa(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.setup_2fa(db, current_user)

@router.post("/2fa/enable")
async def enable_2fa(
    data: Enable2FARequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    current_jti: Optional[str] = Depends(get_current_session_jti),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.enable_2fa(db, current_user, data, current_jti, background_tasks)

@router.post("/2fa/disable")
async def disable_2fa(
    data: Disable2FARequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    current_jti: Optional[str] = Depends(get_current_session_jti),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.disable_2fa(db, current_user, data, current_jti, background_tasks)

@router.post("/2fa/verify", response_model=TokenResponseOr2FA)
async def verify_2fa(data: Verify2FARequest, request: Request, db: AsyncSession = Depends(get_db)):
    return await auth_service.verify_2fa_login(db, data, request)

@router.post("/magic-link/request")
async def request_magic_link(
    data: MagicLinkRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.request_magic_link(db, data, background_tasks)

@router.post("/magic-link/verify", response_model=TokenResponseOr2FA)
async def verify_magic_link(
    data: MagicLinkVerifyRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    return await auth_service.verify_magic_link(db, data, request)

@router.post("/logout")
async def logout(
    data: Optional[LogoutRequest] = None,
    current_user: Optional[User] = Depends(get_optional_current_user),
    session_jti: Optional[str] = Depends(get_current_session_jti),
    db: AsyncSession = Depends(get_db)
):
    """End the caller's own session.

    Authenticated by the refresh token in the body, not by `get_current_user`:
    that is the credential being ended, and requiring a live access token meant
    a visitor whose token had expired could not sign out at all. The bearer is
    still honoured when no body is sent. See `auth_service.logout_user`.
    """
    return await auth_service.logout_user(
        db, data.refresh_token if data else None, current_user, session_jti
    )

@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.change_user_password(db, current_user, data, background_tasks)

@router.post("/forgot-password")
async def forgot_password(
    data: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.request_password_reset(db, data, background_tasks)

@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.reset_password_with_token(db, data, background_tasks)

@router.delete("/account")
@router.post("/delete-account")
async def delete_account(
    data: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.delete_user_account(db, current_user, data)

@router.get("/sessions", response_model=list[UserSessionResponse])
async def get_active_sessions(
    current_user: User = Depends(get_current_user),
    current_jti: Optional[str] = Depends(get_current_session_jti),
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.get_user_sessions(db, current_user, current_jti)

@router.post("/sessions/revoke-others")
async def revoke_other_sessions(
    current_user: User = Depends(get_current_user),
    current_jti: Optional[str] = Depends(get_current_session_jti),
    db: AsyncSession = Depends(get_db),
):
    """End every session except the caller's own.

    Which one that is comes from the `sid` claim in the caller's access token.
    It used to be an optional body parameter, which the frontend had no way to
    fill in and never sent - so the endpoint signed the caller out along with
    everybody else. A token predating that claim still ends every session,
    which remains the safe reading when the server cannot tell them apart.
    """
    return await auth_service.revoke_all_other_sessions(db, current_user, current_jti)

# Declared before /sessions/{session_id} so the literal path segment is not
# captured as a UUID by the parameterised route.
@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.revoke_specific_session(db, current_user, session_id)
