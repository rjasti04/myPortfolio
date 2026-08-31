"""Environment readers with no import side effects.

Kept separate from `settings` so a module needing one variable does not import
the whole configuration surface. `db/database.py` reads DATABASE_URL from here
for exactly that reason: importing settings pulled in AWS_REGION,
DEFAULT_MODEL_ID and JWT_SECRET, which made `alembic upgrade head` refuse to run
without Bedrock and JWT configuration it has no use for - and the deploy runs
alembic over SSH, without the service's environment.
"""


import os


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value
