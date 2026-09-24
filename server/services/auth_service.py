from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, delete, or_
from sqlalchemy.orm.attributes import set_committed_value
from fastapi import HTTPException, Request, status, BackgroundTasks
from typing import Any, Optional
from server.models.user import User
from server.models.token import RefreshToken
from server.models.one_time_token import OneTimeToken
from server.models.password_history import PasswordHistory
from server.config.settings import TRUSTED_PROXY_NETWORKS
from server.utils.ip_utils import client_ip_from_request
from server.utils.user_agent import device_type_from_user_agent
import pyotp
import qrcode
import io
import base64
import time
from dataclasses import dataclass
from server.schemas.auth import (
    UserCreate, UserLogin, Token, RefreshTokenRequest, ChangePasswordRequest,
    ForgotPasswordRequest, ResetPasswordRequest, DeleteAccountRequest,
    Setup2FAResponse, Enable2FARequest, Disable2FARequest, Verify2FARequest,
    MagicLinkRequest, MagicLinkVerifyRequest, UserSessionResponse, TokenResponseOr2FA,
    ResendVerificationRequest
)
from server.auth.security import (
    get_password_hash,
    spend_verification_time,
    verify_password,
    verify_password_scheme,
    create_access_token,
    create_refresh_token,
    create_password_reset_token,
    create_pre_auth_token,
    create_email_verification_token,
    create_magic_link_token,
    decode_refresh_token_for_revocation,
    verify_token,
    REFRESH_TOKEN_EXPIRE_DAYS
)
from server.services.hibp_service import check_password_breached
from server.services.notification_service import (
    send_security_notification_email, send_password_reset_email, send_magic_link_email,
    send_email_verification_email, send_2fa_change_notification, send_existing_account_email
)
from sqlalchemy.exc import IntegrityError
import structlog
from datetime import datetime, timezone, timedelta
import uuid

logger = structlog.get_logger(__name__)

PASSWORD_HISTORY_LIMIT = 5

# Failed attempts before a tally locks, and for how long. There are two
# tallies - passwords and TOTP codes - see docs/SECURITY.md, "Account lockout".
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION = timedelta(minutes=15)

# Every refused sign-in says this, whatever the reason: an unknown address, a
# wrong password, or a locked account. "Account is temporarily locked" used to
# be the answer for the last, and only real accounts can lock, so it confirmed
# that an address had one. The second sentence tells a locked-out owner the way
# in without telling anyone else that they are locked out.
LOGIN_FAILED_DETAIL = (
    "Incorrect email or password. After 5 failed attempts, password sign-in "
    "pauses for 15 minutes; a sign-in link from your email still works."
)
# The routes behind a bearer or pre-auth token can say "locked" plainly: their
# caller has already proven the account exists.
PASSWORD_LOCKED_DETAIL = (
    "Account is temporarily locked due to multiple failed attempts. "
    "Try again later or reset your password."
)
CODE_LOCKED_DETAIL = (
    "Two-factor verification is temporarily locked after too many incorrect "
    "codes. Try again in 15 minutes."
)


