"""add_2fa_and_session_user_id

Revision ID: c2d3e4f5a6b7
Revises: a9b0c1d2e3f4
Create Date: 2026-07-30 02:49:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'a9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('totp_secret', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('is_totp_enabled', sa.Boolean(), server_default='false', nullable=False))

    op.add_column('user_sessions', sa.Column('user_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_user_sessions_user_id'), 'user_sessions', ['user_id'], unique=False)
    op.create_foreign_key('fk_user_sessions_user_id', 'user_sessions', 'users', ['user_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_user_sessions_user_id', 'user_sessions', type_='foreignkey')
    op.drop_index(op.f('ix_user_sessions_user_id'), table_name='user_sessions')
    op.drop_column('user_sessions', 'user_id')

    op.drop_column('users', 'is_totp_enabled')
    op.drop_column('users', 'totp_secret')
