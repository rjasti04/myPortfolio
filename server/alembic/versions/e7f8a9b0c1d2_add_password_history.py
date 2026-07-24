"""add_password_history

Revision ID: e7f8a9b0c1d2
Revises: d03e3984663b
Create Date: 2026-07-24 15:58:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, Sequence[str], None] = 'd03e3984663b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'password_history',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_password_history_user_id'), 'password_history', ['user_id'], unique=False)
    op.create_index('ix_password_history_user_created', 'password_history', ['user_id', sa.text('created_at DESC')], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_password_history_user_created', table_name='password_history')
    op.drop_index(op.f('ix_password_history_user_id'), table_name='password_history')
    op.drop_table('password_history')
