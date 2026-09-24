import os
import structlog
from server.config.env import env_int as _env_int, required_env as _required_env
from server.utils.ip_utils import parse_proxy_networks

logger = structlog.get_logger(__name__)

# The value that used to be `security.py`'s fallback. It is public in the repo
# history, so any token signed with it must be treated as forgeable.
_LEGACY_JWT_SECRET = "supersecret_default_key_change_in_production"
JWT_SECRET_MIN_LENGTH = 32
# `openssl rand -hex 32` draws from 16 symbols over 64 characters, so a real key
# has about that many distinct characters. Ten is far below that and far above
# a repeated one ("aaaa...") or a keyboard run.
JWT_SECRET_MIN_DISTINCT = 10
# Placeholder shapes. `.env.example` shipped `replace-me-with-openssl-rand-hex-32`,
# which is 35 characters and passed the length check, so a `.env` copied as-is
# started cleanly with a signing key anyone reading the repository could use.
# Narrower than "contains change": a passphrase may say that legitimately.
_PLACEHOLDER_MARKERS = ("replace-me", "change-me", "changeme")


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
    if any(marker in value.lower() for marker in _PLACEHOLDER_MARKERS):
        raise RuntimeError(
            f"{name} is still a placeholder. Generate one with `openssl rand -hex 32`."
        )
    if len(value) < JWT_SECRET_MIN_LENGTH:
        raise RuntimeError(
            f"{name} must be at least {JWT_SECRET_MIN_LENGTH} characters. "
            "Generate one with `openssl rand -hex 32`."
        )
    if len(set(value)) < JWT_SECRET_MIN_DISTINCT:
        raise RuntimeError(
            f"{name} has too few distinct characters to be a random key. "
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
CHAT_STREAM_QUEUE_SIZE = _env_int("CHAT_STREAM_QUEUE_SIZE", 128)  # bedrock_service stream queue
BEDROCK_TIMEOUT_SECONDS = _env_int("BEDROCK_TIMEOUT_SECONDS", 30)
BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS = _env_int("BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS", 10)

# User messages an unauthenticated caller may send before being asked to log
# in. chat.js enforces the same number client-side and already handles the 401,
# but nothing enforced it server-side, so calling the API directly bought
# unlimited Bedrock inference.
CHAT_FREE_MESSAGE_LIMIT = _env_int("CHAT_FREE_MESSAGE_LIMIT", 6)

# Requests per minute per client IP on everything that is not chat, auth or
# contact - the analytics session, event and dashboard routes. It was a
# hardcoded constructor default of 60, which the activity dashboard alone could
# exhaust: one load fires the session create or heartbeat, a bulk event flush,
# three `/sessions/{id}/…` reads and the SSE stream, then a flush and an end
# call on unload, and the page keeps a 2-second flush timer and a 15-second
# clock tick running on top of that. A few refreshes reached 60 and the whole
# API started answering 429.
#
# These are cheap authenticated or session-scoped database calls, not
# inference, so the budget only has to stop a runaway client. The three
# endpoints that actually need a tight bound keep their own, far stricter ones
# below and are unaffected by this number.
RATE_LIMIT_PER_MINUTE = _env_int("RATE_LIMIT_PER_MINUTE", 1000)

# Requests per minute per IP against the Bedrock-backed chat routes. These used
# to share the general 60/min budget; 12 is roughly one message every five
# seconds, which no real conversation exceeds, and it caps what an anonymous
# caller can spend without needing to know who they are.
CHAT_RATE_LIMIT_PER_MINUTE = _env_int("CHAT_RATE_LIMIT_PER_MINUTE", 12)

# Where POST /contact delivers. The contact form used to post to formsubmit.co,
# the SPA's only third-party runtime egress; the address was already public in
# the markup, so it is not a secret and has a default.
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "inboxtorj@gmail.com")

# Contact submissions per hour per IP. An hour, not a minute: a human sends one
# message and a spam run sends thousands, so the window that separates them is
# the long one. The general 60/min budget would have allowed 3,600 an hour.
CONTACT_RATE_LIMIT_PER_HOUR = _env_int("CONTACT_RATE_LIMIT_PER_HOUR", 5)

# Who may read the aggregate analytics. `users` has no role column, and adding
# one for a site with a single real account would be a schema change in service
# of a constant. An env var is smaller, reversible, and fails closed: unset
# means nobody, not everybody.
OWNER_EMAIL = (os.getenv("OWNER_EMAIL") or "").strip().lower()

# Concurrent SSE connections one analytics session may hold open. A session
# token is free - POST /sessions is unauthenticated by design - and an open
# stream costs a worker slot for as long as it lasts, so without a cap a caller
# could hold every one of them. Two is enough for a real visitor with the
# dashboard open in a second tab.
MAX_STREAMS_PER_SESSION = _env_int("MAX_STREAMS_PER_SESSION", 2)

# Whose X-Forwarded-For is believed. This defaulted to empty, which meant
# `client_ip_from_request` fell back to the direct peer - and the documented
# production topology is Apache proxying `/api` to Uvicorn on the same host, so
# the direct peer is the loopback address for *every* visitor. Every rate
# limit was therefore one shared bucket for the whole site rather than one per
# client, and every `user_sessions.ip_address` recorded the proxy.
#
# Loopback is the safe default for that topology: X-Forwarded-For is honoured
# only when the request actually arrives from the local proxy, so an API
# exposed directly to the internet still ignores the header entirely and
# cannot be spoofed by a remote caller. Deployments with the proxy on another
# host must name it here.
TRUSTED_PROXY_NETWORKS = parse_proxy_networks(
    os.getenv("TRUSTED_PROXY_IPS", "127.0.0.1,::1")
)

