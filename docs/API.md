# API Reference

FastAPI service `rjWebApp API`, version 2.0.0 (`server/main.py`).

- **Production base**: `https://rjasti.com/api`
- **Local base**: `http://localhost:8000`
- **Interactive docs**: `<base>/docs` · **Schema**: `<base>/openapi.json`

Every router is mounted **twice** — at `/api/...` and at `/...` — because
whether the reverse proxy strips the `/api` prefix decides which copy serves
production. The root copy is excluded from the OpenAPI schema, so each endpoint
is documented once while both continue to route.

- [Authentication models](#authentication-models)
- [Rate limits](#rate-limits)
- [Common headers](#common-headers)
- [System endpoints](#system-endpoints)
- [Auth endpoints](#auth-endpoints)
- [Analytics session endpoints](#analytics-session-endpoints)
- [Event endpoints](#event-endpoints)
- [Live activity stream (SSE)](#live-activity-stream-sse)
- [Chat endpoints](#chat-endpoints)
- [Error shapes](#error-shapes)
- [Endpoint / caller matrix](#endpoint--caller-matrix)

---

## Authentication models

The API uses **two independent** credential systems. They do not overlap and
neither substitutes for the other.

### 1. JWT bearer tokens — user accounts

`Authorization: Bearer <access_token>`, HS256, signed with `JWT_SECRET`.

| Token type | `type` claim | Lifetime | Carries `jti` | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| Access | `access` | 30 minutes | no | Authenticates account-scoped calls |
| Refresh | `refresh` | 30 days | yes (in `refresh_tokens`) | Exchanged for a new pair; rotated and revoked on use |
| 2FA pre-auth | `2fa_pre_auth` | 5 minutes | yes (in `one_time_tokens`) | Half-authenticated state between password and TOTP |
| Password reset | `password_reset` | 15 minutes | yes (in `one_time_tokens`) | Emailed reset link |
| Magic link | `magic_link` | 10 minutes | yes (in `one_time_tokens`) | Emailed passwordless sign-in |

Single-use tokens are validated **and** burned against `one_time_tokens`, with a
`purpose` check, so a token minted for one flow cannot be redeemed in another.

### 2. Session capability tokens — anonymous analytics

Activity endpoints track visitors who are not signed in, so they cannot require
a login. `POST /sessions` issues an HMAC-SHA256 capability token over the
session id (`hmac(JWT_SECRET, "analytics-session:{session_id}")`), returned in
the response body **and** set as a cookie:

```
Set-Cookie: rj_session_token=<hex>; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400
```

Present it on every session-scoped call, in this precedence order:

1. `X-Session-Token: <token>` — preferred for `fetch`
2. `rj_session_token` cookie — automatic, and the only option for `EventSource`
3. `?session_token=<token>` — **deprecated**, still accepted for clients cached
   from before the cookie existed; nothing issues one any more

A missing or wrong token returns **403 with an identical body whether or not the
session exists**, so the endpoint cannot be used to discover valid session ids.

---

## Rate limits

Sliding windows keyed by client IP (`server/middlewares/rate_limit.py`). The
path is normalised first, so `/api/auth/login` and `/auth/login` share a budget.
Client IP honours `X-Forwarded-For` only when the direct peer is in
`TRUSTED_PROXY_IPS`, which defaults to loopback — with it empty every proxied
request resolves to the proxy and each budget below becomes one shared bucket
for the whole site rather than one per client.

| Budget | Paths | Limit | Configurable |
| :--- | :--- | :--- | :--- |
| Chat | `/chat`, `/chat/`, `/chat/stream`, `/chat/summarize` | `CHAT_RATE_LIMIT_PER_MINUTE` (default **12/min**) | yes |
| Auth | `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/2fa/verify`, `/auth/magic-link/request`, `/auth/resend-verification`, `/auth/verify-email` | **5/min** | no (hardcoded) |
| Contact | `/contact`, `/contact/` | `CONTACT_RATE_LIMIT_PER_HOUR` (default **5/hour**) | yes |
| General | everything else | `RATE_LIMIT_PER_MINUTE` (default **1000/min**) | yes |

The general budget is deliberately loose — it covers the analytics session,
event and dashboard routes, which are cheap session-scoped database calls — and
raising it does **not** touch the three above it. Those bound Bedrock spend,
credential guessing and outbound mail respectively.

All limiting is skipped when `TESTING=true`. Additional ceilings:

- Request bodies above `MAX_BODY_BYTES` (default 1 MiB) → **413**
- Concurrent Bedrock streams above `CHAT_MAX_CONCURRENCY` (default 4) → **429**
- Concurrent SSE streams per session above `MAX_STREAMS_PER_SESSION` (default 2) → **429**

---

## Common headers

| Header | Direction | Meaning |
| :--- | :--- | :--- |
| `X-Request-ID` | response | UUID assigned by the outermost middleware; appears in every structured log line for that request |
| `Server-Timing: app;dur=<ms>` | response | Handler wall time only, excluding the middleware above it. Explicitly CORS-exposed |
| `X-Session-Token` | request | Analytics session capability token |
| `X-Session-ID` | request | Optional on `/chat/stream` and `/chat/summarize`; honoured only with that session's token (`X-Session-Token` or the cookie). Attributes LLM telemetry to the session and tags the Bedrock invocation log |
| `Last-Event-ID` | request | Sent automatically by `EventSource` on reconnect; drives SSE replay |

CORS: `settings.origins` (from `CORS_ORIGINS`, plus a localhost dev list when
unset) with `https://rjasti.com` and `https://www.rjasti.com` always appended.
Credentials allowed; all methods and headers allowed; `Server-Timing` and
`X-Request-ID` exposed.

---

## System endpoints

### `GET /health`

Liveness plus a real database round trip (`SELECT 1`). The deploy gates on this.

**200**
```json
{ "status": "ok", "db": "connected" }
```

**503**
```json
{ "status": "error", "detail": "Database unavailable" }
```

---

### `GET /system/pipeline`

Per-stage health of the activity ingest pipeline, read from in-process counters
— no database round trip, safe to poll. Clients holding an SSE connection get
the same payload pushed on the `pipeline` channel and need not call this.

**Top-level fields**

| Field | Values |
| :--- | :--- |
| `mode` | `kafka` (a broker is attached) · `simulator` (mock generator running) · `simulated` (no broker; figures modelled — default) · `bypass` (no broker, modelling disabled) |
| `fanout` | `postgres` when cross-instance `LISTEN/NOTIFY` relay is active, else `local` |
| `generated_at` | ISO-8601 UTC |
| `stages` | `ingress`, `kafka`, `fastapi`, `postgres` |

**Stage fields**

| Stage | Fields |
| :--- | :--- |
| `ingress` | `health`, `events`, `last_event_at`, `flush_reasons` |
| `kafka` | `health`, `mode`, `simulated`, `messages`, `lag`, `topic`; in `simulated` mode also `throughput`, `consumer_group`, `partitions[]` |
| `fastapi` | `health`, `listeners`, `queued_frames`, `dropped_frames` |
| `postgres` | `health`, `rows_written`, `buffer_depth`, `flushes`, `flush_failures`, `last_flush_ms`, `last_error`, `dropped_overflow`, `dropped_rejected` |

In `simulated` mode the numbers are **derived from real throughput**, not
invented: `messages` is the true count of events processed, partition offsets
sum to it, `throughput` is the observed rolling-minute rate, and `lag` rises
with arrivals then drains geometrically against wall time (so poll rate does not
move it). The stage always carries a `simulated` boolean so a consumer can tell
modelled figures from broker-reported ones.

---

### `GET /models`

Bedrock foundation models available in `AWS_REGION`.

**200**
```json
{ "models": [ { "modelId": "...", "modelName": "...", "provider": "...",
                "inputModalities": ["TEXT"], "outputModalities": ["TEXT"] } ] }
```

**500** — `{"detail": "Unable to list models"}` if the Bedrock control-plane call fails.

---

## Auth endpoints

All under `/auth`. Bodies are JSON. `🔒` marks endpoints requiring a bearer
access token.

| Method | Path | Auth | Purpose |
| :--- | :--- | :--- | :--- |
| POST | `/auth/register` | — | Create an account |
| POST | `/auth/login` | — | Password sign-in; may return a 2FA challenge |
| POST | `/auth/refresh` | refresh token in body | Rotate the token pair |
| GET | `/auth/me` | 🔒 | Current user |
| POST | `/auth/logout` | refresh token in body (🔒 fallback) | End this device's session |
| POST | `/auth/2fa/setup` | 🔒 | Generate a TOTP secret + QR code |
| POST | `/auth/2fa/enable` | 🔒 | Confirm a code and enable TOTP (password **and** code required) |
| POST | `/auth/2fa/disable` | 🔒 | Disable TOTP (password **and** code required) |
| POST | `/auth/2fa/verify` | pre-auth token in body | Complete a 2FA sign-in |
| POST | `/auth/magic-link/request` | — | Email a passwordless sign-in link |
| POST | `/auth/magic-link/verify` | token in body | Redeem a magic link; also confirms the address |
| POST | `/auth/change-password` | 🔒 | Change password |
| POST | `/auth/forgot-password` | — | Email a reset link |
| POST | `/auth/reset-password` | token in body | Complete a reset |
| DELETE | `/auth/account` | 🔒 | Soft-delete the account |
| POST | `/auth/delete-account` | 🔒 | Same handler; the path the frontend uses |
| GET | `/auth/sessions` | 🔒 | List the caller's active sessions |
| POST | `/auth/sessions/revoke-others` | 🔒 | End every session except the named one |
| DELETE | `/auth/sessions/{session_id}` | 🔒 | End one named session |

### `POST /auth/register` → 201

```json
{ "email": "you@example.com", "password": "at least 8 chars", "username": "optional, 3-50" }
```
Returns a `UserResponse` (`id`, `email`, `username`, `created_at`, `is_active`,
`is_totp_enabled`). Email is normalised to lowercase. **400** — `"Email already
registered"`. An account soft-deleted more than 30 days ago is purged and the
address freed.

Registering does **not** sign the caller in, and returns no tokens. The account
is created with `email_verified_at` NULL, and `POST /auth/login` answers **403**
until the mailed link is redeemed — so a client must not chase a 201 here with a
login. `auth.js` did, and painted the resulting 403 as a registration failure.

> Registration does **not** run the Have I Been Pwned check. That check applies
> to `/auth/change-password` and `/auth/reset-password`.

### `POST /auth/login` → 200 `TokenResponseOr2FA`

> Returns **403** when the address has not been confirmed — which redeeming a
> magic link or completing a password reset also clears, since both prove
> control of the same inbox. The check sits
> *after* the password comparison deliberately: answering 403 to a wrong
> password would make the status code an account-enumeration oracle, whereas
> here it reveals nothing a successful login would not have. Accounts created
> before verification shipped are backfilled as verified by migration
> `j3e4f5a6b7c8`.

```json
{ "email": "you@example.com", "password": "…" }
```

Without 2FA:
```json
{ "requires_2fa": false, "access_token": "…", "refresh_token": "…", "token_type": "bearer" }
```
With 2FA:
```json
{ "requires_2fa": true, "pre_auth_token": "…" }
```

- **401** `"Incorrect email or password"` — wrong credentials *or* unknown
  address. The unknown-address path deliberately spends one bcrypt verification
  so response time is not an account-existence oracle.
- **400** — account locked (5 failed attempts → 15-minute lock), or inactive.
- A legacy password hash (bcrypt over the raw password) is transparently
  upgraded to the current scheme on a successful login.
- Lockout counters are **not** cleared when 2FA is pending — only
  `/auth/2fa/verify` clears them, so failed second factors accumulate.

### `POST /auth/refresh` → 200 `Token`

`{"refresh_token": "…"}`. Rotates: the presented `jti` is revoked and a new pair
issued. **401** if revoked, expired, unknown, or the user is inactive. Because
rotation is destructive, clients must serialise concurrent refreshes —
`js/auth.js` does this with a single-flight guard inside a tab and a Web Lock
(`rj-auth-refresh`) across tabs, which share the stored pair. A tab that finds
the pair already rotated when it gets the lock retries with the new access
token rather than spending the refresh token again.

### `POST /auth/logout` → 200

`{"refresh_token": "…"}`, optional. Ends **this device's** session: the one
`refresh_tokens` row the token names, scoped to its own `sub`. The refresh token
is the credential here, as on `/auth/refresh`, so an expired access token does
not stop a sign-out — requiring one did, and left the 30-day refresh token live
behind a UI that said "Signed out." Its signature and `type` are checked; its
expiry is not, since revoking a dead token is harmless.

With no body, a valid bearer is used instead: its `sid` claim names the session,
and a token minted before that claim ends every session, as this route always
used to. **401** when neither names a session (no body and no valid bearer, or a
body whose token fails verification). The 200 body is the same whether or not a
row matched. Other devices, and pending reset and magic links, are left alone;
"sign out everywhere" is `/auth/sessions/revoke-others` followed by this.

### `POST /auth/2fa/setup` → 200 `Setup2FAResponse`

`{"secret": "BASE32", "qr_code": "data:image/png;base64,…"}`.
**400** if 2FA is already enabled — re-enrolling would overwrite the secret the
authenticator already holds and lock the account behind a factor nobody can
produce. Disable first. Deliberately *not* on the strict auth budget: it guesses
nothing, and that budget is shared across every path on it, so spending it here
would starve the `/2fa/enable` call moments later.

### `POST /auth/2fa/enable` → 200

`{"current_password": "…", "code": "123456"}`. Confirms the secret handed out by
`/2fa/setup` and turns the second factor on. **Both** credentials are required:
without the password an access token alone could bind an attacker's
authenticator to an account that had none, locking the owner out rather than
merely reading their data. **400** on a wrong password, on a wrong code, or when
no setup was initiated; either wrong credential increments the lockout
counter, 5 → 15-minute lock. On success every *other* session is revoked and the
account owner is emailed. On the strict 5/min auth budget.

### `POST /auth/2fa/disable` → 200

`{"current_password": "…", "code": "123456"}`. Clears `totp_secret` and
`is_totp_enabled`, so the authenticator entry stops working and `/2fa/setup`
becomes available again — this is the only supported way to move to a new
authenticator. Same credential rules, lockout behaviour, session revocation,
notification and rate budget as `/2fa/enable`. **400** with "2FA is not enabled"
when it is already off; that state error does *not* count toward the lockout,
since it refuses every caller equally.

### `POST /auth/2fa/verify` → 200 `TokenResponseOr2FA`

`{"pre_auth_token": "…", "code": "123456"}`. The pre-auth `jti` is burned on
use — **before** the code is checked, so a failed attempt spends the token and
the client must start the sign-in over rather than retry on the same challenge.
Failed codes increment the lockout counter; 5 → 15-minute lock.
**400** — `"This sign-in attempt has expired. Please log in again."` on replay.

### `POST /auth/verify-email` → 200

Confirms the address a registration was made with. Takes no credential: the
token in the mailed link **is** the credential — single-use through
`one_time_tokens` and purpose-checked (`email_verify`), so a reset or
magic-link token cannot be spent here. Valid for 24 hours.

```json
{ "token": "<jwt from the emailed link>" }
```

A second visit to an already-confirmed address returns **200**, not an error:
mail clients prefetch links and people click twice, and the address is
confirmed either way. An invalid, expired or wrong-purpose token is **400**.

### `POST /auth/resend-verification` → 200

Issues a fresh link. Answers **identically** for an unknown address, an
already-verified one and a genuine resend — the same generic response
`POST /auth/forgot-password` gives, for the same reason: the endpoint takes no
credential, so distinguishing the cases would let anyone enumerate addresses.

### `POST /auth/magic-link/request` · `POST /auth/forgot-password` → 200

Both answer with a generic message regardless of whether the address exists or
is active, so neither can be used to enumerate accounts. Email delivery is a
background task and its failure is never surfaced to the caller.

### `POST /auth/reset-password` → 200

`{"token": "…", "new_password": "…"}`. In order: verify and burn the one-time
token → HIBP breach check → reuse check against the current hash plus the last
5 in `password_history` → archive the old hash → set the new one → clear lockout
→ **confirm the address if it was still unverified** → revoke all refresh
tokens, end sessions and void pending one-time tokens → email a security
notification.

The confirmation step is there because the link was mailed to that address and
has just been redeemed, which is the same proof clicking the verification link
gives. Without it a reset could report success and still leave the caller unable
to log in, which reads as the new password not having taken.

### `POST /auth/change-password` → 200

`{"current_password": "…", "new_password": "…"}`. Same pipeline as above, with
the current password verified first instead of a token. **400**
`"Incorrect current password"` when it does not match.

A wrong current password is a **400** on all four routes that re-check one
(this, delete-account and 2FA enable/disable), never a 401. `authenticatedFetch`
reads every 401 as an expired bearer, rotates the refresh token and re-sends the
same body, so a 401 here spent a rotation per typo and, on the 2FA routes,
counted each typo twice toward the lockout. 403 would be worse: the client
treats it as a refused credential and signs the visitor out.

### `DELETE /auth/account` · `POST /auth/delete-account` → 200

`{"current_password": "…", "confirmation_phrase": "DELETE"}` (case-insensitive,
trimmed). Soft delete: `deleted_at` set, `is_active` cleared, all tokens
revoked. Signing in within 30 days automatically reactivates the account.
**400** on a wrong current password or confirmation phrase.

### `GET /auth/sessions` → 200 `[UserSessionResponse]`

The caller's live sessions — one per unrevoked, unexpired `refresh_tokens` row,
newest first. `session_id` is the row id, not the `jti`, which is a credential.
`is_current` marks the session the request was made from, resolved from the
`sid` claim in the caller's access token.

These read `refresh_tokens`, not `user_sessions`. The latter is written only by
the anonymous `POST /sessions` and never carries a `user_id`, so the list was
permanently empty and revoking from it ended nothing — one `refresh_tokens` row
*is* one live login, so revoking one signs that device out as soon as its access
token expires (≤30 min).

### `POST /auth/sessions/revoke-others` → 200

No body. Ends every session but the caller's own, identified by the `sid` claim
in their access token — it used to be an optional `current_session_id` body
parameter the client had no way to fill in, so the call signed the caller out
too. An access token minted before that claim shipped resolves to no session and
ends everything, which stays the safe reading. Declared before
`DELETE /auth/sessions/{session_id}` so the literal path segment is not captured
as a UUID.

### `DELETE /auth/sessions/{session_id}` → 200

Revokes one of the caller's sessions. **404** when the id is unknown, already
revoked, or belongs to another account — it used to report success for all
three.

---

## Analytics session endpoints

### `POST /sessions` → 201

```json
{ "user_agent": "Mozilla/5.0…", "device_type": "desktop" }
```
`device_type` ∈ `desktop` · `mobile` · `tablet` · `unknown` (optional).
`user_agent` is capped at 2048 characters by the schema and truncated to 512
before storage.

```json
{ "session_id": "550e8400-…", "session_token": "9f2c…e41a", "started_at": "2026-01-15T10:30:00Z" }
```

Also sets the `rj_session_token` cookie. Client IP is resolved server-side
(`X-Forwarded-For` honoured only from a trusted proxy) — it is never accepted
from the body. **The token is issued exactly once, here.** Store it with the id.

### `PATCH /sessions/{session_id}/heartbeat` → 200

Requires the session token. Bumps `last_active_at`, re-marks the session active
and clears `ended_at`/`end_reason`. Call roughly every 60s.
`{"status": "ok", "last_active_at": "…"}`. **404** if the session does not exist.

### `PATCH /sessions/{session_id}/end` → 200

Requires the session token. Body: `{"end_reason": "tab_closed_or_hidden"}` —
one of `logout`, `timeout`, `closed`, `tab_closed_or_hidden`, `unknown`.
`{"status": "ended", "ended_at": "…"}`.

### `GET /sessions/{session_id}` → 200

Requires the session token. Returns `session_id`, `started_at`, `ended_at`,
`is_active`, `device_type`, `user_agent`, `last_active_at`, `end_reason`.

---

## Event endpoints

### Event vocabulary

Declared in `server/schemas/event.py` as `EVENT_TYPES`:

| Type | Emitted by |
| :--- | :--- |
| `page_view` | `analytics.js` on session start, reload and `hashchange` |
| `click` | delegated handler on `a`, `button`, `[data-track]` |
| `scroll_depth` | 25 / 50 / 75 / 90 / 100 % thresholds, once each |
| `terminal_command` | `js/terminal/index.js` |
| `theme_change` | `js/theme.js` |
| `copy_email` | `js/form.js` |
| `contact_submission` | `js/form.js` |
| `contact_prompt` | `js/form.js` when a prompt chip is used |
| `ai_llm_telemetry` | written **server-side** by `chat_routes` after a stream completes |
| `client_error` | `js/error-handler.js` — uncaught errors and unhandled rejections |

`event_data` must serialise to ≤ 4096 bytes; `page_path` ≤ 256 characters.

### `POST /events` → 201

Requires the session token for `payload.session_id`.

```json
{ "session_id": "…", "event_type": "click", "page_path": "/#about",
  "event_data": { "element_id": "cta" } }
```
→ `{"event_id": 10432, "created_at": "…"}`. Broadcasts to live SSE listeners.
**404** if the session row does not exist. **422** for an undeclared
`event_type` — this endpoint types it as a strict `Literal`.

### `POST /events/bulk` → 201 `BulkEventResult`

```json
{ "events": [ … 1-500 items … ], "client_ts": 1756570000123, "flush_reason": "timer" }
```

- `client_ts` — client clock at flush time. **Diagnostic only**, never trusted
  for ordering.
- `flush_reason` ∈ `threshold` · `timer` · `unload` · `hidden` · `manual`.
  Tallied per reason and reported by `GET /system/pipeline`; a high `unload`
  share means the timed flush is not keeping up and data is riding the
  unreliable path.

```json
{ "inserted": 9, "rejected": [ { "index": 4, "event_type": "wat", "reason": "unknown event_type" } ] }
```

**Partial acceptance is deliberate.** `BulkEventItem` types `event_type` as a
plain string so an unrecognised value costs *that one event* rather than
returning 422 for the whole request — a client running ahead of a server deploy
would otherwise lose every valid event flushed alongside it, and `analytics.js`
only re-queues on 5xx/429.

Everything structural stays strict: **400** for an empty list or more than 500
items, **403** if any row names a session the caller does not hold the token for
(one batch, one session — an authorisation boundary, not schema drift),
**422** for structurally invalid rows or a failed insert.

### `GET /sessions/{session_id}/events` → 200

Requires the session token.

| Query | Default | Range |
| :--- | :--- | :--- |
| `limit` | 100 | 1–500 |
| `offset` | 0 | 0–1,000,000 |
| `event_type` | — | must be a declared type, else **422** |

Ordered by `created_at DESC, event_id DESC` — the tiebreak matters because bulk
inserts share a `created_at`, and without it the same row can appear on two
pages. The composite index `ix_events_session_created` mirrors this ordering
exactly, so pagination is an index scan.

Returns an array of `{event_id, event_type, page_path, event_data, created_at}`.

### `GET /sessions/{session_id}/events/summary` → 200 `SessionEventSummary`

Requires the session token. Two indexed round trips: one `GROUP BY` for
per-type counts, one scalar row for the session-wide span.

```json
{ "session_id": "…", "total_events": 128, "distinct_paths": 6,
  "first_event_at": "…", "last_event_at": "…",
  "by_type": [ { "event_type": "page_view", "count": 12, "last_at": "…" } ] }
```

Every declared type is **zero-filled** so the client tile grid does not reflow
as counts land; legacy or since-removed types already in the table are appended
after the known ones.

### `GET /sessions/{session_id}/events/funnel` → 200

Requires the session token. `limit` (1–25, default 8) caps the returned paths.

Computed in a single window-function pass (`LEAD` over `created_at, event_id`),
which is what makes the transition edges computable without pulling the whole
event set into the application.

```json
{ "session_id": "…", "total_hits": 91,
  "steps": [ { "path": "/#about", "hits": 40, "first_at": "…", "last_at": "…", "share": 0.4396 } ],
  "transitions": [ { "from": "/#about", "to": "/#ai", "weight": 7 } ] }
```

---

## Live activity stream (SSE)

### `GET /sessions/{session_id}/stream`

`text/event-stream`. Requires the session token — cookie for `EventSource`, or
the header/deprecated query parameter. Three named channels share one
connection:

| Channel | Payload |
| :--- | :--- |
| `hello` | Bootstrap: `server_time`, `resumed_from`, `pipeline` snapshot |
| `activity` | One event in compact form, carrying an `id:` for resume |
| `pipeline` | Per-stage health snapshot, every 2s |

The compact activity frame drops `session_id` (implicit in the stream) and sends
epoch millis rather than an ISO string:

```
id: 10432
event: activity
data: {"i":10432,"t":1756570000123,"e":"click","p":"/#activity","d":{"element_id":"cta"}}
```

Field map: `i` = `event_id`, `t` = epoch ms, `e` = `event_type`,
`p` = `page_path`, `d` = `event_data`.

- **Reconnect** — `retry: 3000` is advertised on connect. The browser sends
  `Last-Event-ID` automatically and the server replays the gap from a
  per-session ring buffer (`SSE_REPLAY_BUFFER` entries, retained for
  `SSE_REPLAY_TTL` seconds after disconnect).
- **Keep-alive** — a `: keep-alive` comment after `SSE_KEEPALIVE_SECONDS` (15s)
  of genuine silence.
- **Backpressure** — each listener queue is bounded by `SSE_QUEUE_MAXSIZE`; at
  the cap the **oldest** frame is dropped and `frames_dropped` increments.
- **429** — the session already holds `MAX_STREAMS_PER_SESSION` open streams.
  429 rather than 403: the caller is authorised, just over its allowance, and
  `EventSource` will retry on its own backoff.

> Historical note: an unnamed `data:` frame carrying the verbose shape was once
> emitted alongside each `activity` frame for clients using
> `EventSource.onmessage`. It has been removed — the only client subscribes to
> the named channels.

---

## Chat endpoints

### `POST /chat` · `POST /chat/` · `POST /chat/stream`

Three paths, one handler. Streams a Bedrock completion as SSE. Authentication is
**optional**; a bearer token lifts the free-message cap and enables transcript
persistence.

**Request** (`ChatStreamRequest`)

```json
{ "messages": [ { "role": "user", "content": "…" } ],
  "conversation_id": "optional-uuid-string",
  "model_id": "optional-allowlisted-model",
  "stream": true }
```

| Constraint | Value | Source |
| :--- | :--- | :--- |
| Messages per request | 1–60 | `MAX_MESSAGES` |
| Characters per message | ≤ 8,000 | `MAX_MESSAGE_CHARS` |
| Total characters | ≤ 24,000 | `MAX_TOTAL_CONTENT_CHARS` |
| `role` | `user` or `assistant` only | `Literal` |
| Anonymous user-role messages | ≤ `CHAT_FREE_MESSAGE_LIMIT` (6) | server-enforced |
| Concurrent streams | ≤ `CHAT_MAX_CONCURRENCY` (4) | semaphore |

`system_prompt` is **not accepted**. It was once passed straight through,
unauthenticated and unbounded, which both replaced the portfolio persona and
billed arbitrary input tokens. The server owns the persona
(`bedrock_service.DEFAULT_SYSTEM_PROMPT`).

Roles are normalised before dispatch (`ensure_alternating_roles`): empty
messages dropped, consecutive same-role turns merged with a blank line, and a
synthetic `[conversation context]` user turn prepended if the conversation
starts with an assistant message.

**Response** — `text/event-stream` with `Cache-Control: no-cache`,
`X-Accel-Buffering: no`:

```
data: {"text": "Hello"}
data: {"text": " there"}
data: {"type":"metrics","metrics":{"model_id":"…","input_tokens":812,"output_tokens":140,
       "cache_read_tokens":768,"cache_creation_tokens":0,"cache_hit":true,"latency_ms":1834.2}}
```
An in-band `data: {"error": "…"}` frame carries a Bedrock failure; the HTTP
status is still 200 because the stream has already begun.

**Errors** — **400** unsupported model (not in `ALLOWED_MODEL_IDS`), **401**
anonymous free-message limit reached (`WWW-Authenticate: Bearer`), **422**
schema violation, **429** over the chat rate budget or all concurrency slots
busy.

**Side effects**
- If `X-Session-ID` names a session and the caller holds its token, an
  `ai_llm_telemetry` activity event records the metrics.
- If the caller is signed in and produced text, the transcript is zlib-compressed
  and upserted into `ai_conversations`.

**Model routing** — models whose id starts with `anthropic.`, `us.anthropic.` or
`eu.anthropic.` use `invoke_model_with_response_stream` (the API that supports
ephemeral prompt caching for the system prompt); everything else uses
`converse_stream`. `max_tokens` 2048, `temperature` 0.7. A verified session id
goes to Bedrock as `requestMetadata: {"session_id": …}`, which only labels the
call in the account's model invocation logs.

### `POST /chat/summarize` → 200

Same request schema. Takes a concurrency slot exactly like the streaming route.

```json
{ "summary": "…" }
```
Falls back to `"Summary of preceding conversation."` if the model returns
nothing. `chat.js` calls this once its own token estimate crosses
`SUMMARIZE_TOKEN_THRESHOLD` (~6000).

### `GET /chat/history` 🔒 → 200

`limit` (1–100, default 50). Summaries only — the compressed payload is never
sent:

```json
{ "conversations": [ { "id": "…", "title": "…", "model_id": "…",
                       "message_count": 12, "created_at": "…", "updated_at": "…" } ] }
```

### `GET /chat/history/{conversation_id}` 🔒 → 200

Full transcript, decompressed. **404** if it does not exist *or* belongs to
another user — ownership is part of the `WHERE` clause, so the two are
indistinguishable.

### `DELETE /chat/history/{conversation_id}` 🔒 → 200

`{"detail": "Conversation deleted successfully"}`. **404** as above.

### `DELETE /chat/history` 🔒 → 200

`{"deleted": 7}` — every conversation the caller owns, in one statement.
Idempotent: an already-empty account returns `{"deleted": 0}` rather than a
404. Backs the rail's **Delete all**, which used to clear only `localStorage`
and left the server copies for the next `syncServerHistory()` to list straight
back. A client-side loop cannot replace it — `GET /chat/history` is capped at
100 rows and the rail truncates at `MAX_SESSIONS`, so older conversations are
not reachable from the browser to delete one by one.

---

## Owner analytics 🔒

Aggregate reads across **every** session, gated by `require_owner`
(`server/auth/dependencies.py`): `get_current_user`, then the caller's email
must equal `OWNER_EMAIL`. Unset denies everyone — a misconfigured deploy that
silently published every visitor's browsing to any registered account is a
worse failure than one that locks the owner out.

Every route takes `days` (1–365, default 30). The ceiling is deliberate: these
are unindexed aggregates over a growing table, and an unbounded range is the
query that eventually times out.

| Route | Returns |
| :--- | :--- |
| `GET /admin/analytics/overview` | Session and distinct-IP counts, device split, event mix, a daily event series |
| `GET /admin/analytics/funnel` | Cross-session path funnel and transition edges (`limit` 1–25, default 10) |
| `GET /admin/analytics/commands` | `terminal_command` counts by name, with recognised vs. mistyped (`limit` 1–100, default 25) |
| `GET /admin/analytics/llm` | Bedrock tokens, cache-hit rate, mean latency, and a per-model breakdown |

`distinct_ips` is a **floor on people, not a count of them**: an office NATs to
one address and a phone roams across several.

The funnel's `LEAD` is partitioned by `session_id`. Without the partition the
last event of one session pairs with the first of the next, inventing a
transition nobody made; the per-session version in `event_controller` needs no
partition because its `WHERE` already guarantees one session.

`GET /admin/analytics/llm` is the first reader `ai_llm_telemetry` has ever had.
`chat_routes` has written those rows after every completed stream since the
telemetry landed, and the chat UI reports per-conversation totals from its own
metrics frames, so the monthly figure existed only in the table.

---

## Contact endpoint

### `POST /contact` · `POST /contact/` → 200

Delivers one contact-form message to `CONTACT_EMAIL`. Anonymous by necessity —
a stranger reaching out is the point — so the guards are the schema's length
bounds, the honeypot, and an **hourly** per-IP budget
(`CONTACT_RATE_LIMIT_PER_HOUR`, default 5), not a login.

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "message": "I would like to talk about a role.",
  "_honey": ""
}
```

| Field | Bound |
| :--- | :--- |
| `name` | 1–100 chars, no CR/LF (it is interpolated into the `Subject`) |
| `email` | `EmailStr` |
| `message` | 1–5,000 chars |
| `_honey` | ≤ 150 chars; **any value at all** means nothing is sent |

A filled honeypot returns the **same 200 and the same body** as a success. A
bot that is told which field gave it away only learns to leave that field
alone.

| Status | Meaning |
| :--- | :--- |
| `200` | Delivered — or silently dropped as a honeypot hit |
| `422` | Failed a schema bound |
| `429` | Hourly budget spent |
| `502` | SMTP itself failed; **nothing was sent** |

`502` is load-bearing: it is the one status `form.js` treats as permission to
retry against FormSubmit, because it is the only response that proves the
message was not delivered. A timeout does not, so it is never retried.

---

## Error shapes

FastAPI's default envelope throughout:

```json
{ "detail": "Human-readable message" }
```

Validation errors carry the standard array form:

```json
{ "detail": [ { "type": "…", "loc": ["body", "messages", 0, "content"], "msg": "…" } ] }
```

| Status | Typical cause |
| :--- | :--- |
| 400 | Bad request state — already-registered email, locked account, spent token, wrong current password on a re-authenticated route, empty or oversized bulk list, unsupported model |
| 401 | Missing/invalid/expired bearer token, wrong credentials, anonymous free-message limit |
| 403 | Missing or wrong analytics session token (identical body whether or not the session exists) |
| 404 | Unknown session, user, or conversation |
| 413 | Body above `MAX_BODY_BYTES` |
| 422 | Pydantic validation failure, unknown `event_type` on the single-event route, failed bulk insert |
| 429 | Rate budget exceeded, Bedrock slots saturated, or too many SSE streams for the session |
| 500 | Unhandled server error (e.g. Bedrock control-plane failure on `/models`) |
| 503 | `/health` only — database unreachable |

---

## Endpoint / caller matrix

Which endpoints the deployed frontend actually calls.
`tests/backend/integration/test_frontend_api_contract.py` asserts that every
endpoint in the left column exists on the backend.

| Endpoint | Called by |
| :--- | :--- |
| `GET /health` | `analytics.js` (localhost fallback probe) |
| `POST /sessions` · `PATCH …/heartbeat` · `PATCH …/end` | `analytics.js` |
| `POST /events/bulk` | `analytics.js` |
| `GET /sessions/{id}/events` · `…/summary` · `…/funnel` · `…/stream` | `activity.js` |
| `POST /chat/stream` · `POST /chat/summarize` | `chat.js` |
| All 21 `/auth/*` routes | `auth.js` / `auth-ui.js` |
| `POST /contact` | `form.js` — tried first; FormSubmit is reached only when this is unreachable or answers 502 |
| `GET /admin/analytics/*` | `owner-analytics.js` — lazily imported by `activity.js`; a 401/403 leaves the section as a visitor sees it |
| `POST /events` (single) | — server/API consumers only |
| `GET /models` · `GET /system/pipeline` | — the dashboard reads pipeline health from the SSE `pipeline` channel instead |
| `GET/DELETE /chat/history*` | `chat.js` — `syncServerHistory()` lists on load and on `auth-changed`, `hydrateSession()` fetches one transcript when its rail row is opened, `deleteRemoteConversation()` removes one server copy and `deleteAllRemoteConversations()` empties the account behind **Delete all** |