def _as_utc(value: datetime) -> datetime:
    """A naive timestamp from SQLite read as UTC; a tz-aware one left alone."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _session_context(request: Optional[Request]) -> dict[str, Any]:
    """Where a refresh token was minted, for the session panel to display.

    Captured here rather than at display time because it describes the moment of
    sign-in, and the device that holds a token is not the one asking to see the
    list. `client_ip_from_request` is the same reader the analytics session and
    the rate limiter use, so a deployment that has named its proxy correctly
    records the visitor rather than the proxy in all three places.

    Every field is optional: a caller that is not a browser has no User-Agent,
    and a token is worth listing either way.
    """
    if request is None:
        return {"ip_address": None, "user_agent": None, "device_type": None}
    user_agent = request.headers.get("user-agent")
    return {
        "ip_address": client_ip_from_request(request, TRUSTED_PROXY_NETWORKS)[:64],
        "user_agent": user_agent[:512] if user_agent else None,
        "device_type": device_type_from_user_agent(user_agent),
    }


@dataclass(frozen=True)
class Tally:
    """One lockout counter: the `User` attribute that counts, and the one that locks."""

    count: str
    until: str


# Wrong passwords - at login, and on every route that re-checks one.
PASSWORD_TALLY = Tally("failed_login_attempts", "locked_until")
# Wrong or replayed TOTP codes. Kept apart from the password tally because a
# shared one made a lock from password guesses indistinguishable from one from
# code guesses: anyone could lock the owner out of the magic-link route with
# five wrong passwords, and a password reset cleared the code guesses with it.
CODE_TALLY = Tally("totp_failed_attempts", "totp_locked_until")


def login_failed() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=LOGIN_FAILED_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def reserve_attempt(
    db: AsyncSession, user: User, tally: Tally, now: datetime, event: str
) -> bool:
    """Count this attempt *before* the credential is checked, and commit.

    False means the tally is locked: refuse without checking the credential.

    The count used to be taken after a wrong answer, as a read-modify-write on
    the row loaded at the start of the request. Parallel guesses all read the
    same count, so N of them recorded about one - and all N had passed the lock
    check before any was recorded, so every one of them was *checked*. Making
    the increment atomic fixes the first half only. Reserving first fixes both:
    the database hands out attempt numbers one at a time, and the sixth request
    is refused whatever the first five are still doing.

    Committed straight away, so no row lock is held across the bcrypt check.
    """
    until = getattr(user, tally.until)
    if until and _as_utc(until) > now:
        logger.warning(event, user_id=str(user.id))
        return False

    if until:
        # A lapsed lock returns a full set of attempts (docs/SECURITY.md). Keyed
        # on the value this request saw, so when several arrive together only
        # one resets and the rest count on from it - a plain reset would hand
        # each of them attempt number one.
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .where(getattr(User, tally.until) == until)
            .values({tally.count: 0, tally.until: None})
            .execution_options(synchronize_session=False)
        )
        set_committed_value(user, tally.until, None)

    count_column = getattr(User, tally.count)
    reserved = (
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values({tally.count: count_column + 1})
            .returning(count_column)
            .execution_options(synchronize_session=False)
        )
    ).scalar_one()
    # Kept in step, so a later flush of `user` cannot write back a stale count.
    set_committed_value(user, tally.count, reserved)

    if reserved > LOCKOUT_THRESHOLD:
        # More requests in flight than attempts left. Lock if nothing has yet,
        # so the tally still lapses - otherwise a count past the threshold with
        # no `until` would refuse every attempt for good.
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .where(getattr(User, tally.until).is_(None))
            .values({tally.until: now + LOCKOUT_DURATION})
            .execution_options(synchronize_session=False)
        )
        await db.commit()
        logger.warning(event, user_id=str(user.id))
        return False

    await db.commit()
    return True


def record_failure(db: AsyncSession, user: User, tally: Tally, now: datetime, event: str) -> None:
    """The credential was wrong. `reserve_attempt` already counted it, so this
    only locks once the count reaches the threshold. The caller commits."""
    if (getattr(user, tally.count) or 0) >= LOCKOUT_THRESHOLD:
        setattr(user, tally.until, now + LOCKOUT_DURATION)
        db.add(user)
        logger.warning(event, user_id=str(user.id))


def clear_tally(db: AsyncSession, user: User, tally: Tally) -> None:
    """The credential was right. The caller commits."""
    setattr(user, tally.count, 0)
    setattr(user, tally.until, None)
    db.add(user)


async def check_current_password(
    db: AsyncSession, user: User, password: str, now: datetime, action: str
) -> None:
    """Re-authentication, held to the password tally exactly as login is.

    Change-password and delete-account checked the password with no tally at
    all, and sat on the general rate budget, so a stolen access token bought
    about a thousand guesses a minute. All four routes that re-check a
    password now come through here. The clear is committed at once, so a later
    refusal on the same request (a breached new password, say) cannot leave a
    correct password counted as a failure.

    400, not 401: a wrong password in the body is a bad request, not a bad
    bearer token, and authenticatedFetch() answers every 401 by rotating the
    refresh token and re-sending the same body. 403 would be worse - the client
    reads it as a refused credential and signs the visitor out.
    """
    if not await reserve_attempt(db, user, PASSWORD_TALLY, now, f"{action}_rejected_account_locked"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PASSWORD_LOCKED_DETAIL)
    if not verify_password(password, user.hashed_password):
        record_failure(db, user, PASSWORD_TALLY, now, f"account_locked_due_to_failed_{action}")
        await db.commit()
        logger.warning(f"{action}_invalid_password", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password"
        )
    clear_tally(db, user, PASSWORD_TALLY)
    await db.commit()


def _totp_time() -> float:
    """The clock codes are checked against. A seam for tests only: a code is
    single-use within its step, so a test that needs two walks this forward."""
    return time.time()


async def consume_totp(db: AsyncSession, user: User, code: str) -> bool:
    """True if `code` is right for the current step and that step is unused.

    A code is valid for its whole 30-second step, so one seen over a shoulder
    or relayed by a phishing proxy used to work again until the step ran out
    (RFC 6238 §5.2). The step is claimed with a conditional UPDATE, so two
    requests presenting the same code cannot both win. A replay is refused like
    any wrong code, and counts toward the code tally the same way. The caller
    commits.
    """
    if not user.totp_secret:
        return False
    totp = pyotp.TOTP(user.totp_secret)
    moment = datetime.fromtimestamp(_totp_time(), timezone.utc)
    if not totp.verify(code, for_time=moment):
        return False
    step = totp.timecode(moment)
    claimed = await db.execute(
        update(User)
        .where(User.id == user.id)
        .where(or_(User.totp_last_step.is_(None), User.totp_last_step < step))
        .values(totp_last_step=step)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        logger.warning("2fa_code_replayed", user_id=str(user.id))
        return False
    set_committed_value(user, "totp_last_step", step)
    return True


def confirm_address_if_unverified(db: AsyncSession, user: User, now: datetime, via: str) -> None:
    """Mark an address confirmed because a link mailed to it was just redeemed.

    Redeeming a magic link or a password-reset link is the same proof of
    control that clicking the verification link is, and it is delivered the
    same way. Neither recorded it, so an account that signed up but never
    clicked the confirmation link stayed flagged unverified for good: the magic
    link signed them in while `authenticate_user` kept answering 403 to their
    password, and a completed password reset left them still unable to log in.
    Both are dead ends the visitor has no way to diagnose.
    """
    if user.email_verified_at is not None:
        return
    user.email_verified_at = now
    db.add(user)
    logger.info("email_verified_via_link", user_id=str(user.id), via=via)


PURPOSE_PASSWORD_RESET = "password_reset"
PURPOSE_MAGIC_LINK = "magic_link"
PURPOSE_2FA_PRE_AUTH = "2fa_pre_auth"
PURPOSE_EMAIL_VERIFY = "email_verify"

# How long a verification link lives. Matches create_email_verification_token;
# the JWT expiry and the one_time_tokens row must not disagree, or one of the
# two checks becomes decorative.
EMAIL_VERIFY_TTL = timedelta(hours=24)


def issue_one_time_token(db: AsyncSession, user_id: uuid.UUID, purpose: str, ttl: timedelta) -> str:
    """Records a single-use token and returns its jti. The caller commits."""
    jti = str(uuid.uuid4())
    db.add(OneTimeToken(
        user_id=user_id,
        jti=jti,
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + ttl,
    ))
    return jti


async def consume_one_time_token(db: AsyncSession, jti: Optional[str], purpose: str) -> bool:
    """Marks a token spent. False if it is missing, issued for another purpose,
    already used, or expired. The purpose check is what stops a token minted for
    one flow being redeemed in another. The caller commits."""
    if not jti:
        return False
    now = datetime.now(timezone.utc)
    # Claim and check in one statement. Reading the row and testing `used_at`
    # in Python let two concurrent redemptions of one magic link both pass and
    # both mint a session - the race refresh_user_token already closes the
    # same way. The purpose is part of the claim, so a token for another flow
    # is refused without being spent.
    claimed = await db.execute(
        update(OneTimeToken)
        .where(OneTimeToken.jti == jti)
        .where(OneTimeToken.purpose == purpose)
        .where(OneTimeToken.used_at.is_(None))
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        return False
    # Expiry after the claim, as in refresh_user_token: stored timestamps
    # compare differently under SQLite and PostgreSQL, and burning an expired
    # token is harmless.
    expires_at = (
        await db.execute(select(OneTimeToken.expires_at).where(OneTimeToken.jti == jti))
    ).scalar_one_or_none()
    return expires_at is not None and _as_utc(expires_at) >= now

# What registration answers for every address, new or not. "Email already
# registered" was a direct oracle for which addresses have accounts - one the
# enumeration table in docs/SECURITY.md never listed. The difference now goes
# to the address's inbox, where only its owner reads it.
REGISTER_ACCEPTED = {"message": "Check your inbox to finish setting up your account."}


async def register_user(
    db: AsyncSession,
    user_data: UserCreate,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict:
    email_normalized = user_data.email.strip().lower()
    # Check if user already exists
    result = await db.execute(select(User).where(User.email == email_normalized))
    existing_user = result.scalars().first()
    if existing_user:
        now = datetime.now(timezone.utc)
        deleted_at = existing_user.deleted_at
        if deleted_at and now - _as_utc(deleted_at) > timedelta(days=30):
            await db.delete(existing_user)
            await db.commit()
        else:
            # Same answer and the same bcrypt cost as a new registration, so
            # neither the body nor the response time tells the two apart. The
            # mail is sent in the background on both paths, off the clock.
            get_password_hash(user_data.password)
            logger.info("registration_existing_address", user_id=str(existing_user.id))
            if background_tasks:
                background_tasks.add_task(send_existing_account_email, existing_user.email)
            return REGISTER_ACCEPTED

    # Hash the password
    hashed_password = get_password_hash(user_data.password)

    # Create new user
    db_user = User(
        email=email_normalized,
        username=user_data.username,
        hashed_password=hashed_password
    )

    db.add(db_user)
    try:
        await db.commit()
        await db.refresh(db_user)
        logger.info("user_registered", user_id=str(db_user.id), email=db_user.email)
        await _issue_email_verification(db, db_user, background_tasks)
        return REGISTER_ACCEPTED
    except IntegrityError:
        # Raced another registration of the same address, which sends the mail.
        await db.rollback()
        return REGISTER_ACCEPTED

async def authenticate_user(
    db: AsyncSession, user_data: UserLogin, request: Optional[Request] = None
) -> TokenResponseOr2FA:
    email_normalized = user_data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalars().first()

    # Every refusal below looks the same from outside: one status, one body,
    # and two bcrypt verifications - which is what a wrong password costs, the
    # prehash check then the legacy one. The unknown-address path burned one
    # and the purged and locked paths burned none, so response time told an
    # attacker which addresses have accounts even where the body did not.
    if not user:
        spend_verification_time(rounds=2)
        logger.warning("login_failed", email=email_normalized)
        raise login_failed()

    now = datetime.now(timezone.utc)

    if user.deleted_at and now - _as_utc(user.deleted_at) > timedelta(days=30):
        spend_verification_time(rounds=2)
        logger.warning("login_failed_account_purged", user_id=str(user.id))
        raise login_failed()

    if not await reserve_attempt(db, user, PASSWORD_TALLY, now, "login_failed_account_locked"):
        spend_verification_time(rounds=2)
        raise login_failed()

    password_matched, needs_rehash = verify_password_scheme(
        user_data.password, user.hashed_password
    )
    if not password_matched:
        record_failure(db, user, PASSWORD_TALLY, now, "account_locked_due_to_failed_logins")
        await db.commit()
        raise login_failed()

    # The password is proven, so its tally clears - committed now, because the
    # inactive and unconfirmed refusals below would otherwise leave this
    # attempt counted, and five correct passwords would lock an unconfirmed
    # account. This used to wait for a completed sign-in, because one tally
    # also held the TOTP guesses and clearing it here let an attacker who knew
    # the password reset the code count by logging in again. The code tally is
    # separate now, and a correct password does not touch it.
    clear_tally(db, user, PASSWORD_TALLY)
    await db.commit()

    # Automatic reactivation if account was soft deleted within 30 days
    if user.deleted_at:
        logger.info("account_auto_reactivated", user_id=str(user.id), email=email_normalized)
        user.deleted_at = None
        user.is_active = True

    if not user.is_active:
        logger.warning("login_failed_inactive", email=email_normalized)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    # Deliberately after the password check. Answering "unverified" to a wrong
    # password would turn this into an account-enumeration oracle; here it tells
    # a caller nothing a successful login would not have told them anyway.
    #
    # Accounts created before this shipped are backfilled as verified by
    # migration j3e4f5a6b7c8, so this gate only ever applies to registrations
    # that were offered a link.
    if user.email_verified_at is None:
        logger.warning("login_failed_unverified_email", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Confirm your email address to finish setting up your account.",
        )

    # A login is the only moment the plaintext is available, so it is the only
    # chance to migrate a pre-SHA256-prehash row. Without this the legacy branch
    # in verify_password_scheme stays load-bearing forever.
    if needs_rehash:
        user.hashed_password = get_password_hash(user_data.password)
        logger.info("password_hash_upgraded", user_id=str(user.id))

    if user.is_totp_enabled:
        # The code tally is deliberately NOT cleared here. A correct password
        # is only half of this login; clearing the code count at this point
        # would let an attacker who knows the password log in again between
        # guesses. verify_2fa_login clears it once a code checks out.
        pre_auth_jti = issue_one_time_token(db, user.id, PURPOSE_2FA_PRE_AUTH, timedelta(minutes=5))
        db.add(user)
        await db.commit()
        pre_auth_token = create_pre_auth_token(str(user.id), jti=pre_auth_jti)
        logger.info("login_requires_2fa", user_id=str(user.id))
        return TokenResponseOr2FA(
            requires_2fa=True,
            pre_auth_token=pre_auth_token
        )

    # Fully authenticated from here: no second factor stands between the caller
    # and a token pair. The password tally was cleared above.
    user.last_login = now
    db.add(user)
    await db.commit()

    # Generate Refresh Token JTI and record it in database
    jti = str(uuid.uuid4())
    expires_at = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    db_token = RefreshToken(
        user_id=user.id,
        token_jti=jti,
        expires_at=expires_at,
        last_used_at=now,
        **_session_context(request),
    )
    db.add(db_token)
    await db.commit()

    logger.info("user_logged_in", user_id=str(user.id), email=user.email)

    return TokenResponseOr2FA(
        requires_2fa=False,
        access_token=create_access_token(subject=str(user.id), session_jti=jti),
        refresh_token=create_refresh_token(subject=str(user.id), jti=jti),
        token_type="bearer"
    )

async def refresh_user_token(
    db: AsyncSession, token_data: RefreshTokenRequest, request: Optional[Request] = None
) -> Token:
    payload = verify_token(token_data.refresh_token, expected_type="refresh")
    user_id_str = payload.get("sub")
    jti = payload.get("jti")

    if not user_id_str or not jti:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token subject") from None

    now = datetime.now(timezone.utc)

    # Claim the token and revoke it in one statement. Reading the row, checking
    # `is_revoked` in Python and writing it back left a window between the read
    # and the commit: under READ COMMITTED - PostgreSQL's default - two requests
    # presenting the *same* refresh token could both see it unrevoked and both
    # rotate, so one credential became two live ones and the reuse detection
    # below never fired. A conditional UPDATE makes the check and the claim the
    # same operation, so exactly one caller can win.
    claimed = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_jti == jti)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
        .values(is_revoked=True, last_used_at=now)
    )
    if claimed.rowcount != 1:
        # Unknown, already rotated, or presented by someone other than its subject.
        logger.warning("refresh_token_invalid_or_revoked", jti=jti, user_id=user_id_str)
        raise HTTPException(status_code=401, detail="Refresh token has been revoked or expired")

    # Expiry is checked after the claim rather than in the WHERE clause: the
    # comparison is against a stored timestamp whose timezone handling differs
    # between SQLite and PostgreSQL, and burning an expired token is harmless.
    token_result = await db.execute(select(RefreshToken).where(RefreshToken.token_jti == jti))
    db_token = token_result.scalars().first()
    if db_token is None or _as_utc(db_token.expires_at) < now:
        await db.commit()
        logger.warning("refresh_token_expired", jti=jti, user_id=user_id_str)
        raise HTTPException(status_code=401, detail="Refresh token has been revoked or expired")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Generate new JTI and save new refresh token record
    new_jti = str(uuid.uuid4())
    expires_at = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    # The rotated token inherits the device it was rotated from when the request
    # carries no context of its own, so a session does not lose its identity in
    # the panel every thirty minutes.
    context = _session_context(request)
    if not context["user_agent"]:
        context = {
            "ip_address": db_token.ip_address,
            "user_agent": db_token.user_agent,
            "device_type": db_token.device_type,
        }

    new_db_token = RefreshToken(
        user_id=user.id,
        token_jti=new_jti,
        expires_at=expires_at,
        last_used_at=now,
        **context,
    )
    db.add(new_db_token)
    await db.commit()

    logger.info("token_refreshed", user_id=str(user.id), old_jti=jti, new_jti=new_jti)

    return Token(
        access_token=create_access_token(subject=str(user.id), session_jti=new_jti),
        refresh_token=create_refresh_token(subject=str(user.id), jti=new_jti),
        token_type="bearer"
    )

async def revoke_user_tokens(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Ends every session this user holds: refresh tokens and pending links.

    There used to be a third statement here deactivating the user's
    `user_sessions` rows, guarded by `hasattr(UserSession, "user_id")` - a
    condition that is always true, over a column nothing ever writes. It matched
    zero rows on every call. `user_sessions` is the anonymous analytics table
    written by `POST /sessions`; it has never described a login, and the session
    panel now reads `refresh_tokens`, which does.
    """
    # Mark all active refresh tokens for this user as revoked
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.is_revoked == False)
        .values(is_revoked=True)
    )
    # Pending reset and magic links are credentials too, so a password change,
    # a reset or an account deletion must void them. They used to live in
    # refresh_tokens and got swept up by accident; now it is deliberate and
    # scoped. An ordinary logout ends one device's session and leaves them be.
    await db.execute(
        update(OneTimeToken)
        .where(OneTimeToken.user_id == user_id)
        .where(OneTimeToken.used_at.is_(None))
        .values(used_at=datetime.now(timezone.utc))
    )
    await db.commit()
    logger.info("all_refresh_tokens_revoked", user_id=str(user_id))


