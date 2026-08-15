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


DATABASE_URL = _required_env("DATABASE_URL")
AWS_REGION = _required_env("AWS_REGION")
DEFAULT_MODEL_ID = _required_env("DEFAULT_MODEL_ID")

_raw_origins = os.getenv("CORS_ORIGINS", "")
origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not origins:
    origins = [
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

_raw_allowed_models = os.getenv("ALLOWED_MODEL_IDS", "")
ALLOWED_MODEL_IDS = {
    model.strip()
    for model in _raw_allowed_models.split(",")
    if model.strip()
}
ALLOWED_MODEL_IDS.add(DEFAULT_MODEL_ID)

TRUSTED_PROXY_NETWORKS = parse_proxy_networks(os.getenv("TRUSTED_PROXY_IPS", ""))
