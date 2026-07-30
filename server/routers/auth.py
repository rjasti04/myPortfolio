from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Request, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from server.db.database import get_db
from server.schemas.auth import (
    UserCreate, UserLogin, Token, UserResponse, RefreshTokenRequest, ChangePasswordRequest,
    ForgotPasswordRequest, ResetPasswordRequest, DeleteAccountRequest,
    Setup2FAResponse, Enable2FARequest, Disable2FARequest, Verify2FARequest,
    MagicLinkRequest, MagicLinkVerifyRequest, UserSessionResponse, TokenResponseOr2FA
)
from server.services import auth_service
from server.auth.dependencies import get_current_user
from server.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user: UserCreate, db: AsyncSession = Depends(get_db)):
    return await auth_service.register_user(db, user)

@router.post("/login", response_model=TokenResponseOr2FA)
async def login(user: UserLogin, db: AsyncSession = Depends(get_db)):
    return await auth_service.authenticate_user(db, user)

@router.post("/refresh", response_model=Token)
async def refresh_token(token_data: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    return await auth_service.refresh_user_token(db, token_data)

@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/2fa/setup", response_model=Setup2FAResponse)
async def setup_2fa(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.setup_2fa(db, current_user)

@router.post("/2fa/enable")
async def enable_2fa(data: Enable2FARequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.enable_2fa(db, current_user, data)

@router.post("/2fa/disable")
async def disable_2fa(data: Disable2FARequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.disable_2fa(db, current_user, data)

@router.post("/2fa/verify", response_model=TokenResponseOr2FA)
async def verify_2fa(data: Verify2FARequest, db: AsyncSession = Depends(get_db)):
    return await auth_service.verify_2fa_login(db, data)

@router.post("/magic-link/request")
async def request_magic_link(
    data: MagicLinkRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.request_magic_link(db, data, background_tasks)

@router.post("/magic-link/verify", response_model=TokenResponseOr2FA)
async def verify_magic_link(data: MagicLinkVerifyRequest, db: AsyncSession = Depends(get_db)):
    return await auth_service.verify_magic_link(db, data)

@router.get("/sessions", response_model=list[UserSessionResponse])
async def get_sessions(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.get_user_sessions(db, current_user)

@router.post("/sessions/revoke-others")
async def revoke_others(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.revoke_all_other_sessions(db, current_user)

@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await auth_service.revoke_specific_session(db, current_user, session_id)

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

@router.post("/delete-account")
async def delete_account(
    data: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await auth_service.delete_user_account(db, current_user, data)

@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await auth_service.revoke_user_tokens(db, current_user.id)
    return {"message": "Successfully logged out"}