async def logout_user(
    db: AsyncSession,
    refresh_token: Optional[str],
    user: Optional[User],
    session_jti: Optional[str],
) -> dict:
    """Ends the caller's own session: this device, not every device.

    This used to revoke every refresh token the user held, on the grounds that
    the access token carried no refresh `jti`. It has carried one as `sid`
    since that claim shipped. It also authenticated with `get_current_user`, so
    once the 30-minute access token had expired - the usual state after a long
    read - the call was refused, nothing was revoked, and the 30-day refresh
    token stayed live while the UI said "Signed out."

    The session is resolved from the first of these that names one:

    1. The refresh token in the body. It is the credential being ended, and
       possession of it is the same proof `POST /auth/refresh` accepts, so an
       expired access token no longer matters.
    2. The `sid` claim of a valid bearer - a client still on the pre-body
       auth.js.
    3. A valid bearer minted before `sid` existed cannot name its session, so
       it ends all of them, which is what this route always did.

    The answer does not say whether a row matched, so it is not an oracle for
    which tokens are live. "Sign out everywhere" is
    `/auth/sessions/revoke-others` followed by this.
    """
    target: Optional[tuple[uuid.UUID, str]] = None
    payload = decode_refresh_token_for_revocation(refresh_token) if refresh_token else None
    if payload:
        try:
            target = (uuid.UUID(payload["sub"]), payload["jti"])
        except ValueError:
            target = None
    if target is None and user is not None and session_jti:
        target = (user.id, session_jti)

    if target is not None:
        user_id, jti = target
        # user_id as well as jti: a token can only ever end its own subject's
        # session, whatever jti it carries.
        result = await db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_jti == jti)
            .where(RefreshToken.user_id == user_id)
            .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
            .values(is_revoked=True)
        )
        await db.commit()
        logger.info(
            "user_logged_out", user_id=str(user_id), jti=jti, revoked=result.rowcount or 0
        )
        return {"message": "Logged out successfully."}

    if user is not None:
        await revoke_user_tokens(db, user.id)
        logger.info("user_logged_out_all_sessions", user_id=str(user.id))
        return {"message": "Logged out successfully."}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def change_user_password(
    db: AsyncSession,
    user: User,
    data: ChangePasswordRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    # Step 1: Verify Current Password (400 on a miss - see check_current_password)
    await check_current_password(
        db, user, data.current_password, datetime.now(timezone.utc), "password_change"
    )

    # Step 2: Check Password Breach Status (Have I Been Pwned API)
    is_breached = await check_password_breached(data.new_password)
    if is_breached:
        logger.warning("password_change_failed_breached", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password has appeared in a data breach and is unsafe to use."
        )

    # Step 3: Check Password Reuse / History
    # Fetch top N recent password hashes from password_history for user
    history_result = await db.execute(
        select(PasswordHistory.password_hash)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_LIMIT)
    )
    recent_history_hashes = history_result.scalars().all()

    # Compare new_password against active password and recent history
    all_candidate_hashes = [user.hashed_password] + list(recent_history_hashes)
    for past_hash in all_candidate_hashes:
        if verify_password(data.new_password, past_hash):
            logger.warning("password_change_failed_reused", user_id=str(user.id))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot reuse a recent password."
            )

    # Step 4: Record in Password History (Store OLD password hash)
    old_hash = user.hashed_password
    history_entry = PasswordHistory(
        user_id=user.id,
        password_hash=old_hash
    )
    db.add(history_entry)

    # Step 5: Update Active Password
    user.hashed_password = get_password_hash(data.new_password)
    db.add(user)

    # Clean up or prune history entries older than the last N records
    prune_subquery = (
        select(PasswordHistory.id)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .offset(PASSWORD_HISTORY_LIMIT)
    )
    prune_result = await db.execute(prune_subquery)
    old_history_ids = prune_result.scalars().all()
    if old_history_ids:
        await db.execute(
            delete(PasswordHistory).where(PasswordHistory.id.in_(old_history_ids))
        )

    # Step 6: Invalidate Active Sessions & Refresh Tokens
    await revoke_user_tokens(db, user.id)

    await db.commit()

    # Step 7: Send Notification (Asynchronous Background Task)
    if background_tasks:
        background_tasks.add_task(send_security_notification_email, user.email, str(user.id))

    logger.info("password_changed_successfully", user_id=str(user.id))

    return {"message": "Password changed successfully"}


