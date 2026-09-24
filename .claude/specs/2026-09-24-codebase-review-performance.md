# Technical Specification: Whole-Codebase Review §3 — Performance Remediation

**Related Intent**: `.claude/intents/2026-09-24-codebase-review-performance.md`
**Source report**: `docs/review/codebase_review_20260924.md` §3 (PF1–PF6)
**Target Audience**: Visitor / Recruiter (PF1), then Owner and Work Sample
**Status**: planned. Implementation waits for approval of this spec.
**Tree**: line numbers are at `8e44ed9`. That is the report's `f33d629` plus
the §1 and §2 implementations. Where those moved a line, the number here
differs from the report's, and the number here is the one to use.

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [ ] Frontend SPA: not touched
  - [x] Backend API:
    - Phase A: `server/auth/security.py`, `server/services/auth_service.py`,
      `server/services/kafka_stream.py`
    - Phase B: `server/routes/analytics_routes.py`,
      `server/controllers/event_controller.py`
  - [x] Database Schema: `server/models/event.py`, `session.py`,
        `ai_conversation.py`, `password_history.py`, `one_time_token.py`,
        plus one new migration under `server/alembic/versions/` (§3)
  - [ ] CI/CD & Deploy: not touched. The existing `migration-check` job
        already covers Phase B

- **No API contract change.** Every route keeps its status codes and response
  body. That includes the two funnel routes, whose response shape is pinned
  by a test before either is rewritten.

- **No new module and no new dependency.** Phase A adds two functions to
  `security.py`. `anyio==4.14.2` is already pinned, because Starlette depends
  on it.

- **Delivery**: two phases, each committed separately. Each phase runs the
  gates for the layers it touches (§6).

| Phase | Findings | Layers | Why grouped |
| :--- | :--- | :--- | :--- |
| **A** | PF1, PF5 | BE | CPU spent in the API process on work that doesn't need the event loop. PF1 is the P2 a visitor feels, so it lands first |
| **B** | PF2, PF3, PF4, PF6 | BE + DB | Work the database does. The three index findings share one migration. PF6 rewrites the owner funnel, which uses PF3's new index |

---

## 2. API Contract & Schemas

**No route contract changes.** The one new *internal* contract is how
`auth_service` calls bcrypt:

```python
# server/auth/security.py (new, next to the existing hashing functions)
import os

import anyio.to_thread
from anyio import CapacityLimiter

# bcrypt is pure CPU and releases the GIL, so on a worker thread it leaves the
# event loop free to serve streams while it hashes. More threads than cores add
# latency, not throughput, and one core is left for the loop, so a login flood
# slows logins rather than every request on the worker.
_BCRYPT_LIMITER = CapacityLimiter(max(1, (os.cpu_count() or 2) - 1))


async def run_bcrypt(fn, *args):
    """Runs one of this module's bcrypt-bound functions on a worker thread.

    The arguments are evaluated on the loop, so pass strings, never ORM
    objects: a lazy load cannot run from a worker thread.
    """
    return await anyio.to_thread.run_sync(fn, *args, limiter=_BCRYPT_LIMITER)


def matches_any(plain_password: str, hashed_passwords) -> bool:
    """True if the password matches any of the hashes, stopping at the first.

    The reuse check tries up to six hashes at two verifications each. Checking
    them all in one call takes one thread hop, not six.
    """
    return any(verify_password(plain_password, h) for h in hashed_passwords)
```

**Call-site rule.** Wrap the call at the call site. Do not add async twins
inside `security.py`. The caller passes the function object as `auth_service`
imported it, so a `patch.object(auth_service, "<name>")` spy still sees
every call:

| `auth_service.py` | Today | After |
| :--- | :--- | :--- |
| `:247` (`check_current_password`, used by four routes) | `verify_password(password, user.hashed_password)` | `await run_bcrypt(verify_password, password, user.hashed_password)` |
| `:392`, `:399` (`register_user`) | `get_password_hash(user_data.password)` | `await run_bcrypt(get_password_hash, user_data.password)` |
| `:433`, `:440`, `:445` (`authenticate_user` refusals) | `spend_verification_time(rounds=2)` | `await run_bcrypt(spend_verification_time, 2)`: both rounds in one hop |
| `:448` (`authenticate_user`) | `verify_password_scheme(...)` | `await run_bcrypt(verify_password_scheme, user_data.password, user.hashed_password)` |
| `:497` (legacy rehash) | `get_password_hash(...)` | `await run_bcrypt(get_password_hash, user_data.password)` |
| `:759-766` (`change_user_password`) | `for past_hash in …: if verify_password(…)` | `if await run_bcrypt(matches_any, data.new_password, all_candidate_hashes):` |
| `:777` | `get_password_hash(data.new_password)` | `await run_bcrypt(get_password_hash, data.new_password)` |
| `:975-982` (`reset_password_with_token`) | same loop as `:759` | same replacement |
| `:996` | `get_password_hash(data.new_password)` | `await run_bcrypt(get_password_hash, data.new_password)` |

A wrapper inside `security.py` that called `verify_password_scheme` itself
would be invisible to the spy on `auth_service.verify_password_scheme`.
`test_parallel_guesses_are_not_all_checked` would then pass with a count of
**zero**. Its assertion is only an upper bound, so it would pass silently.

`spend_verification_time` builds `_dummy_hash` lazily (`security.py:73-76`).
Two threads can now race to build it. The race is harmless: both compute a
valid hash of the same placeholder, one assignment wins, and either hash
serves. No lock is needed.

---

## 3. Database Schema & Migration Plan

**Phase B only.** There is one migration, `m6b7c8d9e0f1_rebalance_indexes.py`,
with `down_revision = "l5a6b7c8d9e0"`, the current single head.

| Index | Table | Change | Finding | Why |
| :--- | :--- | :--- | :--- | :--- |
| `ix_events_data_gin` | `user_activity_events` | **drop** | PF2 | GIN upkeep on every event insert, and no `@>`, `?`, `?&` or `?|` query anywhere in `server/` or `scripts/` |
| `ix_user_activity_events_session_id` | `user_activity_events` | **drop** | PF4 | Leading column of `ix_events_session_created` |
| `ix_ai_conversations_user_id` | `ai_conversations` | **drop** | PF4 | Leading column of `ix_ai_conversations_user_updated` |
| `ix_password_history_user_id` | `password_history` | **drop** | PF4 | Leading column of `ix_password_history_user_created` |
| `ix_one_time_tokens_user_id` | `one_time_tokens` | **drop** | PF4 | Leading column of `ix_one_time_tokens_user_purpose` |
| `ix_events_created_type` | `user_activity_events` | **create** `(created_at, event_type)` | PF3 | Serves every owner-analytics event query (below) |
| `ix_user_sessions_started_at` | `user_sessions` | **create** `(started_at)` | PF3 | `/overview`'s two session queries |

**Why `(created_at, event_type)` and not the report's order.** These are the
event queries the owner dashboard runs, and what each filters on:

| Query | Filter | `(event_type, created_at)` on PG 16 | `(created_at, event_type)` |
| :--- | :--- | :--- | :--- |
| `/overview` event mix (`:74-81`) | `created_at >= since`, grouped by type | not usable (no leading equality) | range scan, index-only |
| `/overview` daily (`:83-93`) | `created_at >= since` | not usable | range scan, index-only |
| `/funnel` (`:121-137`) | `created_at >= since`, `page_path IS NOT NULL` | not usable | range scan |
| `/commands` (`:224-228`) | `event_type = …`, `created_at >= since` | seek | range scan, type checked in the index |
| `/llm` ×2 (`:279-282`, `:294-297`) | `event_type = …`, `created_at >= since` | seek | range scan, type checked in the index |

B-tree skip scan, which would let the report's order serve the first three,
arrives only in PostgreSQL 18. CI runs `postgres:16`. `created_at` only ever
increases, so inserts append at the right-hand edge of the index, which is
the cheapest B-tree write there is.

