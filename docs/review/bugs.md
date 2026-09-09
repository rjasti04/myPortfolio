# Correctness Review

Read-only pass over `rjWebApp` hunting for correctness defects: swallowed
exceptions, race conditions, boundary and off-by-one cases, null paths,
non-idempotent retries, transaction scope, and silent type coercion. Style is
out of scope, and nothing here is a "you could also" — every entry names an
input that produces a wrong result.

**No P0.** Nothing found takes the site down or destroys data on the default
deployment path. Much of what a first pass would flag is already closed, with
the reasoning left in comments: the contact form's header injection
(`schemas/contact.py:34`), the SSE token in the query string
(`auth/session_token.py:52`), `escapeHTML` covering the attribute-quote case
(`js/utils.js:14`), the 2FA pre-auth replay window (`auth_service.py:866`), and
the lockout that could never expire (`auth_service.py:61`). What follows is what
survived that.

## Scope

| Read | Not read |
| :--- | :--- |
| All of `server/` — services, controllers, routes, middlewares, auth, models, schemas, config, utils | `frontend/three-bg.js` (2D-canvas background, no state crossing a boundary) |
| `js/analytics.js`, `js/auth.js`, `sw.js`, `js/form.js`, `js/utils.js`, `js/error-handler.js`, `js/terminal/math.js`, `js/theme-customizer.js` (colour math) | `frontend/js/arcade/*` (self-contained games) |
| The storage, sync and SSE regions of `js/chat.js` and `js/activity.js` | `ucl.html`, `worldcup.html` (standalone, outside the SPA) |
| `js/owner-analytics.js`, `js/navigation.js`, `js/swipe-handler.js` (targeted) | CSS, and the presentation half of the large JS initialisers |

Reachability claims were checked against `tests/backend/**`,
`frontend/tests/**` and `docs/API.md`. Two findings are explicitly marked as a
guess or as latent; everything else was traced end to end.

---

## P1

### 1. Session management is inert, and one of its controls reports success while doing nothing

**`server/controllers/session_controller.py:39`**

The only `UserSession(...)` construction in the repository sets `ip_address`,
`user_agent` and `device_type`. It never sets `user_id`, which is nullable
(`models/session.py:9`). Every row in `user_sessions` therefore has a null owner.

Four things depend on that column:

- **`services/auth_service.py:998`** `get_user_sessions` filters
  `UserSession.user_id == user.id`, so `GET /auth/sessions` returns `[]` for
  every caller. `js/auth-ui.js:684` paints "No active sessions found."
  `docs/API.md:333` documents it as returning the caller's rows, newest first.
- **`services/auth_service.py:1019`** `revoke_all_other_sessions` updates zero
  rows and returns *"Logged out of all other active sessions successfully."*
  A user who suspects their account is compromised clicks "log out everywhere
  else" (`js/auth-ui.js:737`), is told it worked, and nothing is revoked — the
  function does not touch `refresh_tokens` either, so every stolen credential
  stays live for its full 30 days.
- **`services/auth_service.py:1029`** `revoke_specific_session` — same.
- **`services/auth_service.py:402`** the `UserSession` clause inside
  `revoke_user_tokens` matches nothing, so `ended_at` and `end_reason` are never
  written on password change, logout, reset or account deletion.

**Input:** any account. Register, log in, `GET /auth/sessions` → `[]`.

**Why it survived:** `tests/backend/integration/test_auth.py:265` asserts only
`isinstance(response.json(), list)`, and `:383` only that a `message` key comes
back. Both pass against a permanent no-op.

**Fix.** Decide what `user_sessions` is. It is created by `POST /sessions`,
which is deliberately anonymous (`docs/SECURITY.md`), so it will never reliably
hold a user id — which makes (b) the honest option:

- (a) Stamp it: give `create_session` a `get_optional_current_user` dependency,
  set `user_id` when a bearer token is present, and have the SPA re-create the
  analytics session after login so a signed-in visit is attributable.
- (b) Back the three auth routes with `refresh_tokens` instead. It already holds
  one row per live login with `created_at`, `expires_at` and `is_revoked`;
  revoke-others becomes `UPDATE refresh_tokens SET is_revoked = true WHERE
  user_id = :id AND token_jti != :current`. Smaller change, and the button then
  does what it says.