async def _issue_email_verification(
    db: AsyncSession,
    user: User,
    background_tasks: Optional[BackgroundTasks],
) -> None:
    """Mints a verification token and schedules the mail. Shared by registration
    and the resend route so the two cannot drift in TTL or purpose."""
    verify_jti = issue_one_time_token(db, user.id, PURPOSE_EMAIL_VERIFY, EMAIL_VERIFY_TTL)
    await db.commit()
    token = create_email_verification_token(subject=str(user.id), jti=verify_jti)
    if background_tasks:
        background_tasks.add_task(send_email_verification_email, user.email, token)


async def verify_email_with_token(db: AsyncSession, token: str) -> dict:
    try:
        payload = verify_token(token, expected_type="email_verify")
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        ) from None

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == uuid.UUID(str(user_id))))
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    if user.email_verified_at is not None:
        # Already done. Mail clients prefetch links and people click twice, so
        # a second visit is a success, not an error - and the one-time token was
        # already burned by the first, which would otherwise fail below.
        return {"message": "Your email address is already confirmed. You can log in."}

    if not await consume_one_time_token(db, payload.get("jti"), PURPOSE_EMAIL_VERIFY):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    user.email_verified_at = datetime.now(timezone.utc)
    db.add(user)
    await db.commit()
    logger.info("email_verified", user_id=str(user.id))
    return {"message": "Email address confirmed. You can log in now."}