**Net effect on the hottest insert path.** `user_activity_events` goes from
four indexes (the PK, `session_id`, the composite, and GIN) to three (the PK,
the composite, and `(created_at, event_type)`). The GIN index, the most
expensive of them to maintain, is gone.

**Migration rules.**

- **Drops use `if_exists=True`.** Two of the migrations that created these
  indexes, `1e3ed5a4b44b` and `e7f8a9b0c1d2`, skip a table that already
  exists, so a database whose tables predate Alembic may lack one of them.
  The pinned Alembic, 1.19.1, accepts the argument: checked against the
  installed `Operations.drop_index` signature.
- **Creates are plain `CREATE INDEX`**, not `CONCURRENTLY`. Inserts into
  `user_activity_events` wait while the index builds. See "Unverified going
  in" for the row count that would change this.
- **`downgrade()`** drops the two new indexes and recreates the five dropped
  ones: the GIN one with `postgresql_using="gin"`, the other four as plain
  single-column indexes under their original names.
- **Models**, so `alembic check` stays green:
  - `event.py`: `index=True` comes off `session_id`. The GIN `Index` and its
    comment are removed. `Index("ix_events_created_type", "created_at",
    "event_type")` is added, with a comment naming the queries it serves.
  - `session.py`: `started_at` gets `index=True`, which produces the name
    `ix_user_sessions_started_at`.
  - `ai_conversation.py:9`, `password_history.py:9` and
    `one_time_token.py:22`: `index=True` comes off `user_id`.
  - Nothing else. `ix_user_sessions_user_id` and `ix_refresh_tokens_user_id`
    lead no composite index, so they stay. The `unique=True, index=True`
    pairs on `jti`, `token_jti` and `email` each make **one** unique index,
    so none of them is a duplicate.
- **Backward compatible**: only index changes. The previous release's code
  runs against the new schema, which matches the rollback policy (code rolls
  back, the schema does not).
- **Checks**: the `alembic-guard` skill's steps locally. In CI,
  `migration-check` asserts a single head, applies the chain to PostgreSQL,
  runs `alembic check`, and runs upgrade → downgrade → upgrade.

---

## 4. Implementation & Acceptance

Each row names the signal a test asserts. Backend tests live under
`tests/backend/`.

### Phase A: CPU on the event loop

**Pre-flight**: re-sync the venv first (see "Unverified going in"), so the
gates run on the pinned `bcrypt==5.0.0`.

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **PF1** | §2 contract: `run_bcrypt`, `matches_any` and the limiter, then the twelve call sites | `server/auth/security.py`, `server/services/auth_service.py` | **(1)** New `test_password_hashing_never_runs_on_the_event_loop` (`test_auth.py`): wraps `security._checkpw` and `bcrypt.hashpw` to record `threading.current_thread() is threading.main_thread()`. It drives register, a wrong login, a right login and a password change through the file's existing helpers. Every recorded call ran off the main thread, and each wrapper recorded at least one call. **(2)** New `test_a_wrong_login_does_not_stall_the_event_loop`, which mirrors `test_chat_stream.py:245`: a 10 ms heartbeat runs during one wrong-password login (two real verifications, about 0.55 s), and the test asserts `ticks >= 15`. Inline hashing yields about 0 ticks, and threaded hashing about 50. **(3)** `test_parallel_guesses_are_not_all_checked` (`:1705`) gains `assert checked.call_count >= 1`. **(4)** Every existing auth test passes unchanged, including the three spies at `:218`, `:1715` and `:1766` |
| **PF5** | `logger.info` → `logger.debug` for `broadcasting_event` (`kafka_stream.py:327`), `kafka_message_received` (`:888`) and `simulated_event_generated` (`:953`). No new counter: `METRICS["events_broadcast"]` (`:313`) and `METRICS["kafka_messages"]` (`:889`) already count them, and `pipeline_snapshot()` (`:554`) reports both | `server/services/kafka_stream.py` | New `test_a_broadcast_logs_nothing_per_event_at_info` (`tests/backend/unit/test_pipeline_simulation.py`): registers one listener, calls `deliver_local` three times with `caplog` at INFO, and asserts that `"broadcasting_event"` is not in `caplog.text` and `METRICS["events_broadcast"]` rose by 3. The consumer-loop and simulator lines are one-word edits in loops the suite doesn't drive, so they are checked by reading the diff |