Either way, replace the two shape-only tests with ones that assert a session is
listed and that revoking removes it.

---

## P2

### 2. Path-funnel totals and shares are computed over the truncated top-N

**`server/controllers/event_controller.py:410`** and
**`server/routes/analytics_routes.py:169`**

`total = sum(step["hits"] for step in steps)` — but `steps` has already been
through `.limit(limit)` (default 8 per session, 10 for the owner window). The
per-step `share` at `event_controller.py:412` and `analytics_routes.py:178`
divides by that partial total.

**Input:** any session or window touching more distinct paths than the limit.
With 12 paths and `limit=8`, `total_hits` silently omits the four tails and the
shares always sum to exactly 1.0 — the dashboard reports full coverage of a set
it has cut a third out of.

**Fix.** Compute the total in the database, before the limit: either a second
scalar `select(func.count()).where(<same filters>)`, or
`func.sum(func.count()).over()` added to the grouped query. Divide by that.

### 3. The Kafka consumer exits permanently on any error, and the pipeline then reports itself healthy

**`server/services/kafka_stream.py:788`**

`except Exception: logger.exception(...)` followed by `finally: ... await
consumer.stop()`, and the coroutine returns. `server/main.py:52` schedules it
exactly once at startup; there is no supervisor.

**Input:** a broker restart, a rebalance timeout, or one message that trips the
`value_deserializer` — anything raising out of `async for msg in consumer`.
Ingest is dead until the process is restarted.

It reports green while dead. With `kafka_connected` back to `False` and
`SIMULATE_KAFKA_METRICS` defaulting true (`:43`), `pipeline_mode()` (`:458`)
answers `"simulated"`, and `_simulated_kafka_stats` synthesises plausible
throughput from `events_broadcast`. The DAG node on the dashboard shows a
healthy queue for a consumer that no longer exists.

Applies only where `KAFKA_BOOTSTRAP_SERVERS` is set; unconfigured deployments
fall through to the simulator at `:751` and are unaffected.

**Fix.** Wrap connect-and-consume in a reconnect loop with backoff, exactly as
`run_pg_fanout` (`:406`) already does — `while True:`, `await
asyncio.sleep(5)` on failure, re-raise `CancelledError`. Add a distinct
`kafka_failed` state so `pipeline_mode()` cannot answer `"simulated"` for a
broker that was configured and died.

---

## P3

### 4. The batch-write retry drops the newest events and scrambles order

**`server/services/kafka_stream.py:656`**

On a recoverable database error the failed batch goes back with
`batch_buffer.extend(events_to_save)` — appending the *older* retried events
after whatever arrived during the flush. `del batch_buffer[:overflow]` (`:659`)
then trims from the **front**, which is now the newest data. The comment at
`:653` says "the oldest events are dropped".

**Input:** Kafka configured, plus a database outage lasting longer than
`MAX_BUFFERED_EVENTS` (10,000) of traffic. Chronological order is also inverted
inside the buffer, so `created_at` ordering in the eventual write is arbitrary.

**Fix.** Put the retry back at the head where it belongs chronologically and
trim from the tail:

```python
batch_buffer[:0] = events_to_save
overflow = len(batch_buffer) - MAX_BUFFERED_EVENTS
if overflow > 0:
    del batch_buffer[MAX_BUFFERED_EVENTS:]
```

Or make `batch_buffer` a `deque(maxlen=MAX_BUFFERED_EVENTS)` and let it evict
from the left on its own.

### 5. `save_or_update_conversation` inserts on a primary key it just failed to own-check

**`server/services/chat_history_service.py:56`**

The lookup is scoped `id == conversation_id AND user_id == user_id`. A row that
exists but belongs to *another* user returns `None`, so control falls through to
`:77` and constructs `AIConversation(id=conversation_id or uuid.uuid4(), ...)` —
an INSERT onto an occupied primary key, and an `IntegrityError` at `:88`.

**Input:** a signed-in visitor whose `POST /chat` body carries a
`conversation_id` naming someone else's row. The error is swallowed by
`except Exception` at `server/routes/chat_routes.py:156` and logged, so the reply
streams normally, the rail shows the conversation, and the transcript is
**silently never saved** — gone on the next device.

