import hashlib
from datetime import datetime, timedelta, timezone
from typing import Union, Optional
from passlib.context import CryptContext
import jwt
from fastapi import HTTPException, status

from server.config.settings import JWT_SECRET

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _get_sha256_hex(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """True if the password matches, under either the current or legacy scheme."""
    matched, _ = verify_password_scheme(plain_password, hashed_password)
    return matched


def verify_password_scheme(plain_password: str, hashed_password: str) -> tuple[bool, bool]:
    """Returns (matched, needs_rehash).

    Passwords are bcrypt over a SHA-256 hex digest, which sidesteps bcrypt's
    72-byte truncation. Rows predating that are bcrypt over the raw password.
    The second element flags a legacy match so the caller can upgrade the stored
    hash: without it the fallback is permanent and no row ever migrates.
    """
    try:
        if pwd_context.verify(_get_sha256_hex(plain_password), hashed_password):
            return True, False
    except Exception:
        pass
    try:
        if pwd_context.verify(plain_password, hashed_password):
            return True, True
    except Exception:
        return False, False
    return False, False


_dummy_hash: Optional[str] = None


def spend_verification_time() -> None:
    """Burns roughly one bcrypt verification.

    A login for an address with no account used to return before doing any
    hashing, so response time alone told an attacker which addresses exist.
    Called on that path so both outcomes cost the same.
    """
    global _dummy_hash
    if _dummy_hash is None:
        # Built on first use rather than at import, so the cost lands on a
        # request rather than on every process start and test collection.
        _dummy_hash = get_password_hash("timing-equalisation-placeholder")
    try:
        pwd_context.verify(_get_sha256_hex("not-the-placeholder"), _dummy_hash)
    except Exception:
        pass

def get_password_hash(password: str) -> str:
    return pwd_context.hash(_get_sha256_hex(password))

def create_access_token(subject: Union[str, int], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject), "type": "access"}
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(subject: Union[str, int], jti: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {"exp": expire, "sub": str(subject), "type": "refresh", "jti": jti}
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
    return encoded_jwt

def create_password_reset_token(
    subject: Union[str, int],
    jti: Optional[str] = None,
    expires_delta: Optional[timedelta] = None
) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode = {"exp": expire, "sub": str(subject), "type": "password_reset"}
    if jti:
        to_encode["jti"] = jti
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def verify_token(token: str, expected_type: str = "access") -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        if payload.get("type") != expected_type:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

def create_pre_auth_token(subject: Union[str, int], jti: Optional[str] = None) -> str:
    """Half-authenticated token issued between password and second factor.

    Carries a `jti` so the server can burn it on use; without one the token was
    replayable for its full five-minute life, letting an attacker who captured
    it keep retrying codes.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode = {"exp": expire, "sub": str(subject), "type": "2fa_pre_auth"}
    if jti:
        to_encode["jti"] = jti
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def create_magic_link_token(subject: Union[str, int], jti: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=10)
    to_encode = {"exp": expire, "sub": str(subject), "type": "magic_link", "jti": jti}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