### Phase B: work the database does

**Order inside the phase.** The per-session funnel characterization test
lands, and passes on the **unchanged** code, before `event_controller.py`
is edited.

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **PF2** | Drop the index (§3). Correct the `/commands` docstring (`analytics_routes.py:202-206`): it is served by `ix_events_created_type` on PostgreSQL, and `->>` extraction is never GIN-indexable under `jsonb_ops`. The JSONB column comment in `event.py` keeps its general claim and loses the `Index` comment | migration, `event.py`, `analytics_routes.py` | `alembic check` green in CI. `test_command_usage_separates_recognised_from_mistyped` unchanged |
| **PF3** | Create both indexes (§3). The `MAX_WINDOW_DAYS` comment (`analytics_routes.py:33-34`) stops calling the aggregates "unindexed": the cap remains because a year-long window is still a year-long scan | migration, `event.py`, `session.py`, `analytics_routes.py` | New `tests/backend/unit/test_schema_indexes.py`, `test_owner_analytics_filters_lead_an_index`: `created_at` leads an index on `user_activity_events` and `started_at` leads one on `user_sessions`, read from `Base.metadata`. Every `test_owner_analytics.py` test unchanged |
| **PF4** | Drop the four indexes (§3) and remove `index=True` from the four columns | migration, four model files | Same new file, `test_no_index_repeats_the_leading_column_of_another`: in `Base.metadata`, no non-unique single-column index has a column that leads another index on the same table. This is the guard that keeps PF4 from coming back |
| **PF6** | Both funnels become one statement: `ordered` becomes `.cte("ordered")`, and steps, transitions and the total become three `UNION ALL` branches over it, each tagged by a literal `kind` column (sketch below) | `server/routes/analytics_routes.py:108-192`, `server/controllers/event_controller.py:360-448` | **(1)** New characterization test `test_session_funnel_counts_steps_transitions_and_total` (`test_activity_events.py`). It seeds one session with a known path sequence that includes a revisit, a self-transition and more paths than `limit`. It asserts `hits`, `first_at`/`last_at`, `share`, the transition weights (with the self-transition excluded) and a `total_hits` that counts the paths the limit cut. It passes **before** the rewrite. **(2)** New `test_each_funnel_is_one_statement`: a `before_cursor_execute` listener counts statements that mention `user_activity_events` during one request to each funnel route, and the count is **1**. Today it is 3. **(3)** Every existing test in `test_owner_analytics.py` is unchanged |

**PF6 statement shape** (owner funnel; the per-session one has the same shape
with `first_at`/`last_at` in place of `sessions`):

```python
ordered = select(...).where(...).cte("ordered")   # same columns and WHERE as today

steps = (
    select(literal_column("'step'").label("kind"), ordered.c.path,
           null().label("next_path"), func.count().label("n"),
           func.count(func.distinct(ordered.c.session_id)).label("sessions"))
    .group_by(ordered.c.path).order_by(desc("n")).limit(limit)
).subquery()
edges = (
    select(literal_column("'edge'"), ordered.c.path, ordered.c.next_path,
           func.count(), null())
    .where(ordered.c.next_path.isnot(None), ordered.c.next_path != ordered.c.path)
    .group_by(ordered.c.path, ordered.c.next_path)
    .order_by(desc(func.count())).limit(limit * 2)
).subquery()
total = select(literal_column("'total'"), null(), null(), func.count(), null()).select_from(ordered)

rows = (await db.execute(union_all(select(steps), select(edges), total))).all()
```

- **The steps branch comes first.** SQLAlchemy types a compound select's
  columns from its first branch. On SQLite, that typing is what turns the
  per-session `first_at`/`last_at` strings back into datetimes.
- **Each limited branch is a `.subquery()`.** SQLite rejects `ORDER BY` or
  `LIMIT` on a bare compound member. Wrapping each branch works on both
  dialects.
