"""The indexes the models declare, held to what the queries need.

Read from `Base.metadata`, which `alembic check` keeps equal to the migrated
schema, so these guard the real indexes without a database.
"""
from server.models import Base


def _leading(index):
    """The index's first key and how many keys it has. `expressions`, not
    `columns`: a key written as `text("created_at DESC")` is not a Column, and
    `columns` would report the composite as single-column."""
    keys = list(index.expressions)
    return getattr(keys[0], "name", str(keys[0])), len(keys)


def test_no_index_repeats_the_leading_column_of_another():
    """A single-column index on the column a composite already leads makes
    every write pay for a second index that no read needs. Four tables had one
    (docs/review/codebase_review_20260924.md, PF4)."""
    repeats = []
    for table in Base.metadata.sorted_tables:
        shapes = {index.name: (_leading(index), index.unique) for index in table.indexes}
        for name, ((lead, keys), unique) in shapes.items():
            if keys != 1 or unique:
                continue
            repeats += [
                f"{table.name}: {name} repeats the lead of {other}"
                for other, ((other_lead, other_keys), _) in shapes.items()
                if other != name and other_keys > 1 and other_lead == lead
            ]
    assert not repeats, repeats


def test_owner_analytics_filters_lead_an_index():
    """Every /admin/analytics panel filters on a date window, and none of those
    columns led an index, so each panel scanned tables that never shrink (PF3)."""
    tables = Base.metadata.tables
    for table, column in (("user_activity_events", "created_at"), ("user_sessions", "started_at")):
        leads = {_leading(index)[0] for index in tables[table].indexes}
        assert column in leads, f"no index on {table} leads with {column}"
