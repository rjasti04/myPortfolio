# Backend Reference

Package-by-package guide to `server/`. Complements [`API.md`](API.md) (the HTTP
contract), [`DATABASE.md`](DATABASE.md) (the schema) and
[`CONFIGURATION.md`](CONFIGURATION.md) (environment variables).

- [Layering](#layering)
- [`main.py`](#mainpy)
- [`config/`](#config)
- [`db/`](#db)
- [`models/`](#models)
- [`schemas/`](#schemas)
- [`routes/`](#routes)
- [`controllers/`](#controllers)
- [`services/`](#services)
- [`auth/`](#auth)
- [`middlewares/`](#middlewares)
- [`utils/`](#utils)
- [`alembic/`](#alembic)
- [Dependencies](#dependencies)

---

## Layering

```
routes/          APIRouter definitions only. No logic.
   │
   ├─► controllers/   HTTP-shaped handlers: sessions, events, system
   └─► services/      Domain logic: auth, bedrock, chat history, ingest, hibp, email
              │
              ├─► models/     SQLAlchemy ORM
              └─► db/         Async engine + session factory
```

`schemas/` sits alongside as the validation boundary; `auth/`, `middlewares/`
and `utils/` are cross-cutting.

Two conventions are worth internalising:

- **Session-scoped work uses the request-scoped `AsyncSession`** injected by
  `get_db`, not a session opened straight off the engine. A handler that opens
  its own session cannot be reached by a dependency override, which makes it
  untestable. The one deliberate exception is `kafka_stream.save_batch`, which
  runs outside any request.
- **Import-time configuration is fatal by design.** `settings.py` raises on a
  missing or weak value. There are no fallbacks, because a fallback once meant
  a deployment started cleanly pointing at a database that did not exist, and
  signed tokens with a key published in this repository's history.

---

## `main.py`

126 lines. Constructs the app, the middleware stack and the lifespan.

**Startup/shutdown** — `lifespan` schedules three background tasks unless
`TESTING=true`: `kafka-consumer`, `batch-flusher`, `pg-fanout`. On shutdown it
cancels them, flushes the remaining write buffer via `save_batch()`, awaits
in-flight fire-and-forget tasks via `drain_background_tasks()`, and disposes the
engine.

**Middleware** — registered innermost-first (`add_middleware` prepends, so the
last call is the outermost layer at request time):

```python
app.add_middleware(ServerTimingMiddleware)    # innermost
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CORSMiddleware, ...)       # above the limiter → 413/429 carry CORS
app.add_middleware(RequestIDMiddleware)       # outermost → every reply is tagged
```

**Routers** — each of the five routers is included twice:

```python
app.include_router(router, prefix="/api")
app.include_router(router, include_in_schema=False)   # root mount
```

`/health` and `/api/health` are served by `system_routes` →
`system_controller.health_check`, which also verifies the database. An
app-level handler for the same paths would be shadowed by the router and never
execute.

---

## `config/`

### `env.py` (30 lines)

Environment readers with **no import side effects**, kept separate so a module
needing one variable does not import the whole configuration surface.
`db/database.py` reads `DATABASE_URL` from here for exactly that reason:
importing `settings` would also demand `AWS_REGION`, `DEFAULT_MODEL_ID` and
`JWT_SECRET`, which would make `alembic upgrade head` refuse to run without
Bedrock and JWT configuration it has no use for — and the deploy runs alembic
over SSH, without the service's environment.

- `required_env(name)` — raises `RuntimeError` if unset or blank.
- `env_int(name, default)` — raises on non-integer or non-positive values.

### `settings.py` (97 lines)

Validated configuration. `_required_secret` additionally rejects the legacy
placeholder key that shipped in this repository (any token signed with it must
be treated as forgeable) and anything shorter than
`JWT_SECRET_MIN_LENGTH` (32).

Exports: `DATABASE_URL`, `AWS_REGION`, `DEFAULT_MODEL_ID`, `JWT_SECRET`,
`origins`, `MAX_BODY_BYTES`, `CHAT_MAX_CONCURRENCY`, `CHAT_STREAM_QUEUE_SIZE`,
`BEDROCK_TIMEOUT_SECONDS`, `BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS`,
`CHAT_FREE_MESSAGE_LIMIT`, `CHAT_RATE_LIMIT_PER_MINUTE`,
`MAX_STREAMS_PER_SESSION`, `ALLOWED_MODEL_IDS`, `TRUSTED_PROXY_NETWORKS`.

`ALLOWED_MODEL_IDS` always contains `DEFAULT_MODEL_ID`, `google.gemma-3-4b-it`
and `anthropic.claude-3-5-sonnet-20241022-v2:0`, plus anything in
`ALLOWED_MODEL_IDS`. `origins` always contains the two production domains.

### `bedrock.py` (73 lines)

Two boto3 clients built once with a shared `Config` (10s connect timeout,
`BEDROCK_TIMEOUT_SECONDS` read timeout, 2 standard-mode retries):
`bedrock_runtime` (inference) and `bedrock_mgmt` (`list_foundation_models`).

`bedrock_semaphore` is an `asyncio.Semaphore(CHAT_MAX_CONCURRENCY)`.

`acquire_bedrock_slot(busy_message)` waits at most 100 ms and raises **429**
otherwise — a streaming endpoint must take its slot in the handler, before the
response object exists, so an over-capacity request gets a real 429 rather than
a 200 whose body turns out to be an error.

`BedrockSlot.release()` is **idempotent**. That matters: if the client
disconnects between the handler returning and Starlette starting the body, the
response generator is never iterated and its `finally` never runs. Release is
therefore driven from both the generator and a Starlette `BackgroundTask`, and
the guard makes the second one a no-op instead of over-releasing the semaphore.
It is `async` so Starlette awaits it on the event loop — `asyncio.Semaphore` is
not thread-safe.

---

## `db/`

`database.py` (25 lines): `create_async_engine(DATABASE_URL)`,
`AsyncSessionLocal = async_sessionmaker(..., expire_on_commit=False)`,
`Base = declarative_base()`, and the `get_db()` async generator used as a
FastAPI dependency.

No fallback DSN, and `DATABASE_URL` is read from `config.env` rather than
`config.settings` so importing the ORM does not also demand Bedrock and JWT
configuration.

---

## `models/`

Seven models plus `Base`. `models/__init__.py` importing every one of them is
**load-bearing, not tidiness**: `alembic/env.py` reads `Base.metadata`, which is
only populated for models that have been imported. Dropping one as an "unused
import" makes autogenerate stop seeing that table — and propose dropping it.

| Model | Table | Notes |
| :--- | :--- | :--- |
| `User` | `users` | Credentials, lockout counters, soft delete, TOTP secret |
| `UserSession` | `user_sessions` | Analytics session; nullable `user_id` links it to an account |
| `UserActivityEvent` | `user_activity_events` | `BigInteger` PK with a SQLite `Integer` variant; `JSONB` with a SQLite `JSON` variant |
| `RefreshToken` | `refresh_tokens` | One row per issued refresh `jti`; rotation revokes |
| `PasswordHistory` | `password_history` | Archived hashes for reuse prevention |
| `AIConversation` | `ai_conversations` | zlib-compressed transcript in `LargeBinary` |
| `OneTimeToken` | `one_time_tokens` | Single-use tokens with a `purpose` discriminator |

**→ Columns, indexes and rationale: [`DATABASE.md`](DATABASE.md)**

---

## `schemas/`

Pydantic v2 models. The interesting decisions are the ceilings and the two
places where strictness is deliberately relaxed or tightened.

### `chat.py`

`MAX_MESSAGES = 60`, `MAX_MESSAGE_CHARS = 8_000`,
`MAX_TOTAL_CONTENT_CHARS = 24_000`. Every one is a **cost control**, not an
ergonomics choice: `/chat` takes no authentication, so whatever the schema
accepts is what an anonymous caller can bill to the Bedrock account.
`MAX_TOTAL_CONTENT_CHARS` is the load-bearing one — `chat.js` summarises its own
history at roughly 6000 estimated tokens, so a legitimate client never exceeds
it, and here the bound cannot be edited away.

`ChatMessage.role` is `Literal["user", "assistant"]` (it was a bare `str`, so
any value round-tripped into the Bedrock payload). `ChatStreamRequest` no longer
accepts `system_prompt` — see [`API.md`](API.md#chat-endpoints).

### `event.py`

`EventTypeName` is the `Literal` union of the ten accepted event types;
`EVENT_TYPES` is `get_args()` of it, so the summary endpoint zero-fills from the
same source of truth. `EVENT_DATA_MAX_BYTES = 4096`, checked by a validator
shared between `EventCreate` and `BulkEventItem` so the cap cannot drift.

`BulkEventItem` types `event_type` as a plain `str` **on purpose**. `EventCreate`
uses the `Literal`, which makes FastAPI reject the entire request for one
unrecognised row — the wrong failure mode for a batch, since `analytics.js` only
re-queues on 5xx/429 and would lose every valid event flushed alongside it. The
vocabulary is still enforced, in `create_events_bulk`, per row.

### `auth.py`

Request/response models for all 19 auth routes. `TokenResponseOr2FA` is the
union shape `/auth/login`, `/auth/2fa/verify` and `/auth/magic-link/verify`
return. `UserResponse` and `UserSessionResponse` use
`ConfigDict(from_attributes=True)`.

### `session.py`

`SessionCreate` (`user_agent` ≤ 2048, `device_type` literal) and `SessionEnd`
(`end_reason` literal). The heartbeat endpoint takes no body, so it has no
schema of its own.

---

## `routes/`

Routers only — no logic, no dependencies beyond wiring.

| Module | Prefix | Tags | Endpoints |
| :--- | :--- | :--- | :--- |
| `auth_routes.py` | `/auth` | `auth` | 19 decorator-declared routes |
| `chat_routes.py` | `/chat` | `Chat & AI` | Streaming, summarize, 3 history routes |
| `session_routes.py` | `/sessions` | `Sessions` | 4, via `add_api_route` |
| `event_routes.py` | — | `Events` | 6, via `add_api_route` |
| `system_routes.py` | — | `System` | `/health`, `/system/pipeline`, `/models` |

**Route ordering matters twice.** `POST /auth/sessions/revoke-others` is
declared before `DELETE /auth/sessions/{session_id}` so the literal segment is
not captured as a UUID; `/sessions/{id}/events/summary` and `/funnel` are
registered before the paginated `/events` list for the same reason.

`chat_routes.py` is the one router that also holds handler bodies — the
streaming generator, its telemetry write and its transcript persistence.

---

## `controllers/`

### `session_controller.py` (157 lines)

`create_session`, `session_heartbeat`, `end_session`, `get_session`. Creation
resolves the client IP server-side via `client_ip_from_request` (honouring
`X-Forwarded-For` only from a trusted proxy), truncates the user agent to 512
characters, signs the capability token, and sets the `rj_session_token` cookie
(`HttpOnly`, `SameSite=Strict`, `Secure` only over HTTPS so plain-HTTP local
development still works, `Max-Age` 24h). The three other handlers depend on
`require_session_access`.

### `event_controller.py` (479 lines)

The largest controller. Six handlers plus the SSE plumbing.

| Function | Role |
| :--- | :--- |
| `create_event` | Single insert; 404 for an unknown session; broadcasts via `spawn_background` |
| `create_events_bulk` | Per-row vocabulary filtering, batch insert, flush-reason tally, per-event broadcast |
| `stream_session_events` | The SSE endpoint: `hello` / `activity` / `pipeline` channels, replay, keep-alive, disconnect detection |
| `get_session_events` | Paginated list with a stable `created_at DESC, event_id DESC` ordering |
| `get_session_event_summary` | Two indexed round trips; zero-fills every declared type |
| `get_session_path_funnel` | Single window-function pass producing steps and transition edges |

Module constants: `SSE_KEEPALIVE_SECONDS = 15.0`,
`SSE_PIPELINE_INTERVAL_SECONDS = 2.0`, `SSE_RETRY_MS = 3000`. Helpers:
`_sse_frame` (serialises one named frame with an optional `id:`) and `_compact`
(the `{i,t,e,p,d}` wire shape).

Broadcasts always go through `spawn_background`, never a bare
`asyncio.create_task` — asyncio holds only a weak reference to a running task,
so a task whose result is discarded can be collected mid-await.

### `system_controller.py` (66 lines)

`health_check` (logs and returns 503 on a database failure), `pipeline_status`
(delegates to `kafka_stream.pipeline_snapshot`), `list_models` (runs the
blocking boto3 call through `asyncio.to_thread`).

---

## `services/`

### `auth_service.py` (878 lines)

The whole account domain. Constants: `PASSWORD_HISTORY_LIMIT = 5`, and the three
one-time-token purposes (`password_reset`, `magic_link`, `2fa_pre_auth`).

| Function | Behaviour worth knowing |
| :--- | :--- |
| `issue_one_time_token` / `consume_one_time_token` | Mint and burn with a **purpose check**, so a token minted for one flow cannot be spent in another. The caller commits |
| `register_user` | Lowercases the email; purges an account soft-deleted more than 30 days ago and frees the address; catches `IntegrityError` for the race |
| `authenticate_user` | Spends a bcrypt verification on an unknown address so timing is not an existence oracle; 5 failures → 15-minute lock; upgrades a legacy hash on success; **does not** clear lockout counters when 2FA is pending |
| `refresh_user_token` | Rotation: revoke the presented `jti`, issue a new one |
| `revoke_user_tokens` | Revokes refresh tokens, ends active `user_sessions`, and voids unused one-time tokens (a pending reset link is a credential too) |
| `logout_user` | Ends one device's session: the row named by the refresh token in the body, or by the bearer's `sid` claim when there is no body. Only a pre-`sid` bearer still ends every session. 401 when neither names one |
| `change_user_password` | Verify current → HIBP → reuse check (current + last 5) → archive old → set new → prune history → revoke everything → email |
| `request_password_reset` / `request_magic_link` | Identical generic response for every outcome, so neither enumerates accounts |
| `reset_password_with_token` | Burn the token first, then the same pipeline, plus clearing lockout |
| `delete_user_account` | Requires the literal phrase `DELETE` and the current password; soft delete with 30-day reactivation |
| `setup_2fa` | **Refuses** if 2FA is already enabled — re-enrolling would overwrite the live secret and lock the account behind a factor nobody can produce |
| `enable_2fa` / `disable_2fa` | Both require the current password **and** a valid code, and both run **lockout → password → state → code → mutate → revoke → notify**. Wrong credentials count toward the shared lockout; a state error ("2FA is not enabled") does not. Each revokes every *other* session and emails the owner |
| `verify_2fa_login` | Burns the pre-auth `jti` (otherwise a captured token bought unlimited code guesses) and counts failed codes toward the lockout |
| `verify_magic_link` | Redeems, then still routes through 2FA if enabled |
| `get_user_sessions` / `revoke_all_other_sessions` / `revoke_specific_session` | Session management for the account UI |

### `bedrock_service.py` (322 lines)

`BedrockService` wraps the runtime client; `bedrock_service` is the module-level
singleton. The client property returns the shared configured
`bedrock_runtime` when the region matches, and otherwise builds one with the
**same** `Config` — a caller asking for another region still gets the tuned
timeouts and retries rather than botocore defaults.

`_iter_blocking_stream(open_stream, queue_size)` is the important piece.
botocore's `EventStream` is a synchronous iterator whose `__next__` performs a
socket read; iterating it inside an async generator pins the event loop for the
whole model response, stalling every other request the worker handles —
including SSE keep-alives and the health check the deploy gates on.
Interleaved `await asyncio.sleep(0)` calls do not help, because the blocking
happens inside `__next__`. So a worker thread pumps items into a bounded
`asyncio.Queue` (`CHAT_STREAM_QUEUE_SIZE`), `open_stream` runs on that thread
too (the initial API call is off the loop as well), exceptions are re-raised to
the consumer, and a `threading.Event` tells the reader to stop when the client
hangs up. `BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS` bounds how long that thread
outlives an abandoned request.

`stream_chat_response(messages, system_prompt=None, model_id=None, session_id=None)` yields
`{"type": "delta", "text": …}`, then one `{"type": "metrics", "metrics": {…}}`,
or `{"type": "error", "error": …}`. Model routing is by id prefix: `anthropic.`,
`us.anthropic.` and `eu.anthropic.` use `invoke_model_with_response_stream`
(the API supporting ephemeral prompt caching on the system prompt); everything
else uses `converse_stream`. A `session_id` is sent on either path as
`requestMetadata` (a map for Converse, a JSON header for InvokeModel), which
tags the call in Bedrock's model invocation logs - a log label only, since
Bedrock keeps nothing between calls.

`DEFAULT_SYSTEM_PROMPT` holds the portfolio persona and the biographical facts
the assistant answers from. **It is the only system prompt a caller can reach.**

### `chat_history_service.py` (163 lines)

`compress_messages` / `decompress_messages` (zlib level 6 over UTF-8 JSON),
`generate_title_from_messages` (first user message, truncated at 45 characters),
`save_or_update_conversation` (upsert scoped by `user_id`),
`get_user_conversations` (summaries only — the blob is never selected),
`get_conversation_detail`, `delete_conversation`. Ownership is part of every
`WHERE` clause, so another user's conversation is indistinguishable from a
missing one.

### `kafka_stream.py` (853 lines)

The ingest pipeline, the SSE registry, and the metrics behind
`/system/pipeline`. Despite the name it runs perfectly well with no broker.

**In-memory state** — `active_streams` (session → listener queues),
`replay_buffers` + `replay_last_touched` (per-session resume rings),
`batch_buffer` + `batch_lock` (pending writes), `_background_tasks` (strong
references to fire-and-forget tasks), `_recent_broadcasts` (a 2000-entry
monotonic deque behind the throughput figure), `METRICS` (the counter dict).

| Function | Role |
| :--- | :--- |
| `spawn_background` / `drain_background_tasks` | Fire-and-forget with a strong reference; awaited on shutdown |
| `register_stream` / `unregister_stream` | Listener lifecycle; raises `TooManyStreams` past `MAX_STREAMS_PER_SESSION`. The replay tail is deliberately **kept** after disconnect |
| `replay_since` | Answers `Last-Event-ID` from the ring |
| `deliver_local` | Fans one serialised event to this process's listeners; drops the **oldest** frame on a full queue |
| `broadcast_event` | `deliver_local` plus the optional `NOTIFY` relay |
| `_publish_fanout` / `_on_fanout_notify` / `run_pg_fanout` | Cross-instance relay over Postgres `LISTEN/NOTIFY`, on a dedicated connection (a listening connection cannot be pooled), with an `INSTANCE_ID` origin check and a 7800-byte payload cap |
| `prune_replay_buffers` | Reaps rings for sessions gone longer than `SSE_REPLAY_TTL` |
| `pipeline_mode` / `pipeline_snapshot` / `_simulated_kafka_stats` | The health report and its modelled Kafka stage |
| `save_batch` | Bulk write; recoverable failures return events to the buffer (capped at `MAX_BUFFERED_EVENTS`, overflow counted), unrecoverable ones are dropped and counted |
| `add_to_batch` / `periodic_flusher` | Size-triggered and time-triggered flushing |
| `process_incoming_event` | Decode → batch + broadcast (simulated events skip the batch) |
| `decode_payload` | Tolerates raw JSON, base64-wrapped JSON, bytes, and nested encoded payloads |
| `run_kafka_consumer` / `run_simulated_consumer` | Broker consumption with automatic fallback to the mock generator |
| `_record_lag` | Best-effort consumer lag, sampled on a timer rather than per message |
| `record_flush_reason` | Tallies client flush triggers for the `ingress` stage |

The simulated stage models depth asymmetrically — it rises immediately to the
arrival burst and decays geometrically (`DRAIN_PER_2S = 0.45`) against **wall
time**, with jitter seeded per two-second bucket, so a fast poller cannot
ratchet the reported queue upward.

### `hibp_service.py` (47 lines)

`check_password_breached(password)` — Have I Been Pwned range API using
k-anonymity: only the first 5 characters of the SHA-1 hash leave the process.
5-second timeout, and **fails open** (returns `False`) if HIBP is unreachable,
so an outage there does not block password changes.

### `notification_service.py` (202 lines)

`send_security_notification_email`, `send_password_reset_email`,
`send_magic_link_email`, all built on a shared `_send`.

- `_smtp_kwargs()` enables STARTTLS and certificate validation for anything that
  is not loopback. These messages carry live account-recovery credentials, so a
  man-in-the-middle on the relay is an account takeover.
- `_token_fingerprint()` logs a 12-character digest rather than the token —
  reset and magic links were once logged in full, putting a working
  account-takeover credential into the log stream.
- `_send` returns `False` rather than raising: the recovery endpoints answer
  identically whether or not an address exists, and surfacing "your mail server
  is down" through that channel would leak which addresses are real.

---

## `auth/`

### `security.py` (137 lines)

`ALGORITHM = "HS256"`, `ACCESS_TOKEN_EXPIRE_MINUTES = 30`,
`REFRESH_TOKEN_EXPIRE_DAYS = 30`.

Passwords are **bcrypt over a SHA-256 hex digest**, which sidesteps bcrypt's
72-byte truncation. `verify_password_scheme` returns `(matched, needs_rehash)`
so a legacy row (bcrypt over the raw password) can be migrated on the one
occasion the plaintext is available — a successful login. Without that flag the
fallback would be permanent and no row would ever migrate.

`spend_verification_time()` burns roughly one bcrypt verification on the
unknown-address login path, building its dummy hash lazily on first use so the
cost lands on a request rather than every process start.

Token constructors: `create_access_token`, `create_refresh_token`,
`create_password_reset_token`, `create_pre_auth_token`, `create_magic_link_token`.
`verify_token(token, expected_type)` decodes and enforces the `type` claim,
mapping expiry and invalidity to 401 with `WWW-Authenticate: Bearer`.

### `dependencies.py` (64 lines)

`get_current_user` — decodes the bearer token, parses `sub` as a UUID, loads the
user, and rejects a missing (404) or inactive (400) account. Exception chaining
is suppressed with `from None` so parser internals never reach an
unauthenticated caller; the cause is logged instead.

`get_optional_current_user` — same, but returns `None` instead of raising. This
is what makes `/chat/stream` work for both anonymous and signed-in callers.

### `session_token.py` (122 lines)

Capability tokens for anonymous analytics sessions.
`sign_session(session_id)` = `hmac_sha256(JWT_SECRET, "analytics-session:{id}")`
— a domain separator so a value signed here can never be mistaken for one signed
elsewhere under the same key. `token_matches` uses `hmac.compare_digest`, since
a plain `==` leaks the shared prefix length through timing.

`_extract` reads header → cookie → query parameter, in that order.
`assert_session_access` raises 403 with a body identical whether or not the
session exists. `require_session_access` is the FastAPI dependency form.
`verified_session_id(request)` is the optional form, for the chat routes: the
`X-Session-ID` header's UUID when the caller also holds its token, otherwise
`None` rather than a 403, because the chat is anonymous by design.

---

## `middlewares/`

All four are **pure ASGI** (`__call__(scope, receive, send)`) rather than
`BaseHTTPMiddleware`, so they add no per-request `Request` construction on the
hot event-ingest path.

| Module | Behaviour |
| :--- | :--- |
| `request_id.py` | Sets `scope["request_id"]` and appends `X-Request-ID` |
| `body_size.py` | 413 on an oversized `Content-Length`, and again mid-stream via a wrapped `receive` that raises `BodyTooLargeError` |
| `rate_limit.py` | Three sliding windows (chat / auth / general) keyed by client IP, with `_normalise_path` stripping the `/api` mount prefix; 1-in-100 probabilistic pruning bounds memory. No-op when `TESTING=true` |
| `server_timing.py` | Appends `Server-Timing: app;dur=<ms>` measuring handler time only |

---

## `utils/`

| Module | Contents |
| :--- | :--- |
| `ip_utils.py` | `parse_proxy_networks` (CIDR list from `TRUSTED_PROXY_IPS`, invalid entries logged and skipped), `is_trusted_proxy`, `client_ip_from_request` (walks `X-Forwarded-For` right-to-left for the first non-proxy address, only when the direct peer is itself trusted) |
| `role_utils.py` | `ensure_alternating_roles` — drops empty messages, merges consecutive same-role turns, prepends a synthetic user turn if the conversation starts with an assistant, and preserves the Converse `[{"text": …}]` shape when the input used it. `_extract_text` normalises string / list / dict content |
| `logging_config.py` | `setup_logging()` — structlog with ISO timestamps, exception formatting and a JSON renderer, plus stdlib `basicConfig` at `LOG_LEVEL`. Called once from `main.py`; without it the library ran on its defaults and `LOG_LEVEL` did nothing |

---

## `alembic/`

`env.py` puts the repository root on `sys.path`, loads `.env` and `server/.env`
with python-dotenv (no shell sourcing, so unquoted values cannot break it),
reads `Base.metadata` from `server.models`, and refuses to run without
`DATABASE_URL`. Online migrations run through an async engine with `NullPool`.

`alembic.ini` sets `script_location = %(here)s/alembic`, `prepend_sys_path = .`
and a placeholder `sqlalchemy.url` that `env.py` always overwrites.

**→ The migration chain: [`DATABASE.md`](DATABASE.md#migrations)**

---

## Dependencies

Direct runtime dependencies (`server/requirements.in`):

| Group | Packages |
| :--- | :--- |
| Web | `fastapi`, `uvicorn[standard]` |
| Database | `asyncpg`, `sqlalchemy`, `alembic` |
| Validation | `pydantic`, `python-multipart`, `email-validator` |
| AWS | `boto3`, `botocore` |
| Auth | `passlib[bcrypt]`, `bcrypt<4.0.0`, `pyjwt`, `pyotp`, `qrcode`, `pillow` |
| Ingest | `aiokafka` |
| Outbound | `httpx`, `aiosmtplib` |
| Logging | `structlog` |

Dev additions (`server/requirements-dev.in`): `pytest`, `pytest-asyncio`,
`pytest-cov`, `aiosqlite`, `ruff`, plus the whole runtime set via
`-r requirements.in` so both are resolved together and CI can never install a
different version of a shared package than production.

`aiokafka` is imported defensively — `KAFKA_AVAILABLE` is `False` if the import
fails, and the consumer falls back to the simulator. `python-dotenv` is used by
`alembic/env.py` and arrives transitively through `uvicorn[standard]`.

Both `.txt` locks are `uv pip compile --universal --generate-hashes` output,
installed with `--require-hashes` by CI and the deploy.
`tests/backend/unit/test_dependency_locks.py` asserts every direct dependency is
pinned, every pin carries a hash, the two locks agree on shared packages, and
the locks target the supported Python floor.