- **The Python side re-sorts.** `UNION ALL` does not preserve the branches'
  order, so each `kind` is re-sorted by `n` descending. Ties had no defined
  order before this change either.
- **PostgreSQL computes the window once.** It materialises a CTE referenced
  more than once, so the `LEAD` window and its sort run a single time. The
  three branches then read the materialised rows.
- **The module docstring** (`analytics_routes.py:9-12`) and the
  `get_session_path_funnel` docstring describe one statement.

---

## 5. Security & Rate Limiting Review

- [x] **Reserve before verify (S3)**: unchanged. In `authenticate_user` and
      `check_current_password`, `reserve_attempt` commits before
      `run_bcrypt` is awaited. The new await point comes *after* the
      reservation, so a guess that arrives mid-hash sees the reserved count.
      Tested by `test_parallel_guesses_are_not_all_checked`, which now has
      both bounds.
- [x] **Equal-cost refusals (S5)**: unchanged. Every refusal still runs two
      verifications, now in one thread hop, and
      `test_every_login_refusal_costs_the_same_two_verifications` still spies
      on `security._checkpw`. All paths queue on the same limiter, so the
      wait for a thread says nothing about which path a request took.
- [x] **Rate limits**: no budget changes. The auth routes stay on the strict
      5/min budget. That per-address budget and the limiter together bound
      how much bcrypt one source can queue.
- [x] **No secrets logged or returned**: the three demoted lines carry a
      session id, a partition and an offset. Nothing is added to any log line.
- [x] **Authentication boundaries**: no route, dependency or ownership check
      changes. The owner-analytics routes keep `require_owner`, and the
      per-session funnel keeps `require_session_access`.
- [x] **CSP**: no inline script changes. `check_csp_hashes.py` passes
      unchanged.
- [x] **Pre-merge checklist** (`docs/SECURITY.md`): Phase A touches the
      password path, so the checklist is run before Phase A merges.

---

## 6. Verification & Test Plan

Run each gate **once, after the last edit of that phase**. If one fails, fix
it and re-run that gate alone (`AGENTS.md` §6).

```bash
# Phase A pre-flight (stale venv, see "Unverified going in")
server/.venv/bin/pip install -r server/requirements.txt -r server/requirements-dev.txt

# Both phases (backend)
ruff check server tests
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55

# Phase A, where a PostgreSQL 16 is reachable (as §2 Phase B did)
TEST_DATABASE_URL=postgresql+asyncpg://… PYTHONPATH=. pytest tests/backend/integration/test_auth.py

# Phase B (alembic-guard skill; CI's migration-check is authoritative)
cd server && PYTHONPATH=.. alembic heads      # exactly one: m6b7c8d9e0f1

# Both phases
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens
```

**Docs changed with the code**, in the same commit as the change they
describe:

| Phase | Doc | Change |
| :--- | :--- | :--- |
| A | `docs/BACKEND.md:437-446` (password hashing) | bcrypt runs on worker threads through `run_bcrypt`, bounded to one fewer than the core count. The reuse check is one `matches_any` hop |
| A | `docs/CONFIGURATION.md:263` (`LOG_LEVEL`) | `DEBUG` adds the per-event ingest lines. At `INFO`, the pipeline counters replace them |
| A | `docs/TESTING.md` rows for `test_auth.py`, `test_pipeline_simulation.py` | The new tests. `check_docs.py --fix` moves the counts |
| B | `docs/DATABASE.md:209-230` (Indexes) | Five rows removed and two added. `ix_events_session_created` now also serves the FK cascade and the summary |
| B | `docs/DATABASE.md:232-254` (Migrations) | "Thirteen revisions". Row 13 is `m6b7c8d9e0f1`, which becomes the head. The "(head)" marker moves off `l5a6b7c8d9e0` |
| B | `docs/API.md:579` (per-session funnel) | One statement, with the window computed once |
| B | `docs/API.md:769-771`, `docs/SECURITY.md:517-518` | The 365-day cap bounds scan length. The aggregates are no longer "unindexed" |
| B | `docs/BACKEND.md:272` (`get_session_path_funnel`) | "One statement: a window-function CTE read by three branches" |
| B | `docs/TESTING.md` | New row for `test_schema_indexes.py`. The new tests are counted in the `test_activity_events.py` row |

