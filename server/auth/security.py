import hashlib
from datetime import datetime, timedelta, timezone
from typing import Union, Optional
import bcrypt
import jwt
from fastapi import HTTPException, status

from server.config.settings import JWT_SECRET

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30

# passlib's default, so hashes made before bcrypt was called directly and
# hashes made after cost the same to check.
BCRYPT_ROUNDS = 12
# bcrypt reads at most 72 bytes. Before 4.0 it dropped the rest silently; from
# 5.0 it raises instead.
BCRYPT_MAX_BYTES = 72


def _get_sha256_hex(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _checkpw(secret: bytes, hashed_password: str) -> bool:
    """bcrypt.checkpw that answers False, rather than raising, for a malformed
    stored hash - a bad row must fail the check, not the request."""
    try:
        return bcrypt.checkpw(secret, hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False

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
    # The digest is 64 ASCII characters, inside bcrypt's 72-byte limit.
    if _checkpw(_get_sha256_hex(plain_password).encode("ascii"), hashed_password):
        return True, False
    # Legacy rows were hashed by bcrypt < 4, which truncated at 72 bytes without
    # a word, so a longer password was stored as its first 72. bcrypt 5 raises
    # on the same input; truncating here keeps those rows verifiable.
    if _checkpw(plain_password.encode("utf-8")[:BCRYPT_MAX_BYTES], hashed_password):
        return True, True
    return False, False


_dummy_hash: Optional[str] = None


def spend_verification_time(rounds: int = 1) -> None:
    """Burns `rounds` bcrypt verifications.

    A login for an address with no account used to return before doing any
    hashing, so response time alone told an attacker which addresses exist.
    A *wrong* password for a real account costs two - the prehash check fails,
    then the legacy raw-password check runs - so every refusal that skips the
    real check (unknown, purged, locked) calls this with `rounds=2`. One round
    still left the unknown address measurably faster than a real one.
    """
    global _dummy_hash
    if _dummy_hash is None:
        # Built on first use rather than at import, so the cost lands on a
        # request rather than on every process start and test collection.
        _dummy_hash = get_password_hash("timing-equalisation-placeholder")
    for _ in range(rounds):
        _checkpw(_get_sha256_hex("not-the-placeholder").encode("ascii"), _dummy_hash)

def get_password_hash(password: str) -> str:
    digest = _get_sha256_hex(password).encode("ascii")
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")

def create_access_token(
    subject: Union[str, int],
    expires_delta: Optional[timedelta] = None,
    session_jti: Optional[str] = None,
) -> str:
    """Bearer credential. `session_jti` names the refresh token that minted it.

    Without that link the server could not tell which of a user's sessions was
    making a request, so `GET /auth/sessions` had to report `is_current: false`
    for every row and "log out all other devices" had no "this one" to exclude -
    it signed the caller out along with everybody else. The claim is an
    identifier for a row the caller already holds the credential for, so it
    grants nothing on its own.

    Optional because tokens minted before this shipped do not carry it; they are
    treated as belonging to no known session until they expire, which is at most
    ACCESS_TOKEN_EXPIRE_MINUTES away.
    """
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject), "type": "access"}
    if session_jti:
        to_encode["sid"] = session_jti
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

def decode_refresh_token_for_revocation(token: str) -> Optional[dict]:
    """A refresh token's payload for the purpose of revoking it, or None.

    The signature and `type` are checked; expiry is deliberately not. An
    expired refresh token is already dead, so revoking it costs nothing, and
    refusing it would turn a sign-out into an error for exactly the visitor
    who left a tab open longest. Nothing else may use this: `verify_token` is
    what authenticates a request.
    """
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[ALGORITHM], options={"verify_exp": False}
        )
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "refresh" or not payload.get("sub") or not payload.get("jti"):
        return None
    return payload

def create_pre_auth_token(subject: Union[str, int], jti: str) -> str:
    """Half-authenticated token issued between password and second factor.

    Carries a `jti` so the server can burn it on use; without one the token was
    replayable for its full five-minute life, letting an attacker who captured
    it keep retrying codes.

    `jti` is required, and the burn check in `verify_2fa_login` refuses a token
    without one. It used to default to None while that check read
    `if pre_auth_jti and not pre_auth_valid`, so a token carrying no jti skipped
    the single-use guard entirely - reopening the unlimited-retry window this
    argument exists to close. Both halves are needed: an optional argument and a
    guard that treats its absence as consent is one caller away from a hole.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode = {"exp": expire, "sub": str(subject), "type": "2fa_pre_auth", "jti": jti}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def create_email_verification_token(subject: Union[str, int], jti: str) -> str:
    """Confirms a registrant controls the address they signed up with.

    24 hours rather than the 10-15 minutes the reset and magic-link tokens get:
    this one grants no access at all - it only marks an address confirmed - and
    a verification mail that expires before someone next opens their inbox is
    the reason verification flows get abandoned.
    """
    expire = datetime.now(timezone.utc) + timedelta(hours=24)
    to_encode = {"exp": expire, "sub": str(subject), "type": "email_verify", "jti": jti}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def create_magic_link_token(subject: Union[str, int], jti: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=10)
    to_encode = {"exp": expire, "sub": str(subject), "type": "magic_link", "jti": jti}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