async def resend_verification_email(
    db: AsyncSession,
    data: ResendVerificationRequest,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict:
    email_normalized = data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalars().first()

    # One response for every outcome, exactly as request_password_reset does.
    # Distinguishing "no such account" from "already verified" from "sent" would
    # let anyone enumerate addresses, and this endpoint takes no credential.
    generic_response = {
        "message": "If that address needs confirming, a new link is on its way."
    }

    if not user or not user.is_active or user.email_verified_at is not None:
        logger.info("verification_resend_no_op", email=email_normalized)
        return generic_response

    await _issue_email_verification(db, user, background_tasks)
    logger.info("verification_resent", user_id=str(user.id))
    return generic_response


async def request_password_reset(
    db: AsyncSession,
    data: ForgotPasswordRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    email_normalized = data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalars().first()

    # Every outcome below returns this. Distinguishing "not registered" or
    # "inactive" from success let anyone enumerate which addresses hold accounts
    # by watching the status code.
    generic_response = {
        "message": "If that email address has an account, a password reset link is on its way."
    }

    if not user:
        logger.info("password_reset_requested_unknown_email", email=email_normalized)
        return generic_response

    if not user.is_active:
        logger.info("password_reset_requested_inactive_user", user_id=str(user.id), email=email_normalized)
        return generic_response

    reset_jti = issue_one_time_token(db, user.id, PURPOSE_PASSWORD_RESET, timedelta(minutes=15))
    await db.commit()

    reset_token = create_password_reset_token(subject=str(user.id), jti=reset_jti)
    logger.info("password_reset_requested", user_id=str(user.id), email=email_normalized)
    if background_tasks:
        background_tasks.add_task(send_password_reset_email, user.email, reset_token)

    return generic_response


async def reset_password_with_token(
    db: AsyncSession,
    data: ResetPasswordRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    # Step 1: Verify token
    try:
        payload = verify_token(data.token, expected_type="password_reset")
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired password reset link"
        ) from None

    user_id_str = payload.get("sub")
    reset_jti = payload.get("jti")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token subject") from None

    if not await consume_one_time_token(db, reset_jti, PURPOSE_PASSWORD_RESET):
        logger.warning("reset_password_token_already_used_or_revoked", jti=reset_jti, user_id=user_id_str)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link has already been used or expired."
        )

    # Step 2: Fetch user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found or inactive")

    # Step 3: Check Password Breach Status
    is_breached = await check_password_breached(data.new_password)
    if is_breached:
        logger.warning("password_reset_failed_breached", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password has appeared in a data breach and is unsafe to use."
        )

    # Step 4: Check Password Reuse / History
    history_result = await db.execute(
        select(PasswordHistory.password_hash)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_LIMIT)
    )
    recent_history_hashes = history_result.scalars().all()

    all_candidate_hashes = [user.hashed_password] + list(recent_history_hashes)
    for past_hash in all_candidate_hashes:
        if verify_password(data.new_password, past_hash):
            logger.warning("password_reset_failed_reused", user_id=str(user.id))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot reuse a recent password."
            )

    # Step 5: Record in Password History (Store OLD password hash)
    old_hash = user.hashed_password
    history_entry = PasswordHistory(
        user_id=user.id,
        password_hash=old_hash
    )
    db.add(history_entry)

    # Step 6: Update Active Password and clear the *password* tally. The code
    # tally stays: this used to clear a single shared count, so anyone holding
    # the inbox could reset, sign in, try five codes, and reset again - which
    # left the second factor bounded by the rate limiter rather than the lock.
    user.hashed_password = get_password_hash(data.new_password)
    clear_tally(db, user, PASSWORD_TALLY)

    # The reset link was mailed to this address and has just been redeemed, so
    # the address is confirmed. Without this, an account that never clicked the
    # verification link could complete a reset and still be refused at login -
    # which reads as the new password not having taken.
    confirm_address_if_unverified(
        db, user, datetime.now(timezone.utc), via="password_reset"
    )

    # Clean up old history
    prune_subquery = (
        select(PasswordHistory.id)
        .where(PasswordHistory.user_id == user.id)
        .order_by(PasswordHistory.created_at.desc())
        .offset(PASSWORD_HISTORY_LIMIT)
    )
    prune_result = await db.execute(prune_subquery)
    old_history_ids = prune_result.scalars().all()
    if old_history_ids:
        await db.execute(
            delete(PasswordHistory).where(PasswordHistory.id.in_(old_history_ids))
        )

    # Step 7: Invalidate Active Sessions & Refresh Tokens
    await revoke_user_tokens(db, user.id)

    await db.commit()

    # Step 8: Send Notification
    if background_tasks:
        background_tasks.add_task(send_security_notification_email, user.email, str(user.id))

    logger.info("password_reset_completed", user_id=str(user.id))

    return {"message": "Password reset successfully. You can now log in with your new password."}


