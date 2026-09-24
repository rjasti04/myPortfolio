# Database Reference

PostgreSQL, accessed through SQLAlchemy 2 ORM with the async `asyncpg` driver.
Schema changes ship as Alembic migrations under `server/alembic/versions/`.

- [Connection](#connection)
- [Entity relationships](#entity-relationships)
- [Tables](#tables)
- [Indexes](#indexes)
- [Migrations](#migrations)
- [Working with migrations](#working-with-migrations)
- [Dialect variants](#dialect-variants)
- [Retention and lifecycle](#retention-and-lifecycle)

---

## Connection

```dotenv
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname
```

The `postgresql+asyncpg://` driver marker is required by SQLAlchemy. One place
strips it: `kafka_stream._asyncpg_dsn()`, which needs a plain
`postgresql://` DSN for the raw asyncpg connection that holds the
`LISTEN/NOTIFY` fan-out.

`server/db/database.py` creates the engine with default pooling and
`expire_on_commit=False`, so objects stay usable after a commit — which the
streaming handlers depend on.

---

## Entity relationships

```
                    ┌─────────────────┐
                    │      users      │
                    │  id (uuid) PK   │
                    └────────┬────────┘
                             │ (all ON DELETE CASCADE)
        ┌──────────────┬─────┴───────┬─────────────────┬──────────────────┐
        ▼              ▼             ▼                 ▼                  ▼
┌───────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ user_sessions │ │ refresh_ │ │  password_   │ │     ai_      │ │  one_time_     │
│  session_id PK│ │  tokens  │ │   history    │ │conversations │ │    tokens      │
│  user_id NULL │ │          │ │              │ │              │ │                │
└───────┬───────┘ └──────────┘ └──────────────┘ └──────────────┘ └────────────────┘
        │ ON DELETE CASCADE
        ▼
┌────────────────────────┐
│ user_activity_events   │
│  event_id (bigint) PK  │
└────────────────────────┘
```

`user_sessions.user_id` is **nullable** — that is the whole point of the
analytics session: an anonymous visitor gets a session row and a capability
token without an account. It is populated only when a session belongs to a
signed-in user, which is what `GET /auth/sessions` lists.

---

## Tables

### `users`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | no | PK, `uuid4()` default |
| `email` | `VARCHAR(255)` | no | Unique, indexed, stored lowercase |
| `username` | `VARCHAR(50)` | yes | Optional display name |
| `hashed_password` | `VARCHAR(255)` | no | bcrypt over a SHA-256 hex digest |
| `created_at` | `TIMESTAMPTZ` | no | `now()` |
| `updated_at` | `TIMESTAMPTZ` | yes | `onupdate` |
| `is_active` | `BOOLEAN` | no | Default `true` |
| `last_login` | `TIMESTAMPTZ` | yes | Set on a completed sign-in |
| `failed_login_attempts` | `INTEGER` | no | The password tally. Default `0`; 5 triggers a lock |
| `locked_until` | `TIMESTAMPTZ` | yes | Password lock: 15 minutes from the fifth failure |
| `deleted_at` | `TIMESTAMPTZ` | yes | Soft delete; reactivation window is 30 days |
| `email_verified_at` | `TIMESTAMPTZ` | yes | `NULL` until the address is confirmed; login refuses `NULL` |
| `totp_secret` | `VARCHAR(255)` | yes | Base32 TOTP secret |
| `is_totp_enabled` | `BOOLEAN` | no | Default `false` |
| `totp_failed_attempts` | `INTEGER` | no | The code tally: wrong or replayed TOTP codes. Default `0`; 5 triggers a lock |
| `totp_locked_until` | `TIMESTAMPTZ` | yes | Code lock: 15 minutes from the fifth failure |
| `totp_last_step` | `BIGINT` | yes | The 30-second step a code was last accepted for; a code for that step or an earlier one is refused |

Failed second factors have their **own** tally. They used to share
`failed_login_attempts` with passwords, which made a lock from password guesses
indistinguishable from one from code guesses: five wrong passwords shut the
owner out of the magic-link route too, and a password reset cleared the code
guesses with it. A correct password clears only the password tally, so an
attacker who knows the password still cannot reset the code count by logging in
again. See `docs/SECURITY.md`, "Account lockout".

`email_verified_at` is a timestamp rather than a boolean for the same reason
`one_time_tokens.used_at` is one: it keeps *when*, which a bool throws away.
Migration 10 backfills every row that existed at deploy time from its
`created_at` — those accounts predate the check, and defaulting them to `NULL`
would have locked the site's only real account out of it.

### `user_sessions`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `session_id` | `UUID` | no | PK, `uuid4()` default |
| `user_id` | `UUID` | **yes** | FK → `users.id`, `ON DELETE CASCADE`, indexed |
| `ip_address` | `VARCHAR(64)` | no | Server-resolved; never taken from the body |
| `user_agent` | `VARCHAR(512)` | yes | Truncated on write |
| `device_type` | `VARCHAR(50)` | yes | `desktop` / `mobile` / `tablet` / `unknown` |
| `started_at` | `TIMESTAMPTZ` | no | `now()` |
| `last_active_at` | `TIMESTAMPTZ` | no | Bumped by the heartbeat |
| `ended_at` | `TIMESTAMPTZ` | yes | |
| `is_active` | `BOOLEAN` | no | Default `true` |
| `end_reason` | `VARCHAR(50)` | yes | `logout`, `timeout`, `closed`, `tab_closed_or_hidden`, `unknown`, `password_change`, `user_revoked_others`, `user_revoked_session` |

No token is stored: the capability token is an HMAC over the id, so it needs no
storage and cannot be derived from the id alone.

### `user_activity_events`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `event_id` | `BIGINT` | no | PK, autoincrement (`Integer` under SQLite) |
| `session_id` | `UUID` | no | FK → `user_sessions.session_id`, `ON DELETE CASCADE`, indexed |
| `event_type` | `VARCHAR(100)` | no | One of the ten declared types |
| `page_path` | `VARCHAR(256)` | yes | |
| `event_data` | `JSONB` | yes | ≤ 4096 bytes serialised (`JSON` under SQLite) |
| `created_at` | `TIMESTAMPTZ` | no | `now()` |

`JSONB` gives binary storage, GIN indexability and the containment operators
payload filtering needs.

### `refresh_tokens`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | no | PK |
| `user_id` | `UUID` | no | FK → `users.id`, `ON DELETE CASCADE`, indexed |
| `token_jti` | `VARCHAR(255)` | no | Unique, indexed — the `jti` claim of the issued token |
| `expires_at` | `TIMESTAMPTZ` | no | 30 days from issue |
| `created_at` | `TIMESTAMPTZ` | no | `now()` |
| `is_revoked` | `BOOLEAN` | no | Set on rotation, logout, password change or delete |
| `ip_address` | `VARCHAR(64)` | yes | Client IP at sign-in, via `client_ip_from_request` |
| `user_agent` | `VARCHAR(512)` | yes | Raw header at sign-in, truncated |
| `device_type` | `VARCHAR(50)` | yes | `desktop` / `mobile` / `tablet`, derived from the header |
| `last_used_at` | `TIMESTAMPTZ` | yes | Bumped on rotation |

Refresh tokens are **rotated**: a successful `/auth/refresh` revokes the
presented `jti` and issues a new row. The claim and the revocation are one
conditional `UPDATE`, so two requests presenting the same token cannot both
rotate it — reading the row, checking `is_revoked` in Python and writing it back
left a window under READ COMMITTED where both won and one credential became two.

The four context columns are what `GET /auth/sessions` displays: one live row
here **is** one live session, which is why the session panel reads this table
rather than `user_sessions`. They are nullable because tokens issued before they
shipped have no request to read them from.

### `one_time_tokens`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | no | PK |
| `user_id` | `UUID` | no | FK → `users.id`, `ON DELETE CASCADE`, indexed |
| `jti` | `VARCHAR(64)` | no | Unique, indexed |
| `purpose` | `VARCHAR(32)` | no | `password_reset` · `magic_link` · `2fa_pre_auth` |
| `expires_at` | `TIMESTAMPTZ` | no | 15 / 10 / 5 minutes respectively |
| `used_at` | `TIMESTAMPTZ` | yes | Set on redemption — a timestamp, not a boolean, so the audit trail keeps *when* |
| `created_at` | `TIMESTAMPTZ` | no | `now()` |

These three flows previously shared `refresh_tokens`, which conflated unrelated
things: nothing recorded what a row was for, so the type could only be inferred
from the JWT presenting it; `revoke_user_tokens` swept pending password resets
away as if they were sessions; and a table meaning "this user has a live
session" also meant "this user asked for a link". The `purpose` check on
redemption is what stops a token minted for one flow being spent in another.

### `password_history`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | no | PK |
| `user_id` | `UUID` | no | FK → `users.id`, `ON DELETE CASCADE`, indexed |
| `password_hash` | `VARCHAR(255)` | no | An **old** hash, archived on change |
| `created_at` | `TIMESTAMPTZ` | no | `now()` |

Pruned to the most recent `PASSWORD_HISTORY_LIMIT` (5) rows after each change.
A new password is checked against the current hash plus these five.

### `ai_conversations`

| Column | Type | Null | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | no | PK |
| `user_id` | `UUID` | no | FK → `users.id`, `ON DELETE CASCADE`, indexed |
| `title` | `VARCHAR(255)` | no | Derived from the first user message (≤ 45 chars) |
| `model_id` | `VARCHAR(100)` | no | Bedrock model that produced the last turn |
| `compressed_payload` | `BYTEA` | no | zlib level 6 over UTF-8 JSON |
| `message_count` | `INTEGER` | no | Default `0` |
| `created_at` | `TIMESTAMPTZ` | no | `now()` |
| `updated_at` | `TIMESTAMPTZ` | no | `now()`, `onupdate` |

Only written for signed-in callers. List queries deliberately select the summary
columns and never the blob.

---

## Indexes

| Index | Table | Definition | Why |
| :--- | :--- | :--- | :--- |
| `ix_users_email` | `users` | `(email)` unique | Login lookup |
| `ix_user_sessions_user_id` | `user_sessions` | `(user_id)` | `GET /auth/sessions` |
| `ix_user_sessions_started_at` | `user_sessions` | `(started_at)` | The owner dashboard's date window (`/admin/analytics/overview`) |
| `ix_events_session_created` | `user_activity_events` | `(session_id, created_at DESC, event_id DESC)` | Mirrors the list endpoint's `ORDER BY` exactly, so pagination is an index scan rather than a sort over the session's whole event set. Leading with `session_id`, it also serves the FK cascade, the summary and the per-session funnel |
| `ix_events_created_type` | `user_activity_events` | `(created_at, event_type)` | Every `/admin/analytics` date window. The window leads because `/overview` and `/funnel` filter on it alone; the type then narrows `/commands` and `/llm` inside the index, and `/overview`'s per-type and per-day counts are index-only |
| `ix_refresh_tokens_user_id` | `refresh_tokens` | `(user_id)` | Bulk revocation |
| `ix_refresh_tokens_token_jti` | `refresh_tokens` | `(token_jti)` unique | Refresh validation |
| `ix_one_time_tokens_jti` | `one_time_tokens` | `(jti)` unique | Redemption lookup |
| `ix_one_time_tokens_user_purpose` | `one_time_tokens` | `(user_id, purpose)` | Per-purpose sweeps, and bulk voiding on password change or logout through its leading column |
| `ix_password_history_user_created` | `password_history` | `(user_id, created_at DESC)` | Fetch and prune the most recent N |
| `ix_ai_conversations_user_updated` | `ai_conversations` | `(user_id, updated_at DESC)` | The history list ordering |

The `event_id DESC` tiebreak in `ix_events_session_created` is not cosmetic:
bulk inserts share a `created_at`, and without a stable secondary sort the same
row can appear on two pages.

No index repeats the leading column of a composite on the same table: the
composite already serves that column, so a second index only costs writes.
`tests/backend/unit/test_schema_indexes.py` fails if one comes back. There is
no index on `event_data`: nothing filters with `@>` or `?`, and the analytics
queries' `->>` extraction is not something GIN's `jsonb_ops` indexes.

---

## Migrations

Thirteen revisions, a single linear chain, one head. CI asserts exactly one head,
applies the chain against `postgres:16`, runs `alembic check` for model/schema
drift, and verifies the chain is reversible (`downgrade base` then `upgrade
head`).

| Order | Revision | Description |
| :--- | :--- | :--- |
| 1 | `1e3ed5a4b44b` | Initial: `user_sessions`, `users`, `user_activity_events` (idempotent — skips tables that already exist) |
| 2 | `d03e3984663b` | `refresh_tokens` |
| 3 | `e7f8a9b0c1d2` | `password_history` |
| 4 | `f8a9b0c1d2e3` | Account lockout: `failed_login_attempts`, `locked_until` |
| 5 | `a9b0c1d2e3f4` | `users.deleted_at` (soft delete) |
| 6 | `c2d3e4f5a6b7` | 2FA (`totp_secret`, `is_totp_enabled`) and `user_sessions.user_id` |
| 7 | `g9b0c1d2e3f4` | `ai_conversations` |
| 8 | `h1c2d3e4f5a6` | `event_data` → `JSONB`, plus `ix_events_session_created` and the GIN index |
| 9 | `i2d3e4f5a6b7` | `one_time_tokens` |
| 10 | `j3e4f5a6b7c8` | `users.email_verified_at`, backfilled from `created_at` |
| 11 | `k4f5a6b7c8d9` | Device context on `refresh_tokens`: `ip_address`, `user_agent`, `device_type`, `last_used_at` |
| 12 | `l5a6b7c8d9e0` | The code tally (`totp_failed_attempts`, `totp_locked_until`) and `totp_last_step` |
| 13 | `m6b7c8d9e0f1` | Drops the GIN index and four single-column indexes a composite already led; adds `ix_events_created_type` and `ix_user_sessions_started_at` (head) |

---

## Working with migrations

```bash
cd server

# Apply everything
PYTHONPATH=.. alembic upgrade head

# Current revision / full history / heads
PYTHONPATH=.. alembic current
PYTHONPATH=.. alembic history
PYTHONPATH=.. alembic heads

# Generate a revision from model changes — always review the output
PYTHONPATH=.. alembic revision --autogenerate -m "add something"

# Fail if models and schema disagree (what CI runs)
PYTHONPATH=.. alembic check

# Step back one revision
PYTHONPATH=.. alembic downgrade -1
```

`env.py` loads `.env` itself, so only `DATABASE_URL` needs to be present — no
Bedrock or JWT configuration required. `PYTHONPATH=..` is required because
`env.py` imports `server.models`.

### Rules

1. **Every model change ships with a migration.** `alembic check` in CI fails
   the build otherwise, before the deploy step.
2. **Keep one head.** CI counts `(head)` markers and fails on anything but one.
3. **Migrations must be reversible.** CI runs `downgrade base` then `upgrade
   head` on every push.
4. **Migrations must be backward-compatible with the previous release.** The
   deploy's rollback restores code but deliberately **never** downgrades the
   database — `alembic downgrade` can drop columns and lose rows. Expand now,
   contract in a later deploy.
5. **Never edit an applied migration.** Add a new one.
6. **Do not drop a model import from `server/models/__init__.py`.** Autogenerate
   only sees imported models, so a "tidied" import makes the next revision
   propose dropping that table.

---

## Dialect variants

The test harness runs on in-memory SQLite, so two columns carry explicit
variants:

```python
event_id  = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
event_data = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
```

SQLite only autoincrements `INTEGER PRIMARY KEY`, so a `BIGINT` column comes
back `NULL` on insert; and SQLite has no `JSONB`. The variants keep PostgreSQL
on the types it should have while the suite stays fast and dependency-free.

Note the asymmetry this creates: the pytest suite builds its schema with
`Base.metadata.create_all`, so **migrations are never executed by any test**.
That gap is exactly what the separate `migration-check` CI job against real
PostgreSQL exists to close.

---

## Retention and lifecycle

One scheduled job: `account-purger` (`auth_service.run_account_purger`), at
start and every 24 hours. Growth and lifecycle today:

| Data | Lifecycle |
| :--- | :--- |
| `user_activity_events` | Grows without bound; removed only by cascade when its session is deleted |
| `user_sessions` | Retained; marked inactive by `/end`, the heartbeat's absence, logout or revocation |
| `refresh_tokens` | Retained after revocation or expiry; validity is checked on use, not by deletion |
| `one_time_tokens` | Retained after `used_at` is set, as an audit trail |
| `password_history` | Pruned to the most recent 5 per user on every password change |
| `ai_conversations` | Retained until the owner deletes the conversation or the account |
| Soft-deleted users | Reactivated by signing in within 30 days (`ACCOUNT_REACTIVATION_WINDOW`); **purged** after it, with every row that cascades from `users` - refresh and one-time tokens, password history, conversations. Before the purge existed they were kept for good unless the address registered again |

If event volume becomes a problem, partitioning `user_activity_events` by
`created_at` or adding a retention sweep is the natural next step — neither is
implemented today.
