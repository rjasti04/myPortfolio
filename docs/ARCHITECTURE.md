# Architecture

How `rjWebApp` is put together: the runtime topology, the repository map, what
happens to a request, and how data moves between the tiers.

- [System overview](#system-overview)
- [Runtime topology](#runtime-topology)
- [Repository map](#repository-map)
- [Backend request lifecycle](#backend-request-lifecycle)
- [Frontend boot sequence](#frontend-boot-sequence)
- [Data flows](#data-flows)
- [Cross-cutting conventions](#cross-cutting-conventions)
- [Known constraints](#known-constraints)

---

## System overview

Two independently deployable tiers, plus three external dependencies.

```
                    ┌─────────────────────────────────────────┐
                    │  Browser                                │
                    │  ┌───────────────────────────────────┐  │
                    │  │ dist/ (built from frontend/)      │  │
                    │  │  index.html · CSS · ES modules    │  │
                    │  │  service worker · PWA manifest    │  │
                    │  └───────────────────────────────────┘  │
                    └───────┬───────────────┬─────────────────┘
                            │               │
              fetch / SSE   │               │  POST (contact form)
                            ▼               ▼
       ┌────────────────────────────┐   ┌──────────────────┐
       │  Apache (EC2)              │   │  formsubmit.co   │
       │  /var/www/html  ← static   │   └──────────────────┘
       │  /api/*         → proxy    │
       └───────────┬────────────────┘
                   ▼
       ┌────────────────────────────┐
       │  Uvicorn + FastAPI         │
       │  (systemd: fastapi.service)│
       │   middleware → routers     │
       │   → controllers/services   │
       │  + background tasks:       │
       │    kafka-consumer          │
       │    batch-flusher           │
       │    pg-fanout               │
       └──┬──────────┬──────────┬───┘
          │          │          │
          ▼          ▼          ▼
   ┌────────────┐ ┌────────┐ ┌─────────────────────┐
   │ PostgreSQL │ │ Amazon │ │ SMTP relay          │
   │            │ │Bedrock │ │ api.pwnedpasswords  │
   │            │ │        │ │ (optional Kafka)    │
   └────────────┘ └────────┘ └─────────────────────┘
```

**Frontend** — static hosting capable. No server-side rendering, no build-time
configuration, no framework. Section routing is hash-based and entirely
client-side; the service worker provides the offline shell.

**Backend** — a single ASGI process (`server.main:app`). Stateless apart from
three in-memory structures that are deliberately per-process: the rate limiter's
sliding windows, the SSE listener registry, and the ingest write buffer.

**Degradation** — every backend call is wrapped so that a failure is logged and
swallowed. With the API down, the portfolio still renders, the terminal still
works, and only the activity dashboard, chat and account UI go quiet.

---

## Runtime topology

| Concern | Production | Local development |
| :--- | :--- | :--- |
| Static assets | Apache serving `/var/www/html` (rsynced `dist/`) | `python -m http.server 8080 --directory frontend` |
| API | Uvicorn under `systemd` (`fastapi.service`), fronted by Apache | `uvicorn server.main:app --reload` on `:8000` |
| API base seen by the browser | `https://rjasti.com/api` | `http://localhost:8000` |
| Database | PostgreSQL | PostgreSQL (SQLite in tests only) |
| Kafka | Optional; absent by default | Absent |

### Dual-prefix router mounting

`server/main.py` mounts every router **twice** — once at `/api` and once at the
root — because whether Apache strips the `/api` prefix before proxying decides
which copy actually serves production. Dropping either without knowing would be
an outage, so both stay. The root copy is registered with
`include_in_schema=False` so `/openapi.json` advertises each endpoint once and
FastAPI does not warn about duplicate operation ids.

The deploy's smoke test probes `GET /api/health` specifically, to prove prefix
routing still works.

### Background workers

Started in the FastAPI `lifespan` context unless `TESTING=true`:

| Task | Function | Role |
| :--- | :--- | :--- |
| `kafka-consumer` | `kafka_stream.run_kafka_consumer` | Consume the activity topic; falls back to the mock generator when no broker is configured |
| `batch-flusher` | `kafka_stream.periodic_flusher` | Drain the write buffer on a timer and prune expired SSE replay rings |
| `pg-fanout` | `kafka_stream.run_pg_fanout` | Hold a `LISTEN` connection for cross-instance SSE relay (no-op unless `ENABLE_PG_FANOUT=true`) |

On shutdown all three are cancelled, the remaining buffer is flushed, in-flight
fire-and-forget tasks are awaited, and the SQLAlchemy engine is disposed.

---

## Repository map

### `frontend/` — the static tier

| Path | Role |
| :--- | :--- |
| `index.html` | The whole page. Meta CSP (with two `sha256-` pinned inline scripts), JSON-LD structured data, and six sections: `about`, `resume`, `hobbies`, `activity`, `contact`, `ai` |
| `styles.css` | Global stylesheet, ~8.8k lines across 24 `#region` blocks. `grep -n '#region' frontend/styles.css` gives a live map |
| `auth-modal.css` | Account modal, profile dropdown, password meter, 2FA and session UI |
| `fonts.css`, `fonts/` | **Generated** by `scripts/vendor_fonts.py` — subset Plus Jakarta Sans + Font Awesome |
| `sw.js` | Service worker: precache install, network-first for documents, stale-while-revalidate for hashed assets, API responses never cached |
| `manifest.json` | PWA metadata (`standalone`, dark background, two icons) |
| `.htaccess` | Apache canonical-URL rewrites (extensionless paths, apex host), compression, cache headers (immutable for hashed assets), security headers |
| `three-bg.js` | Full-viewport animated plexus background — plain 2D canvas despite the name |
| `js/` | ES modules; see [`JAVASCRIPT.md`](JAVASCRIPT.md) |
| `js/terminal/` | The command prompt, split into data (`registry`), DOM builders (`output`), `history`, `keymap`, `palette` and the `index` that owns all wiring |
| `vendor/` | DOMPurify + marked, copied verbatim from the npm packages pinned in `package.json` |
| `tests/` | Node test runner + jsdom suites (excluded from `dist/`) |
| `worldcup.html` | Standalone side project, unrelated to the portfolio SPA, served at `/worldcup` (retired — the header link is hidden) |
| `ucl.html` | Standalone side project, unrelated to the portfolio SPA — the 2026/27 Champions League bracket predictor, served at `/ucl` |

### `server/` — the API tier

Layered: **routes → controllers/services → models → database**. Routers hold no
logic; controllers own HTTP-shaped work for sessions/events/system; services own
domain logic for auth, Bedrock, chat history, ingest, breach checks and email.

| Package | Contents |
| :--- | :--- |
| `main.py` | App construction, middleware stack, lifespan, dual-prefix router mounting |
| `config/` | `env.py` (side-effect-free readers), `settings.py` (validated configuration), `bedrock.py` (tuned boto3 clients + the concurrency semaphore) |
| `db/database.py` | Async engine, `async_sessionmaker`, declarative `Base`, `get_db` dependency |
| `models/` | `User`, `UserSession`, `UserActivityEvent`, `RefreshToken`, `PasswordHistory`, `AIConversation`, `OneTimeToken` |
| `schemas/` | Pydantic v2 request/response models with the size and vocabulary ceilings |
| `routes/` | `auth_routes`, `chat_routes`, `session_routes`, `event_routes`, `system_routes` |
| `controllers/` | `session_controller`, `event_controller` (including the SSE endpoint), `system_controller` |
| `services/` | `auth_service`, `bedrock_service`, `chat_history_service`, `kafka_stream`, `hibp_service`, `notification_service` |
| `auth/` | `security.py` (JWT + password hashing), `dependencies.py` (current-user resolution), `session_token.py` (anonymous capability tokens) |
| `middlewares/` | `request_id`, `body_size`, `rate_limit`, `server_timing` — all pure ASGI |
| `utils/` | `ip_utils` (trusted-proxy-aware client IP), `role_utils` (Bedrock role alternation), `logging_config` (structlog → JSON) |
| `alembic/` | Nine migrations, single head; `env.py` loads `.env` and reads only `DATABASE_URL` |

**→ Package-by-package detail: [`BACKEND.md`](BACKEND.md)**

### Supporting directories

| Path | Role |
| :--- | :--- |
| `tests/backend/` | pytest suites — `unit/` (6 files) and `integration/` (6 files) |
| `scripts/` | `build.mjs`, `check_csp_hashes.py`, `vendor_fonts.py`, four Pillow image helpers (one of them, `generate_social_previews.py`, renders the cards in `scripts/social-previews/`) |
| `docs/` | This documentation set |
| `assets/` | `master-icon.png` — kept outside `frontend/` so the deploy never publishes it |
| `.github/workflows/` | `deploy.yml` — the whole CI/CD pipeline |
| `.claude/`, `.codex/`, `.amazonq/`, `.antigravity/` | Per-tool agent config; all deprecated stubs pointing at `AGENTS.md` |

---

## Backend request lifecycle

`app.add_middleware` prepends, so the **last** registration is the outermost
layer. Reading `server/main.py` innermost-first:

```
    ┌──────────────────────────────────────────────────────────┐
 4  │ RequestIDMiddleware        outermost — tags every reply  │
    │  ┌────────────────────────────────────────────────────┐  │
 3  │  │ CORSMiddleware          so 413/429 carry CORS too  │  │
    │  │  ┌──────────────────────────────────────────────┐  │  │
 2  │  │  │ RateLimitMiddleware   general / auth / chat  │  │  │
    │  │  │  ┌────────────────────────────────────────┐  │  │  │
 1  │  │  │  │ BodySizeLimitMiddleware  MAX_BODY_BYTES│  │  │  │
    │  │  │  │  ┌──────────────────────────────────┐  │  │  │  │
 0  │  │  │  │  │ ServerTimingMiddleware  app;dur= │  │  │  │  │
    │  │  │  │  │  → router → controller/service   │  │  │  │  │
    │  │  │  │  └──────────────────────────────────┘  │  │  │  │
    │  │  │  └────────────────────────────────────────┘  │  │  │
    │  │  └──────────────────────────────────────────────┘  │  │
    │  └────────────────────────────────────────────────────┘  │
    └──────────────────────────────────────────────────────────┘
```

1. **`RequestIDMiddleware`** — assigns `scope["request_id"]`, appends
   `X-Request-ID`. Outermost so even a rate-limited 429 is correlatable.
2. **`CORSMiddleware`** — origins from `settings.origins` (production domains
   always appended). Exposes `Server-Timing` and `X-Request-ID`, which are not
   CORS-safelisted. Sits above the limiter so rejections are readable by the
   browser rather than surfacing as opaque network errors.
3. **`RateLimitMiddleware`** — three separate sliding windows keyed by client IP:
   chat routes (`CHAT_RATE_LIMIT_PER_MINUTE`, default 12/min), auth routes
   (5/min, hardcoded), everything else (60/min). `_normalise_path` strips the
   optional `/api` mount prefix first, so the strict budgets cannot be
   sidestepped by adding four characters to the URL. Disabled when
   `TESTING=true`.
4. **`BodySizeLimitMiddleware`** — rejects with 413 on `Content-Length` above
   `MAX_BODY_BYTES`, and again mid-stream if the actual body exceeds it.
5. **`ServerTimingMiddleware`** — appends `Server-Timing: app;dur=<ms>` measuring
   handler wall time only. The activity dashboard subtracts it from its own
   `performance.now()` delta to separate network from application time.

Then FastAPI dependency resolution runs — `get_db` (request-scoped
`AsyncSession`), `get_current_user` / `get_optional_current_user` (JWT bearer),
or `require_session_access` (analytics capability token) — before the handler.

---

## Frontend boot sequence

1. **Before paint** — the CSP-hashed inline theme bootstrap applies
   `.dark-theme` from `localStorage.theme`, else the OS preference.
   `js/theme-bootstrap.js` then replays any saved custom palette. `initTheme()`
   in `js/theme.js` must apply the identical rule or the theme visibly changes
   at `DOMContentLoaded`.
2. **Deferred classic scripts** — `vendor/purify.min.js`, `vendor/marked.min.js`,
   `js/app-logic.js` (assigns `window.AppLogic`).
3. **Module entries** — `js/auth-ui.js` and `js/main.js`, both `type="module"`.
   These are the only two esbuild entry points.
4. **`DOMContentLoaded`** — `main.js` initialises theme, navigation, contact
   form, hero title, animations, tilt, terminal, analytics, skills carousel,
   ripple, scroll-to-top and the theme customizer.
5. **Lazy modules** — `chat.js` loads on first interaction with the chat toggle
   or the `#ai` section; `activity.js` on first interaction with `#activity`.
   Both use `AbortController` so the delegated document listeners are removed
   once the module has loaded.
6. **Background layer** — on `requestIdleCallback`, exactly one animated layer
   mounts: the full-viewport plexus (`three-bg.js`) when
   `hardwareConcurrency` and `deviceMemory` clear a threshold, otherwise the
   cheaper hero particle field (`js/particles-config.js`). Neither mounts under
   `prefers-reduced-motion`.
7. **Service worker** — registered on `load`, then `registration.update()` every
   60s. A waiting worker surfaces an update banner; only the banner's button
   posts `SKIP_WAITING`, so the asset set is never swapped under a running page.

---

## Data flows

### 1. Anonymous activity ingest

```
analytics.js                    FastAPI                     PostgreSQL
────────────                    ───────                     ──────────
POST /sessions           ──►  create UserSession
                              sign HMAC capability token
                         ◄──  { session_id, session_token }
                              + Set-Cookie rj_session_token (HttpOnly, Strict)

trackEvent(...)  → queue (localStorage, namespaced per session)
  flush on: 10 queued · 2s timer · visibilitychange · pagehide

POST /events/bulk        ──►  assert_session_access per row
  X-Session-Token              unknown event_type → rejected[] (per row)
  {events, client_ts,          known → INSERT
   flush_reason}          ──►  broadcast_event → SSE listeners
                         ◄──  { inserted, rejected[] }
```

Only `5xx` and `429` re-queue; a `4xx` drops the batch and logs which event
types were lost. The queue key is namespaced per session id because the session
lives in `sessionStorage` (per tab) while the queue lives in `localStorage`
(shared) — without namespacing, a second tab would flush the first tab's events
with its own token and lose the whole batch to a 403.

### 2. Live activity stream (SSE)

```
activity.js                          event_controller
───────────                          ────────────────
EventSource(/sessions/{id}/stream)
  withCredentials: true  ──────────► require_session_access (cookie)
                                     register_stream → bounded queue
                         ◄────────── retry: 3000
                         ◄────────── event: hello    {server_time, resumed_from, pipeline}
                         ◄────────── event: activity {i,t,e,p,d}   ← carries id:
                         ◄────────── event: pipeline {…}           ← every 2s
                         ◄────────── : keep-alive                  ← after 15s silence
```

Reconnects send `Last-Event-ID` automatically; `replay_since` closes the gap
from a per-session ring buffer (`SSE_REPLAY_BUFFER` entries, retained for
`SSE_REPLAY_TTL` after disconnect). Each listener queue is bounded by
`SSE_QUEUE_MAXSIZE`; at the cap the **oldest** frame is dropped, because a live
tail beats a stale backlog. `MAX_STREAMS_PER_SESSION` caps concurrent
connections per session and answers 429 (not 403) when exceeded.

EventSource cannot set headers, which is why session creation also sets the
token as an `HttpOnly; SameSite=Strict` cookie. The `?session_token=` query
parameter is a deprecated fallback — still accepted for clients cached from
before that change, but nothing issues one.

### 3. Ingest pipeline and its health report

```
Kafka topic ──► run_kafka_consumer ─┐
(optional)                          ├─► process_incoming_event
run_simulated_consumer ─────────────┘        │
(ENABLE_EVENT_SIMULATOR)                     ├─► add_to_batch ──► save_batch ──► PostgreSQL
                                             │     (KAFKA_BATCH_SIZE, or the
                                             │      periodic_flusher timer)
                                             └─► broadcast_event ──► SSE listeners
                                                        │
                                                        └─► _publish_fanout (NOTIFY)
                                                              when ENABLE_PG_FANOUT
```

`GET /system/pipeline` (and the `pipeline` SSE channel) reports four stages —
`ingress`, `kafka`, `fastapi`, `postgres` — from in-process counters, costing no
database round trip. With no broker attached the Kafka stage is **modelled from
real throughput** (offsets total the events actually processed; depth rises with
arrivals and decays geometrically against wall time) and flagged
`simulated: true`. Set `SIMULATE_KAFKA_METRICS=false` for an honest `bypass`
report instead.

A failed flush returns its events to the buffer, capped at
`MAX_BUFFERED_EVENTS`; overflow and unrecoverable rejections are **counted**, not
just logged, so the `postgres` stage stops reporting healthy when data is lost.

### 4. AI chat

```
chat.js                              chat_routes                    Bedrock
───────                              ───────────                    ───────
POST /chat/stream                ──► model allowlist check
  Authorization (if signed in)       anonymous & >CHAT_FREE_MESSAGE_LIMIT → 401
  {messages, stream:true}            ensure_alternating_roles
                                     acquire_bedrock_slot (semaphore, 100ms)
                                     bedrock_service.stream_chat_response ──►
                                       Claude  → invoke_model_with_response_stream
                                                 (+ ephemeral prompt caching)
                                       others  → converse_stream
                                 ◄── data: {"text": "…"}          (deltas)
                                 ◄── data: {"type":"metrics", …}  (tokens, cache, latency)
                                     ↳ writes an `ai_llm_telemetry` activity event
                                     ↳ if signed in: zlib-compressed transcript
                                       → ai_conversations
```

The blocking botocore `EventStream` is pumped on a worker thread into a bounded
`asyncio.Queue`, so a model response never pins the event loop. The concurrency
slot is released from both the generator's `finally` and a Starlette background
task, guarded so the second release is a no-op — otherwise a client that
disconnects before the body is iterated leaks a slot permanently.

`system_prompt` is **not** accepted from callers: the server owns the persona
(`bedrock_service.DEFAULT_SYSTEM_PROMPT`).

### 5. Authentication

```
auth-ui.js / auth.js                 auth_routes → auth_service
────────────────────                 ──────────────────────────
POST /auth/register              ──► bcrypt(sha256(password)) → users
POST /auth/login                 ──► verify → 2FA? pre-auth token (5 min, single-use)
                                              else access (30 min) + refresh (30 d)
POST /auth/2fa/verify            ──► burn pre-auth jti, verify TOTP → token pair
POST /auth/magic-link/request    ──► one-time token (10 min) → email
POST /auth/refresh               ──► rotate: revoke old jti, issue new
POST /auth/forgot-password       ──► one-time token (15 min) → email
POST /auth/reset-password        ──► burn jti, HIBP check, history check, revoke all
```

`authenticatedFetch` in `js/auth.js` retries once on 401 behind a single-flight
refresh guard: the server rotates refresh tokens, so concurrent 401s sharing one
token would sign the user out mid-session.

### 6. Contact form

`js/form.js` posts to `https://formsubmit.co/ajax/<CONTACT_EMAIL>` — the only
third-party endpoint the page actually calls. It carries a honeypot field, a
10-second timeout, an offline guard, and falls back to a native form POST if the
AJAX path is unavailable. No backend involvement.

---

## Cross-cutting conventions

**Vanilla first.** No frontend framework, no CSS framework, no preprocessor.
New dependencies need a real justification; two are vendored (DOMPurify, marked)
and both have a degradation path.

**Nothing third-party in the critical path.** Fonts are self-hosted and subset;
libraries are vendored. The CSP's `script-src` is `'self'` plus two pinned inline
hashes, and `style-src`/`font-src` are `'self'`.

**Output builders over `innerHTML`.** The terminal writes user-controlled
strings through `textContent` (`js/terminal/output.js`), so escaping is
structural rather than remembered at each interpolation. Where HTML strings are
unavoidable, `escapeHTML()` escapes all five significant characters — including
both quote forms, because six call sites interpolate into double-quoted
attributes.

**Motion is opt-out-aware.** Every animated surface checks
`prefers-reduced-motion` and tears itself down when the preference changes
mid-session.

**Configuration fails fast.** `settings.py` raises at import for a missing
`DATABASE_URL`, `AWS_REGION`, `DEFAULT_MODEL_ID`, or a weak/placeholder
`JWT_SECRET`. There are no fallback values.

**Migrations are the schema.** Models use SQLAlchemy ORM with async sessions;
every change ships with an Alembic revision. CI runs `alembic check` against a
real PostgreSQL, so a model changed without a migration cannot reach the deploy.

**Lock files are generated.** `server/requirements*.txt` are `uv pip compile`
output installed with `--require-hashes`. Edit the `.in` files.

---

## Known constraints

| Constraint | Consequence | Mitigation |
| :--- | :--- | :--- |
| In-memory rate limiting | Budgets are per process | Use Redis-backed limiting before running multiple instances |
| In-memory SSE registry | An event ingested by worker A never reaches a listener on worker B | `ENABLE_PG_FANOUT=true` relays broadcasts over Postgres `LISTEN/NOTIFY` |
| In-memory write buffer | Events awaiting a flush are lost if the process dies | Capped at `MAX_BUFFERED_EVENTS`; drops are counted and surfaced by `/system/pipeline` |
| `POST /sessions` is unauthenticated | Session tokens are free to obtain | `MAX_STREAMS_PER_SESSION` caps open streams; chat has its own rate budget and free-message cap |
| Bedrock concurrency is per process | `CHAT_MAX_CONCURRENCY` is not a cluster-wide budget | Acceptable at current scale; revisit with more than one instance |
| `alembic downgrade` is never run by the deploy | A rollback restores code but not schema | Migrations must stay backward-compatible with the previous release (expand now, contract later) |
