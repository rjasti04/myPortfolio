---
name: alembic-guard
description: Mandatory rules, safety invariants, and verification steps for creating and reviewing SQLAlchemy and Alembic schema migrations in rjWebApp.
---

# Alembic Schema Migration Safety Protocol

Whenever a task involves adding or modifying database tables, columns, indexes, or relationships under `server/models/`:

## 1. Golden Rules
1. **Never Edit Past Migrations**: Existing migration files under `server/alembic/versions/` that have already been applied to any environment are strictly immutable.
2. **Single Migration Head**: There must always be exactly one migration head. CI asserts `alembic heads | grep -c '(head)' == 1` and fails otherwise.
3. **Model & Migration Parity**: Changing a SQLAlchemy model without generating an Alembic migration will fail CI via `alembic check`.
4. **Expand/Contract for Zero-Downtime Rollback**:
   - `alembic downgrade base` is run in CI to prove reversibility, but production rollback **does not downgrade the database schema**.
   - Therefore, newly added columns must be nullable or have a database-level server default so the previous release's code continues to function if rolled back.

## 2. Standard Workflow to Add a Migration
1. Update model definitions in `server/models/`.
2. Generate migration:
   ```bash
   cd server
   PYTHONPATH=.. alembic revision --autogenerate -m "descriptive_message"
   ```
3. Inspect the generated revision in `server/alembic/versions/`:
   - Ensure autogenerate didn't produce unwanted table drops or index alterations.
   - Verify `upgrade()` and `downgrade()` methods are complete.
4. Verify migration execution:
   ```bash
   PYTHONPATH=.. alembic upgrade head
   PYTHONPATH=.. alembic check
   PYTHONPATH=.. alembic downgrade -1
   PYTHONPATH=.. alembic upgrade head
   ```

## 3. Verification Checklist
- [ ] Exactly one migration head exists.
- [ ] `alembic check` reports zero drift.
- [ ] `docs/DATABASE.md` is updated to reflect new tables/columns.
