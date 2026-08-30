"""activity_events jsonb payload + composite pagination index

Revision ID: h1c2d3e4f5a6
Revises: g9b0c1d2e3f4
Create Date: 2026-08-30 09:00:00.000000

Two changes to `user_activity_events`, both driven by the activity dashboard:

1. `event_data` JSON -> JSONB. JSON is stored as reparsed text on every read
   and supports no index; JSONB enables GIN and the containment operators the
   payload-filter queries need.
2. A composite index matching the list endpoint's exact ORDER BY
   (session_id, created_at DESC, event_id DESC). Only `session_id` was
   indexed, so every page load sorted the session's whole event set.

The USING cast rewrites the table. That is acceptable at this table's size;
on a large deployment prefer add-column + backfill + swap.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'h1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'g9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'user_activity_events',
        'event_data',
        existing_type=postgresql.JSON(astext_type=sa.Text()),
        type_=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=True,
        postgresql_using='event_data::jsonb',
    )

    # Serves `WHERE session_id = ? ORDER BY created_at DESC, event_id DESC`
    # as an index-only scan, removing the sort from every page fetch.
    op.create_index(
        'ix_events_session_created',
        'user_activity_events',
        ['session_id', sa.text('created_at DESC'), sa.text('event_id DESC')],
    )

    # Containment lookups over the payload (e.g. event_data @> '{"theme":"dark"}').
    op.create_index(
        'ix_events_data_gin',
        'user_activity_events',
        ['event_data'],
        postgresql_using='gin',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_events_data_gin', table_name='user_activity_events')
    op.drop_index('ix_events_session_created', table_name='user_activity_events')
    op.alter_column(
        'user_activity_events',
        'event_data',
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        type_=postgresql.JSON(astext_type=sa.Text()),
        existing_nullable=True,
        postgresql_using='event_data::json',
    )
