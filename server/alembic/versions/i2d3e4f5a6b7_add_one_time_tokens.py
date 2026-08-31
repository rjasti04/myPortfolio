"""add one_time_tokens

Password reset, magic link and 2FA pre-auth tokens were all stored as rows in
refresh_tokens. Nothing recorded a row's purpose, so revoke_user_tokens swept
pending resets away with active sessions, and a table meaning "this user has a
live session" also meant "this user asked for a link".

No backfill: the existing rows cannot be told apart from genuine refresh tokens,
and these token types live for 5-15 minutes, so any in flight at deploy time
expire on their own. A user mid-reset requests a new link.

Revision ID: i2d3e4f5a6b7
Revises: h1c2d3e4f5a6
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'i2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'h1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'one_time_tokens',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('jti', sa.String(length=64), nullable=False),
        sa.Column('purpose', sa.String(length=32), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_one_time_tokens_jti'), 'one_time_tokens', ['jti'], unique=True)
    op.create_index(op.f('ix_one_time_tokens_user_id'), 'one_time_tokens', ['user_id'], unique=False)
    op.create_index('ix_one_time_tokens_user_purpose', 'one_time_tokens', ['user_id', 'purpose'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_one_time_tokens_user_purpose', table_name='one_time_tokens')
    op.drop_index(op.f('ix_one_time_tokens_user_id'), table_name='one_time_tokens')
    op.drop_index(op.f('ix_one_time_tokens_jti'), table_name='one_time_tokens')
    op.drop_table('one_time_tokens')