async def delete_user_account(
    db: AsyncSession,
    user: User,
    data: DeleteAccountRequest
) -> dict:
    if data.confirmation_phrase.strip().upper() != "DELETE":
        logger.warning("account_deletion_failed_invalid_phrase", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation phrase must be 'DELETE'."
        )

    now = datetime.now(timezone.utc)
    await check_current_password(db, user, data.current_password, now, "account_deletion")

    user.deleted_at = now
    user.is_active = False
    db.add(user)

    # Invalidate active sessions & refresh tokens
    await revoke_user_tokens(db, user.id)

    await db.commit()
    logger.info("user_account_soft_deleted", user_id=str(user.id))

    return {
        "message": "Account successfully scheduled for deletion. Logging back in within 30 days will automatically reactivate your account."
    }


async def setup_2fa(db: AsyncSession, user: User) -> Setup2FAResponse:
    # Enrolling again while 2FA is live would overwrite the secret the user's
    # authenticator already holds, without ever clearing `is_totp_enabled`:
    # every subsequent code would be rejected and the account would be locked
    # behind a second factor nobody can produce. Anyone holding a stolen access
    # token could also use it to swap the second factor for one of their own.
    if user.is_totp_enabled:
        logger.warning("2fa_setup_rejected_already_enabled", user_id=str(user.id))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is already enabled. Disable it before enrolling a new authenticator.",
        )

    secret = pyotp.random_base32()
    user.totp_secret = secret
    db.add(user)
    await db.commit()

    totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="rjWebApp")

    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(totp_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    qr_code_data_uri = f"data:image/png;base64,{qr_b64}"

    logger.info("2fa_setup_initiated", user_id=str(user.id))
    return Setup2FAResponse(secret=secret, qr_code=qr_code_data_uri)


# Both of the routes below turn a second factor on or off, so both are
# credential changes and both follow the same order:
#
#   lockout -> password -> state -> code -> mutate -> revoke -> notify
#
# A wrong password or a wrong code is a *guess* and counts toward the shared
# lockout tally. A state error ("2FA is not enabled") is not a guess and does
# not count - otherwise probing an endpoint that refuses everyone equally would
# lock accounts. Neither route counted anything before, so the six digits on
# them could be walked at will by anyone holding an access token.


async def enable_2fa(
    db: AsyncSession,
    user: User,
    data: Enable2FARequest,
    current_jti: Optional[str] = None,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict:
    now = datetime.now(timezone.utc)
    await check_current_password(db, user, data.current_password, now, "2fa_enable")

    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA setup not initiated")

    if not await reserve_attempt(db, user, CODE_TALLY, now, "2fa_enable_rejected_code_locked"):
        raise HTTPException(status_code=400, detail=CODE_LOCKED_DETAIL)
    if not await consume_totp(db, user, data.code):
        record_failure(db, user, CODE_TALLY, now, "account_locked_due_to_failed_2fa_enable")
        await db.commit()
        logger.warning("2fa_enable_invalid_code", user_id=str(user.id))
        raise HTTPException(status_code=400, detail="Invalid 2FA code")

    user.is_totp_enabled = True
    clear_tally(db, user, CODE_TALLY)
    await db.commit()

    # Anything else holding a live token predates the second factor and has not
    # been asked for it. `revoke_all_other_sessions` rather than
    # `revoke_user_tokens` so the caller keeps the session they are enrolling
    # from - signing them out of the tab they just used would be its own bug.
    await revoke_all_other_sessions(db, user, current_jti)

    if background_tasks:
        background_tasks.add_task(
            send_2fa_change_notification, user.email, str(user.id), True
        )

    logger.info("2fa_enabled_successfully", user_id=str(user.id))
    return {"message": "2FA successfully enabled"}


async def disable_2fa(
    db: AsyncSession,
    user: User,
    data: Disable2FARequest,
    current_jti: Optional[str] = None,
    background_tasks: Optional[BackgroundTasks] = None,
) -> dict:
    now = datetime.now(timezone.utc)
    await check_current_password(db, user, data.current_password, now, "2fa_disable")

    if not user.totp_secret or not user.is_totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    if not await reserve_attempt(db, user, CODE_TALLY, now, "2fa_disable_rejected_code_locked"):
        raise HTTPException(status_code=400, detail=CODE_LOCKED_DETAIL)
    if not await consume_totp(db, user, data.code):
        record_failure(db, user, CODE_TALLY, now, "account_locked_due_to_failed_2fa_disable")
        await db.commit()
        logger.warning("2fa_disable_invalid_code", user_id=str(user.id))
        raise HTTPException(status_code=400, detail="Invalid 2FA code")

    user.is_totp_enabled = False
    user.totp_secret = None
    user.totp_last_step = None
    clear_tally(db, user, CODE_TALLY)
    await db.commit()

    await revoke_all_other_sessions(db, user, current_jti)

    if background_tasks:
        background_tasks.add_task(
            send_2fa_change_notification, user.email, str(user.id), False
        )

    logger.info("2fa_disabled_successfully", user_id=str(user.id))
    return {"message": "2FA successfully disabled"}


async def verify_2fa_login(
    db: AsyncSession, data: Verify2FARequest, request: Optional[Request] = None
) -> TokenResponseOr2FA:
    payload = verify_token(data.pre_auth_token, expected_type="2fa_pre_auth")
    user_id_str = payload.get("sub")
    pre_auth_jti = payload.get("jti")
    if not user_id_str:
        raise HTTPException(status_code=400, detail="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID") from None

    now = datetime.now(timezone.utc)

    # The pre-auth token is single-use. Without this it stayed valid for its
    # full five minutes, so capturing one bought unlimited attempts at a
    # six-digit code.
    # A token with no `jti` is refused rather than waved through. This used to
    # read `if pre_auth_jti and not pre_auth_valid`, so a pre-auth token that
    # carried no jti skipped the burn check entirely and stayed replayable for
    # its full five minutes - the exact window the check exists to close.
    # `create_pre_auth_token` now requires a jti, and this is the other half.
    pre_auth_valid = await consume_one_time_token(db, pre_auth_jti, PURPOSE_2FA_PRE_AUTH)
    if not pre_auth_valid:
        logger.warning("2fa_pre_auth_token_reused_or_expired", user_id=user_id_str)
        raise HTTPException(
            status_code=400,
            detail="This sign-in attempt has expired. Please log in again.",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user or not user.is_active or not user.is_totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=400, detail="User not found or 2FA not enabled")

    # The second factor was outside the lockout entirely: failed codes were not
    # counted, so a six-digit secret could be walked through at will. Only the
    # code tally applies here. A pre-auth token already proves the password or
    # the inbox, and checking the password tally too let anyone who could guess
    # at the login form lock the owner out of the magic-link route as well.
    if not await reserve_attempt(db, user, CODE_TALLY, now, "2fa_verify_rejected_code_locked"):
        raise HTTPException(status_code=400, detail=CODE_LOCKED_DETAIL)
    if not await consume_totp(db, user, data.code):
        record_failure(db, user, CODE_TALLY, now, "account_locked_due_to_failed_2fa")
        await db.commit()
        logger.warning("2fa_verify_failed", user_id=str(user.id))
        raise HTTPException(status_code=400, detail="Invalid 2FA code")

    # A completed sign-in clears both tallies.
    clear_tally(db, user, CODE_TALLY)
    clear_tally(db, user, PASSWORD_TALLY)
    user.last_login = now
    db.add(user)

    jti = str(uuid.uuid4())
    expires_at = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    db_token = RefreshToken(
        user_id=user.id,
        token_jti=jti,
        expires_at=expires_at,
        last_used_at=now,
        **_session_context(request),
    )
    db.add(db_token)
    await db.commit()

    logger.info("2fa_login_completed", user_id=str(user.id))
    return TokenResponseOr2FA(
        requires_2fa=False,
        access_token=create_access_token(subject=str(user.id), session_jti=jti),
        refresh_token=create_refresh_token(subject=str(user.id), jti=jti),
        token_type="bearer"
    )


async def request_magic_link(
    db: AsyncSession,
    data: MagicLinkRequest,
    background_tasks: Optional[BackgroundTasks] = None
) -> dict:
    email_normalized = data.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email_normalized))
    user = result.scalars().first()

    # Same enumeration-resistant contract as the password reset above.
    generic_response = {
        "message": "If that email address has an account, a sign-in link is on its way."
    }

    if not user:
        logger.info("magic_link_requested_unknown_email", email=email_normalized)
        return generic_response

    if not user.is_active:
        logger.info("magic_link_requested_inactive_user", user_id=str(user.id))
        return generic_response

    magic_jti = issue_one_time_token(db, user.id, PURPOSE_MAGIC_LINK, timedelta(minutes=10))
    await db.commit()

    magic_token = create_magic_link_token(subject=str(user.id), jti=magic_jti)
    if background_tasks:
        background_tasks.add_task(send_magic_link_email, user.email, magic_token)

    logger.info("magic_link_requested_successfully", user_id=str(user.id), email=email_normalized)
    return generic_response