**Fix.** After the scoped lookup misses, check whether the id exists at all and
raise 404 if it does (not 403 — do not confirm the id). Better: never honour a
client-supplied id on a create. Mint a fresh UUID, return it in the stream's
metrics frame, and have the client adopt the server's id.

### 6. Unescaped attacker-controlled text reaches `innerHTML` in one branch of `describeEvent`

**`frontend/js/activity.js:213`**

```js
const what = CLICK_TAGS[data.tag] || (data.tag ? `a ${String(data.tag).toLowerCase()}` : "something");
```

`what` lands in `text` (`:595`), which `eventRow` embeds raw in a template
literal (`:608`) assigned through `list.innerHTML` (`:688`). Every sibling
branch in the same function escapes — `code()` at `:174`,
`escapeHTML(data.theme)` at `:224`, the default case at `:238`. This one does
not. The lookup is also unguarded: `data.tag = "constructor"` resolves up the
prototype chain to `Object` and stringifies the native function into the row.

**Input:** `POST /events` with
`event_data: {"tag": "<img src=x onerror=alert(1)>"}`. The event is stored,
returned by `GET /sessions/{id}/events`, and executes when the Activity section
is opened.

**Scope is self-only**, which is why this is P3 rather than higher.
`assert_session_access` (`server/auth/session_token.py:69`) means you can only
write events into a session whose HMAC token you hold, and the dashboard renders
only your own session. The owner's aggregate panel does not render this field —
`js/owner-analytics.js` builds nodes with `textContent`. It is still an
unescaped sink in a file whose own header comment records fixing exactly this
class of bug.

**Fix.** `escapeHTML(String(data.tag).toLowerCase())`, and
`Object.hasOwn(CLICK_TAGS, data.tag) ? CLICK_TAGS[data.tag] : ...` — or make
`CLICK_TAGS` a `Map`.

### 7. `loadSessions` validates that storage parses, not that it is an array

**`frontend/js/chat.js:454`**

`sessions = JSON.parse(raw)` sits inside a `try` that only catches a parse
error. `JSON.parse("null")` assigns `null`, and `:459` `sessions.length` throws
`TypeError`. `JSON.parse('{"a":1}')` gives `.length === undefined`, so
`undefined === 0` is false and `:469` `sessions.some(...)` throws.

**Input:** any non-array JSON at `rj_chat_sessions` — a truncated
quota-limited write, a stale shape from an older build, an extension, a
hand-edited value. The throw escapes `initChat()` and the AI page renders with
no transcript, no rail and no error state: precisely the failure the guard at
`:443` was written to prevent, one layer up.

**Fix.**

```js
const parsed = JSON.parse(raw);
sessions = Array.isArray(parsed) ? parsed.filter(s => s && typeof s === 'object' && s.id) : [];
```

### 8. A whitespace-only message yields HTTP 200 with an error frame instead of a 400

**`server/schemas/chat.py:29`** → **`server/utils/role_utils.py:63`**

`validate_content` strips but sets no minimum, so `"   "` validates as `""`.
`ensure_alternating_roles` filters empty content (`:39`) and returns `[]`
(`:63`). `bedrock_service.stream_chat_response` then calls Bedrock with an empty
`messages` array, gets a `ValidationException`, catches it at `:299` and yields
`{"type": "error", ...}`.

**Input:** `POST /chat {"messages":[{"role":"user","content":"   "}]}` →
`200 text/event-stream` carrying one `data: {"error": ...}` frame with the raw
AWS message in it. It also spends a `CHAT_MAX_CONCURRENCY` slot and a
rate-limit token to produce that.

`/chat/summarize` is worse: its loop reads only `type == "delta"` (`:189`), so
the error frame is discarded and the route returns the fabricated
`{"summary": "Summary of preceding conversation."}` at `:192` — a made-up
success for a call that failed.

**Fix.** Reject empty content in the validator (raise when the stripped value is
empty, as `schemas/contact.py:26` already does), and add an explicit 400 in
`chat_stream_endpoint` when `ensure_alternating_roles` returns `[]`.

### 9. Three declared event types are missing from the dashboard's family map

**`frontend/js/activity.js:61`**

