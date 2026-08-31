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
    try:
        # First verify using the SHA-256 pre-hashed password
        if pwd_context.verify(_get_sha256_hex(plain_password), hashed_password):
            return True
    except Exception:
        pass
    try:
        # Fallback to plain text verification for legacy passwords
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False

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
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

def create_pre_auth_token(subject: Union[str, int]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode = {"exp": expire, "sub": str(subject), "type": "2fa_pre_auth"}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def create_magic_link_token(subject: Union[str, int], jti: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=10)
    to_encode = {"exp": expire, "sub": str(subject), "type": "magic_link", "jti": jti}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
