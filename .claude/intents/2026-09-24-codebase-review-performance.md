# Intent: Whole-Codebase Review §3 — Performance Remediation

**Source report**: `docs/review/codebase_review_20260924.md`, §3 "Performance",
findings **PF1–PF6** (2 × P2, 4 × P3). The report's line numbers refer to
`f33d629`. HEAD at the time of writing is `8e44ed9`, which carries the §1 and
§2 implementations. Those moved lines in `auth_service.py` and
`kafka_stream.py`, and §2 Phase D replaced passlib with direct `bcrypt` calls.
The spec cites line numbers at `8e44ed9`.
**Companion spec**: `.claude/specs/2026-09-24-codebase-review-performance.md`
**Status**: planned. Nothing is implemented yet. The two phases (A, B) follow
once the spec is approved.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter: PF1 is the one a visitor feels. Every bcrypt
        call runs on the event loop, so one password change freezes the whole
        API worker for about 4 s. During that freeze nobody else gets chat
        tokens, SSE frames or health-check answers. Anyone can cause the same
        stall with wrong logins, 0.55 s at a time.
  - [x] 2. Portfolio as a Work Sample: three comments claim things the code
        doesn't do. `analytics_routes.py` says `event_data->>'command'` is
        "indexable through `ix_events_data_gin`" (PF2). `event.py` justifies
        that GIN index with containment queries that don't exist (PF2). And
        the analytics module calls its own queries "unindexed aggregates"
        (PF3). A reviewer who reads the schema will find each one.
  - [x] 3. Owner: the dashboard is his (PF3, PF6). The table under it,
        `user_activity_events`, never shrinks (`docs/DATABASE.md` "Retention
        and lifecycle"), so any sequential scan of it gets slower every
        month. Log volume (PF5) is also his to pay for.

- **Problem Statement**:
  Every finding was re-checked against the working tree, and **all six still
  reproduce**. The spec corrects four of the report's proposed fixes:

  1. **PF1 is worse than reported, and the fix only works because bcrypt
     releases the GIL.**
     - The report counts six history hashes, about 1.5 s. But each history
       hash that *doesn't* match costs **two** checks: the prehash check,
       then the legacy raw-password fallback (`security.py:49-56`). A fresh
       password misses all six candidates, so a password change costs
       1 (current) + 12 (history) + 1 (new hash) = **14 bcrypt operations**,
       about **3.9 s** at the measured 276 ms each. A reset costs 13.
     - Threads help only if bcrypt releases the GIL. This was measured with
       the pinned `bcrypt==5.0.0` on a 4-CPU container, running four
       concurrent checks with a 5 ms loop ticker:
       - inline: the loop stalled for **1,085 ms**
       - through `anyio.to_thread`: the worst stall was **3 ms**, and the
         four checks took 287 ms in total
     - The report's snippet uses anyio's shared default thread pool, which
       allows 40 threads. The spec adds a **dedicated limiter** sized to the
       core count minus one. bcrypt is pure CPU, so extra threads add
       latency, not throughput. The limit also means a login flood can't
       take the core the event loop needs.
  2. **PF3's proposed index serves half the queries.** `(event_type,
     created_at)` helps `/commands` and `/llm`, which filter on both columns.
     `/overview`'s two event queries and `/funnel` filter on `created_at`
     alone, and a B-tree can't seek on a second column. Skip scan arrives
     only in PostgreSQL 18, and CI runs `postgres:16`. The spec reverses the
     column order, so **one** index serves all of them. It also makes
     `/overview`'s type and daily counts index-only scans.
  3. **PF5's counters already exist.** `METRICS["events_broadcast"]` and
     `METRICS["kafka_messages"]` count exactly what the two log lines record,
     and `pipeline_snapshot()` already reports both. The fix is only a demotion
     to DEBUG. It works because `filter_by_level` is the first structlog
     processor, so a filtered line is dropped before JSON rendering. The
     report missed a third per-event line, `simulated_event_generated`, and it
     is included.
  4. **PF2 needs no replacement index.** The partial expression index the
     report offers for `/commands` would duplicate PF3's index. That index
     already narrows `/commands` to one event type inside the window.
     Grouping by `event_data->>'command'` reads the heap row either way.

  PF4 and PF6 stand as reported. PF4 is exactly four indexes:
  `ix_user_sessions_user_id` and `ix_refresh_tokens_user_id` look similar,
  but no composite index covers them, so they stay. For PF6 the spec picks
  the report's first option: one statement with a CTE. It rejects the second,
  "materialise it once per request". Doing that in the process would mean
  pulling every `(path, next_path)` pair into Python, and `page_path` is free
  client text up to 256 characters. The number of pairs is then
  attacker-controlled.

  The six findings fall into two groups by where the work runs:

  | Phase | Group | Findings |
  | :--- | :--- | :--- |
  | A | CPU on the event loop | PF1, PF5 |
  | B | Work the database does | PF2, PF3, PF4, PF6 |

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001 and ADR-016 are not touched. Neither phase changes `frontend/`.
  - ADR-014: Phase B's schema change is **one** Alembic migration,
    `m6b7c8d9e0f1`, on the current single head `l5a6b7c8d9e0`. The migration
    that created the GIN index, `h1c2d3e4f5a6`, is not edited.
  - ADR-012: nothing here assumes more than one API instance. The bcrypt
    limiter is per process, like the rate limiter.
  - §2's security invariants hold without exception:
    - *reserve before verify*: the attempt is committed before any hash is
      checked. The offload happens after the reservation, never before it.
    - *every login refusal costs two verifications*: each path still makes
      the same number of calls, and they queue on the same limiter.
  - Every new dependency is already pinned: `anyio==4.14.2` comes in through
    Starlette. Nothing is added to `server/requirements*.in`.

- **Explicit Non-Goals**:
  - §1, §2, §4 and §5 of the report. §1 and §2 are done. §4 (UI/UX) and §5
    (Claude setup) touch no file this work touches.
  - **Faster password changes.** A password change still takes about 3.9 s
    of wall time, because the history check has to try both schemes on
    every old hash. The goal is that the change no longer stalls anyone
    else. A hash can't tell the two schemes apart (§2 spec, "Unverified
    going in", S5/S18), so the legacy fallback stays. Running the history
    checks in parallel would cut the latency but take more of the limiter,
    and is not done.
  - No retention sweep or partitioning for `user_activity_events`. That is
    an accepted limitation (`docs/DATABASE.md` "Retention and lifecycle"),
    and the report does not score it.
  - No change to `MAX_WINDOW_DAYS` (365). The index makes a window cheaper,
    and the cap still bounds a year-long scan. Only the reason given for it
    changes.
  - No `CREATE INDEX CONCURRENTLY`, unless the production row count makes it
    necessary. See the spec's "Unverified going in".
  - No release of the pooled connection during the history check.
    `change_user_password` holds one read transaction for about 3.9 s. That
    takes no row locks, and running out of the pool would take 15
    concurrent password changes.
  - No fix to the `SessionStart` hook's stale-venv behaviour, which was found
    while verifying this work. It needs its own change (see the spec's
    "Unverified going in").

## 3. Impacted Layer Matrix & Quality Gates

- [ ] **Frontend**: not touched. `npm run lint` and `npm test` are not run
      (`AGENTS.md` §6: gates for the layers touched).
- [x] **Backend** (both phases): `ruff check server tests` &&
      `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`
- [x] **Database** (Phase B): one migration. CI's `migration-check` job
      applies the full chain to `postgres:16`, runs `alembic check`, and
      checks reversibility. Locally, the `alembic-guard` skill's steps apply.
- [x] **Docs / Hashes** (both phases): `python3 scripts/check_docs.py --fix
      --show-tokens`. No inline script changes, so
      `python3 scripts/check_csp_hashes.py` is expected to pass unchanged.
      It still runs as the cheap no-op it is.

## 4. Risks & Mitigations

- **Security / Authentication (Phase A)**: the offload adds an `await`
  between the reservation and the verification. That is the window S3 closed
  in §2. Mitigations:
  - The order stays **reserve → commit → offloaded verify → record**. The
    reservation is committed before the thread starts, so a parallel guess
    that arrives mid-hash sees the reserved count.
  - `test_parallel_guesses_are_not_all_checked` already asserts at most
    `LOCKOUT_THRESHOLD` checks. It gains a lower bound of **at least one**.
    A refactor that moved the call out of reach of its spy would otherwise
    pass it with a count of zero.
  - Call sites hand the *function object* from `auth_service`'s namespace to
    the offload helper. The three spies that patch those names (`:218`,
    `:1715`, `:1766` in `test_auth.py`) keep counting real calls.
  - As in §2, the auth suite also runs on PostgreSQL 16 through
    `TEST_DATABASE_URL`, where one is reachable. SQLite's single shared test
    connection can't show real transaction interleaving.
- **Timing equalisation (S5)**: the limiter queues every path the same way, so
  queueing reveals nothing about which path a request took. Every refusal
  still costs two verifications, and the existing test keeps asserting it.
- **Availability under a login flood**: with the limiter, a flood makes
  *logins* slow instead of making the *whole API* slow. For this site,
  visitors outrank sign-in latency, so that is the right trade.
- **Database (Phase B)**:
  - `CREATE INDEX` blocks inserts into `user_activity_events` while the index
    builds, and ingest writes wait rather than fail. At this site's volume
    that should be seconds, but the row count is unverified.
  - `DROP INDEX` needs a brief exclusive lock.
  - Every change is additive or a drop, so the previous release's code runs
    against the new schema. That matches the rollback policy: code rolls
    back, the schema does not.
- **Query-plan regressions (Phase B)**: dropping
  `ix_user_activity_events_session_id` makes session lookups and the
  `ON DELETE CASCADE` from `user_sessions` use the composite
  `ix_events_session_created`, which leads with the same column. Its entries
  are wider, and at this scale that makes no measurable difference.
- **Funnel rewrite (PF6)**: the per-session funnel's response has **no
  content test** today, only access-control tests. A characterization test
  is written and passes on the *old* code first, so the rewrite is judged
  against pinned output.
- **Log visibility (PF5)**: the lines don't disappear, they move to
  `LOG_LEVEL=DEBUG`. The counters that replace them are already on the
  dashboard's pipeline DAG.
- **API Cost / Rate Limits**: no Bedrock call and no rate-limit budget
  changes. Fewer database round trips per funnel request: from three to one.
- **Performance / Asset Size**: no bundle changes.

## 5. Assumptions

This is a non-interactive session (Claude Code on the web), so the
intent-planner interview was skipped. These answers were inferred and chosen:

1. **Scope** is exactly PF1–PF6. Nothing from §4 or §5 of the report is
   included.
2. **This task's deliverable** is the intent and the spec. "Before
   implementing" was read as a gate, the same way the §1 and §2 work read it.
   Implementation follows, phase by phase, once the spec is approved.
3. **Delivery** is two phases, A then B, each committed separately with its
   own gates. A goes first because it holds the only visitor-facing P2
   (PF1).
4. **anyio, not `asyncio.to_thread`.** `asyncio.to_thread` uses the loop's
   default executor, which the Bedrock pump threads already occupy
   (`bedrock_service.py:87`). That pool has `min(32, cpu + 4)` workers.
   anyio's worker pool is separate. It is also what the report proposes and
   what Starlette uses.
5. **Limiter size** is `max(1, (os.cpu_count() or 2) - 1)`, a constant and
   not a new environment variable. A setting would add a
   `docs/CONFIGURATION.md` row and a knob nobody has asked for. Building
   the limiter at import works on the pinned anyio: it returns a
   `CapacityLimiterAdapter`, and that was checked across two separate event
   loops, the way pytest-asyncio runs tests.
6. **One migration** for PF2, PF3 and PF4. They are all index changes on the
   same head, and one migration is cheaper to review and to reverse than
   three.
7. **PF3's events index is `(created_at, event_type)`**, not the report's
   `(event_type, created_at)`. See correction 2 in §1.
8. **PF6 is one statement.** Steps, transitions and the total become
   `UNION ALL` branches over one CTE, tagged by a `kind` column. PostgreSQL
   materialises a CTE that is referenced more than once, so the
   window-function sort runs once.
