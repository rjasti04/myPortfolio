"""index what the queries use: drop five unused indexes, add two for the date window

Three findings from docs/review/codebase_review_20260924.md §3, all index-only.

PF2 - `ix_events_data_gin` put GIN maintenance on every insert into the
hottest table, and no query used it: nothing filters with `@>`, `?` or `?&`,
and `->>` extraction, which /admin/analytics/commands does use, is not what
GIN's `jsonb_ops` indexes.

PF4 - four single-column indexes each repeated the leading column of a
composite on the same table, so every write paid for them and no read did.

PF3 - every owner-analytics panel filters on a date window, and nothing
indexed it. `(created_at, event_type)` rather than the reverse: /overview and
/funnel filter on `created_at` alone, and PostgreSQL 16 cannot use a B-tree
whose leading column the query does not constrain. This order serves those and
the queries that also name a type.

Drops are IF EXISTS because 1e3ed5a4b44b and e7f8a9b0c1d2 skip a table that
already exists, so a database whose tables predate Alembic may lack an index
they would have made.

Index changes only, so the previous release runs against this schema:
production rollback restores code, not schema. The two CREATE INDEX statements
hold inserts into their tables while they build - seconds at this site's size.

Revision ID: m6b7c8d9e0f1
Revises: l5a6b7c8d9e0
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'm6b7c8d9e0f1'
down_revision: Union[str, Sequence[str], None] = 'l5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (index, table) pairs whose leading column a composite already covers.
_REDUNDANT = [
    ('ix_user_activity_events_session_id', 'user_activity_events'),  # ix_events_session_created
    ('ix_ai_conversations_user_id', 'ai_conversations'),  # ix_ai_conversations_user_updated
    ('ix_password_history_user_id', 'password_history'),  # ix_password_history_user_created
    ('ix_one_time_tokens_user_id', 'one_time_tokens'),  # ix_one_time_tokens_user_purpose
]


def upgrade() -> None:
    op.drop_index('ix_events_data_gin', table_name='user_activity_events', if_exists=True)
    for name, table in _REDUNDANT:
        op.drop_index(name, table_name=table, if_exists=True)

    op.create_index('ix_events_created_type', 'user_activity_events', ['created_at', 'event_type'])
    op.create_index('ix_user_sessions_started_at', 'user_sessions', ['started_at'])


def downgrade() -> None:
    op.drop_index('ix_user_sessions_started_at', table_name='user_sessions')
    op.drop_index('ix_events_created_type', table_name='user_activity_events')

    column = {'user_activity_events': 'session_id'}
    for name, table in reversed(_REDUNDANT):
        op.create_index(name, table, [column.get(table, 'user_id')])
    op.create_index(
        'ix_events_data_gin', 'user_activity_events', ['event_data'], postgresql_using='gin'
    )
