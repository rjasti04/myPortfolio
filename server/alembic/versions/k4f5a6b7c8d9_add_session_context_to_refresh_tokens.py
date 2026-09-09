"""add device context to refresh_tokens

`GET /auth/sessions` and the two revoke routes read `user_sessions`, which is
populated only by `POST /sessions` - the anonymous analytics endpoint, which
never sets `user_id`. Every row therefore had a null owner, so the list was
always empty and "log out all other devices" updated nothing while answering
"Logged out of all other active sessions successfully."

`refresh_tokens` already holds exactly one row per live login, with rotation
and revocation that work. It just carried nothing worth showing, and revoking
a row there actually ends the session rather than flagging an analytics record
nobody is signed in with. These four columns are what the panel needs to
render, captured at the moment the token is minted.

All nullable: tokens issued before this deploy have no request to read them
from, and a token with no recorded device is still a token worth listing.

Revision ID: k4f5a6b7c8d9
Revises: j3e4f5a6b7c8
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'k4f5a6b7c8d9'
down_revision: Union[str, Sequence[str], None] = 'j3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('refresh_tokens', sa.Column('ip_address', sa.String(length=64), nullable=True))
    op.add_column('refresh_tokens', sa.Column('user_agent', sa.String(length=512), nullable=True))
    op.add_column('refresh_tokens', sa.Column('device_type', sa.String(length=50), nullable=True))
    # Bumped on rotation, so the panel can order by genuine recency rather than
    # by when the session first began.
    op.add_column('refresh_tokens', sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('refresh_tokens', 'last_used_at')
    op.drop_column('refresh_tokens', 'device_type')
    op.drop_column('refresh_tokens', 'user_agent')
    op.drop_column('refresh_tokens', 'ip_address')