async def verify_magic_link(
    db: AsyncSession, data: MagicLinkVerifyRequest, request: Optional[Request] = None
) -> TokenResponseOr2FA:
    payload = verify_token(data.token, expected_type="magic_link")
    user_id_str = payload.get("sub")
    magic_jti = payload.get("jti")

    if not user_id_str or not magic_jti:
        raise HTTPException(status_code=400, detail="Invalid token payload")

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token subject") from None

    now = datetime.now(timezone.utc)
    if not await consume_one_time_token(db, magic_jti, PURPOSE_MAGIC_LINK):
        raise HTTPException(status_code=400, detail="This magic link has already been used or expired.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="User not found or inactive")

    # Before the 2FA branch: the link came out of this address's inbox, which is
    # what confirmation means. Whether a second factor is still owed does not
    # change what has already been proven.
    confirm_address_if_unverified(db, user, now, via="magic_link")

    if user.is_totp_enabled:
        pre_auth_jti = issue_one_time_token(db, user.id, PURPOSE_2FA_PRE_AUTH, timedelta(minutes=5))
        pre_token = create_pre_auth_token(str(user.id), jti=pre_auth_jti)
        await db.commit()
        return TokenResponseOr2FA(requires_2fa=True, pre_auth_token=pre_token)

    new_jti = str(uuid.uuid4())
    expires_at = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    new_db_token = RefreshToken(
        user_id=user.id,
        token_jti=new_jti,
        expires_at=expires_at,
        last_used_at=now,
        **_session_context(request),
    )
    db.add(new_db_token)
    await db.commit()

    logger.info("magic_link_login_completed", user_id=str(user.id))
    return TokenResponseOr2FA(
        requires_2fa=False,
        access_token=create_access_token(subject=str(user.id), session_jti=new_jti),
        refresh_token=create_refresh_token(subject=str(user.id), jti=new_jti),
        token_type="bearer"
    )


# ── The session panel ────────────────────────────────────────────────────────
# These three read and write `refresh_tokens`, not `user_sessions`. The latter
# is written only by `POST /sessions`, which is anonymous by design and never
# sets `user_id`, so every row had a null owner: the list was permanently empty,
# and revoking from it flipped a flag on an analytics record that was never a
# login in the first place. "Log out all other devices" therefore reported
# success while leaving every stolen credential live for its full thirty days.
#
# One `refresh_tokens` row *is* one live session, so revoking one genuinely ends
# it - the device is out as soon as its access token expires, at most
# ACCESS_TOKEN_EXPIRE_MINUTES later.


def _live_sessions_for(user: User, now: datetime):
    """Unrevoked, unexpired refresh tokens: the user's live sessions."""
    return (
        select(RefreshToken)
        .where(RefreshToken.user_id == user.id)
        .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
        .where(RefreshToken.expires_at > now)
    )


async def get_user_sessions(
    db: AsyncSession, user: User, current_jti: Optional[str] = None
) -> list[UserSessionResponse]:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        _live_sessions_for(user, now).order_by(RefreshToken.created_at.desc())
    )
    sessions = result.scalars().all()
    return [
        UserSessionResponse(
            # The row id, not the jti: the jti is the credential, and this value
            # goes to the browser and comes back in a DELETE path.
            session_id=s.id,
            ip_address=s.ip_address or "unknown",
            user_agent=s.user_agent,
            device_type=s.device_type,
            started_at=_as_utc(s.created_at),
            last_active_at=_as_utc(s.last_used_at or s.created_at),
            is_current=bool(current_jti) and s.token_jti == current_jti,
        ) for s in sessions
    ]