**Report update.** `docs/review/codebase_review_20260924.md` is edited only
after a phase's gates pass. Each PF finding is marked with its real outcome.
Where the fix differs from the report's suggestion, the entry says so:

- PF1: the cost estimate, and the dedicated limiter
- PF2: no expression index
- PF3: the column order
- PF5: the counters already existed, and a third log line was demoted

**Owner actions outside the repo** (listed in the PR description, not done by
the agent):

- **Before Phase B deploys**: run `SELECT count(*) FROM user_activity_events;`
  on production. Above roughly 5 million rows, switch the two `create_index`
  calls to `postgresql_concurrently=True` inside
  `op.get_context().autocommit_block()` before deploying.
- **After Phase B deploys**: run `EXPLAIN (ANALYZE, BUFFERS)` on the
  `/overview` event-mix query with a 30-day window, and confirm it scans
  `ix_events_created_type`. With few rows, PostgreSQL may still choose a
  sequential scan, and that is correct. The index starts to pay off as the
  table outgrows the window.

### Sequencing with the report's other sections

| Earlier plan | What changed | Rule here |
| :--- | :--- | :--- |
| §2 spec: "PF1 lands right after Phase B. It wraps `security.py`'s public functions in `asyncio.to_thread`" | Two changes. (1) **anyio with a dedicated limiter**, because `asyncio.to_thread` shares the default executor with the Bedrock pump threads (`bedrock_service.py:87`). (2) **The wrap is at the call site**, because wrapping inside `security.py` would hide calls from the spies (§2 above) | As specified in §2 of this spec |
| §2 spec: "PF2: a second migration from the same head `k4f5a6b7c8d9`. Whichever merges second re-points its `down_revision`" | §2's `l5a6b7c8d9e0` has merged | `down_revision = "l5a6b7c8d9e0"`. CI's single-head assertion catches a miss |
| §4 (UI/UX), §5 (Claude setup) | No shared files. Both are frontend or `.claude/` only | Independent. Either order |

### Unverified going in

- **Stale local venv.** `server/.venv` here has `bcrypt 3.2.2`, but the lock
  pins `5.0.0` (§2 Phase D). `.claude/hooks/session-start.sh:42-43` skips
  `pip install` whenever `server/.venv` exists, so a cached container never
  re-syncs after a lock change. Both versions release the GIL (measured:
  3.2.2 at 242 ms and 5.0.0 at 276 ms per check, both with a 3 ms worst
  loop stall when threaded), so PF1's result would not differ. The gates
  should still run on the pinned set. Fixing the hook, for example by
  stamping the lock hash, is a separate change.
- **Production CPU count and Uvicorn worker count.** The limiter uses
  `os.cpu_count()`. On EC2 that is the vCPU count. In a CPU-limited
  container it would be the host's count, and the limiter would be too
  generous. That is harmless, and no worse than anyio's default of 40.
- **Production PostgreSQL major version.** CI runs 16. The chosen column
  order works on every version, so this affects only whether the report's
  order would also have worked (18+).
- **Production row count of `user_activity_events`.** This decides whether a
  plain `CREATE INDEX` holds inserts for seconds or longer (owner action
  above).
- **SQLite's handling of the PF6 statement.** SQLAlchemy should render the
  CTE once at the top and wrap each limited branch. SQLite 3.8.3+ accepts
  that, so this is expected to hold, and the characterization test is the
  proof. If SQLite rejects it, the fallback is two statements: steps with
  `sum(count(*)) over ()` as the total, and edges. That still removes one of
  the three scans.
- **Whether the planner uses the new indexes at production size.** Covered
  by the owner's post-deploy `EXPLAIN` above. On a small table, a
  sequential scan is the right plan and is not a regression.
