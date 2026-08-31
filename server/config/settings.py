import os
import structlog
from server.utils.ip_utils import parse_proxy_networks

logger = structlog.get_logger(__name__)

def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise RuntimeError(f"{name} must be an integer")
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


# The value that used to be `security.py`'s fallback. It is public in the repo
# history, so any token signed with it must be treated as forgeable.
_LEGACY_JWT_SECRET = "supersecret_default_key_change_in_production"
JWT_SECRET_MIN_LENGTH = 32


def _required_secret(name: str) -> str:
    """A required env var that must not be the published placeholder.

    There is deliberately no default: an unset signing key previously fell back
    to a constant checked into a public repository, which let anyone mint a
    valid token for any user id. Failing at import is the only safe behaviour.
    """
    value = _required_env(name)
    if value == _LEGACY_JWT_SECRET:
        raise RuntimeError(
            f"{name} is set to the placeholder value that shipped in the repository. "
            "Generate a fresh one with `openssl rand -hex 32`."
        )
    if len(value) < JWT_SECRET_MIN_LENGTH:
        raise RuntimeError(
            f"{name} must be at least {JWT_SECRET_MIN_LENGTH} characters. "
            "Generate one with `openssl rand -hex 32`."
        )
    return value


DATABASE_URL = _required_env("DATABASE_URL")
AWS_REGION = _required_env("AWS_REGION")
DEFAULT_MODEL_ID = _required_env("DEFAULT_MODEL_ID")
JWT_SECRET = _required_secret("JWT_SECRET")

_raw_origins = os.getenv("CORS_ORIGINS", "")
origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not origins:
    origins = [
        "http://localhost:1111",
        "http://127.0.0.1:1111",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ]

# Ensure production domains are always allowed to prevent browser CORS block issues
for domain in ["https://rjasti.com", "https://www.rjasti.com"]:
    if domain not in origins:
        origins.append(domain)

MAX_BODY_BYTES = _env_int("MAX_BODY_BYTES", 1_048_576)  # 1 MB
CHAT_MAX_CONCURRENCY = _env_int("CHAT_MAX_CONCURRENCY", 4)
CHAT_STREAM_QUEUE_SIZE = _env_int("CHAT_STREAM_QUEUE_SIZE", 128)
BEDROCK_TIMEOUT_SECONDS = _env_int("BEDROCK_TIMEOUT_SECONDS", 30)
BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS = _env_int("BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS", 10)

# User messages an unauthenticated caller may send before being asked to log
# in. chat.js enforces the same number client-side and already handles the 401,
# but nothing enforced it server-side, so calling the API directly bought
# unlimited Bedrock inference.
CHAT_FREE_MESSAGE_LIMIT = _env_int("CHAT_FREE_MESSAGE_LIMIT", 6)

_raw_allowed_models = os.getenv("ALLOWED_MODEL_IDS", "")
ALLOWED_MODEL_IDS = {
    model.strip()
    for model in _raw_allowed_models.split(",")
    if model.strip()
}
ALLOWED_MODEL_IDS.add(DEFAULT_MODEL_ID)
ALLOWED_MODEL_IDS.add("google.gemma-3-4b-it")
ALLOWED_MODEL_IDS.add("anthropic.claude-3-5-sonnet-20241022-v2:0")

TRUSTED_PROXY_NETWORKS = parse_proxy_networks(os.getenv("TRUSTED_PROXY_IPS", ""))