`EVENT_FAMILY` covers seven types. `server/schemas/event.py:7` declares ten:
`contact_prompt`, `ai_llm_telemetry` and `client_error` are absent, so
`familyOf` (`:79`) falls back to `"nav"`.

**Input:** any JS crash forwarded by `error-handler.js:184`. It renders as
**Navigation**, takes a navigation dot, and is swept up by the "Navigation"
filter chip while being unreachable from any other — the events added
specifically so production failures would be visible are filed under the one
label that hides them.

**Fix.** Add the three (`client_error` warrants its own family), or derive the
map from the server's `EVENT_TYPES` so the two cannot drift again.

### 10. The offline event queue drops the newest events on truncation

**`frontend/js/analytics.js:403`** and **`:436`**

`eventQueue.unshift(...eventsToSend)` puts the retried batch at the head, then
`eventQueue.length = MAX_QUEUE_SIZE` (`:406`, `:439`) truncates from the tail —
discarding what the visitor did most recently. The same inversion as finding 4,
on the other side of the wire.

**Input:** more than 200 events queued while the API is down. A long session
with the dashboard open reaches that in minutes at the 2s flush cadence.

**Fix.** Drop from the front instead:

```js
if (eventQueue.length > MAX_QUEUE_SIZE) {
  eventQueue.splice(0, eventQueue.length - MAX_QUEUE_SIZE);
}
```

### 11. A rate-limited contact submission is reported as a network failure

**`frontend/js/form.js:345`**

Any non-ok status other than 502 throws; `:348` re-throws rather than falling
back; the outer catch (`:388`) paints *"Could not reach the mail service. Please
try again, or email me directly."*

**Input:** a sixth submission within the hour — `CONTACT_RATE_LIMIT_PER_HOUR` is
5 (`server/config/settings.py:102`). The visitor is told the service is
unreachable and invited to retry, which cannot succeed for up to an hour, and
each retry costs another 429.

**Fix.** Branch on `response.status === 429` and say what actually happened
("You've sent several messages recently — try again later, or email me
directly"). The 422 case deserves the same.

### 12. Refresh-token rotation is not serialised *(guess — depends on the isolation level, which I did not verify against the deployed database)*

**`server/services/auth_service.py:350`**

The row is read at `:350`, marked `is_revoked = True` at `:366`, the replacement
inserted at `:378`, committed at `:379`. Under READ COMMITTED — PostgreSQL's
default — two requests in separate sessions can both read `is_revoked == False`
before either commits, and both mint a valid pair. One presented token yields
two live refresh tokens, and the reuse detection at `:354` never fires.

`frontend/js/auth.js:346` deliberately collapses concurrent refreshes *within
one tab*; two tabs, or any non-browser client, are not covered.

**Fix.** `select(RefreshToken).where(...).with_for_update()` so the second
request blocks and then sees the revoked row. A conditional
`UPDATE ... WHERE is_revoked = false` checked through `rowcount` is equivalent
and cheaper.

### 13. `revoke_specific_session` reports success for a session it did not revoke

**`server/services/auth_service.py:1029`**

The `UPDATE` result is discarded and *"Session revoked successfully."* is
returned unconditionally — for a nonexistent id, or one belonging to another
account. Moot today because of finding 1, and it leaks nothing (the message is
identical either way), but it starts lying the moment finding 1 is fixed.

**Fix.** `if result.rowcount == 0: raise HTTPException(404, "Session not found")`.

### 14. The 2FA pre-auth single-use check is skipped for a token with no `jti` *(latent — not currently reachable)*

**`server/services/auth_service.py:870`**

`if pre_auth_jti and not pre_auth_valid:` — a pre-auth token carrying no `jti`
claim leaves `pre_auth_valid` false and short-circuits the guard entirely,
restoring the unlimited-code-retry window the comment at `:866` says was closed.

Unreachable today: `create_pre_auth_token` is called with a `jti` at both sites
(`:297`, `:977`), and forging one needs `JWT_SECRET`. But `jti` is
`Optional[str] = None` at `server/auth/security.py:121`, so it is one optional
argument away from being real.

**Fix.** Make `jti` required in `create_pre_auth_token`, and reject at `:870`
when the claim is absent: `if not pre_auth_valid: raise`.
