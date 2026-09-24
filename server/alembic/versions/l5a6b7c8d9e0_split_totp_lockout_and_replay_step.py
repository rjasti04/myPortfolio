"""split the TOTP lockout tally from the password one, and record the last step

Two changes to `users`, both from docs/review/codebase_review_20260924.md §2.

S4 - one tally counted wrong passwords and wrong TOTP codes alike. That made a
lock caused by password guesses indistinguishable from one caused by code
guesses, so the second factor could not be reached while anyone was guessing
the password: five wrong passwords from any address locked the owner out of the
magic-link route too. It also meant a password reset, which clears the tally,
cleared the code guesses with it. The code tally now has its own pair of
columns.

S11 - a TOTP code is valid for its whole 30-second step, so one seen over a
shoulder or through a phishing proxy could be used again until the step ran
out. `totp_last_step` records the step last accepted, and a code for that step
or an earlier one is refused.

All three are nullable or carry a server default, so the previous release runs
against this schema unchanged: production rollback restores code, not schema.
No backfill: a lock that exists now stays on `locked_until`, now the password
tally, and expires within fifteen minutes whatever caused it.

Revision ID: l5a6b7c8d9e0
Revises: k4f5a6b7c8d9
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'l5a6b7c8d9e0'
down_revision: Union[str, Sequence[str], None] = 'k4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('totp_failed_attempts', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('totp_locked_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('totp_last_step', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'totp_last_step')
    op.drop_column('users', 'totp_locked_until')
    op.drop_column('users', 'totp_failed_attempts')
