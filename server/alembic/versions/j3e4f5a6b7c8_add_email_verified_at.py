"""add users.email_verified_at

Closes the "No email verification on registration" row in docs/SECURITY.md,
whose stated path forward was to reuse the one_time_tokens table - which is
what the service side does, with a fourth purpose.

Existing rows are backfilled as verified from their created_at. They predate
the feature, and defaulting them to NULL would mean the next deploy locked
every current account - the owner's included - out of a site whose only real
account is his. Failing closed on accounts that were created before the check
existed punishes them for the server's change, not for anything about the
address.

A timestamp rather than a boolean, for the same reason one_time_tokens.used_at
is one: it keeps *when*, which a bool throws away.

Revision ID: j3e4f5a6b7c8
Revises: i2d3e4f5a6b7
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'j3e4f5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'i2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Grandfather every account that exists at deploy time.
    op.execute(
        "UPDATE users SET email_verified_at = created_at "
        "WHERE email_verified_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column('users', 'email_verified_at')