async def revoke_all_other_sessions(
    db: AsyncSession, user: User, current_jti: Optional[str] = None
) -> dict:
    """Ends every session but the caller's own.

    Which one is the caller's comes from the `sid` claim their access token
    carries, not from the request body - the client never had a way to know its
    own session id, so the old optional body parameter was never sent and every
    call signed the caller out along with everybody else. An access token minted
    before `sid` shipped resolves to None here, in which case this does what it
    says on the tin and ends everything, the caller included.
    """
    query = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id)
        .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
    )
    if current_jti:
        query = query.where(RefreshToken.token_jti != current_jti)
    result = await db.execute(query.values(is_revoked=True))
    await db.commit()
    logger.info(
        "user_revoked_other_sessions", user_id=str(user.id), revoked=result.rowcount or 0
    )
    return {"message": "Logged out of all other active sessions successfully."}


async def revoke_specific_session(db: AsyncSession, user: User, session_id: uuid.UUID) -> dict:
    """Ends one session. 404 when it is not the caller's, or already gone.

    The result used to be discarded and the success message returned whatever
    happened - including for an id belonging to somebody else's account, which
    told the caller a device had been signed out when nothing had.
    """
    result = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id)
        .where(RefreshToken.id == session_id)
        .where(RefreshToken.is_revoked == False)  # noqa: E712 - SQL, not Python truthiness
        .values(is_revoked=True)
    )
    await db.commit()
    if not result.rowcount:
        logger.info("user_revoked_unknown_session", user_id=str(user.id), session_id=str(session_id))
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    logger.info("user_revoked_specific_session", user_id=str(user.id), session_id=str(session_id))
    return {"message": "Session revoked successfully."}
