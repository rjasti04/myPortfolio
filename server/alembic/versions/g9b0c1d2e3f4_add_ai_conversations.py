"""add_ai_conversations

Revision ID: g9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-07-30 11:18:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g9b0c1d2e3f4'
down_revision: Union[str, Sequence[str], None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'ai_conversations',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False, server_default='New Conversation'),
        sa.Column('model_id', sa.String(length=100), nullable=False),
        sa.Column('compressed_payload', sa.LargeBinary(), nullable=False),
        sa.Column('message_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_ai_conversations_user_id', 'ai_conversations', ['user_id'])
    op.create_index(
        'ix_ai_conversations_user_updated',
        'ai_conversations',
        ['user_id', sa.text('updated_at DESC')]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_ai_conversations_user_updated', table_name='ai_conversations')
    op.drop_index('ix_ai_conversations_user_id', table_name='ai_conversations')
    op.drop_table('ai_conversations')
