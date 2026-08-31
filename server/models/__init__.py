"""Model package.

Importing every model here is load-bearing, not tidiness: `alembic/env.py` does
`from server.models import Base` and reads `Base.metadata`, which is only
populated for models that have actually been imported. Drop one of these as an
"unused import" and autogenerate stops seeing that table - and proposes dropping
it. `__all__` states the intent so a linter does not offer.
"""

from server.db.database import Base
from server.models.user import User
from server.models.session import UserSession
from server.models.event import UserActivityEvent
from server.models.token import RefreshToken
from server.models.password_history import PasswordHistory
from server.models.ai_conversation import AIConversation

__all__ = [
    "Base",
    "User",
    "UserSession",
    "UserActivityEvent",
    "RefreshToken",
    "PasswordHistory",
    "AIConversation",
]
