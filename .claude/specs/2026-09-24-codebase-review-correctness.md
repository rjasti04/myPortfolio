# Technical Specification: Whole-Codebase Review §1 — Correctness Remediation

**Related Intent**: `.claude/intents/2026-09-24-codebase-review-correctness.md`
**Source report**: `docs/review/codebase_review_20260924.md` §1 (C1–C18)
**Target Audience**: Owner and Visitor / Recruiter first, then Work Sample
**Tree**: line numbers are at `4aa4792`. That commit only adds the report on
top of `f33d629`, so the report's numbers still apply.

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA: `frontend/js/auth.js`, `auth-ui.js`, `chat.js`,
        `analytics.js`, `activity.js`, `owner-analytics.js`, `main.js`,
        `syntax-highlighter.js`. `frontend/index.html` is **not** touched.
  - [x] Backend API: `server/services/auth_service.py`,
        `server/routes/auth_routes.py`, `server/schemas/` (one new request
        model), `server/auth/security.py`, `server/routes/chat_routes.py`,
        `server/controllers/event_controller.py`,
        `server/services/kafka_stream.py`
  - [ ] Database Schema: **not impacted**. No model, no migration.
  - [x] CI/CD & Deploy: `.github/workflows/deploy.yml`, `scripts/build.mjs`,
        `scripts/tests/build.test.js`, `server/requirements*.{in,txt}`

- **No new module and no new import edge.** Two frontend modules have to
  signal each other in C15, and they use a `window` `CustomEvent`
  (`rj:stale-build`). That is the pattern `auth-changed` already uses. It
  avoids a lazily loaded chunk statically importing the entry module.

- **One API behaviour change a client can see**: in C2, four routes answer
  400 instead of 401 for a wrong *re-authentication* password. **One
  authentication-model change**: in C3, `POST /auth/logout` authenticates by
  the refresh token in the body. Everything else is internal.

- **Delivery**: five PRs, in phase order. Each PR runs the gates for the layers
  it touches (§6).

| Phase | Findings | Layers | Why grouped |
| :--- | :--- | :--- | :--- |
| **A** | C1, C2, C3, C4, C14(b) | FE + BE | Every change here touches `auth.js`, `auth-ui.js` `setupNavUI` or the auth routes. Two P2s land here |
| **B** | C5, C11, C12, C17 | FE + BE | `chat.js` session state and the two chat routes |
| **C** | C10, C13, C14(a), C15, C16 | FE | Independent client lifecycle fixes. No server contract |
| **D** | C8, C9 | BE | Ingest write path |
| **E** | C6, C7, C18 | build, CI, deps | Nothing a visitor runs, except the public URLs C6 brings back |

---

## 2. API Contract & Schemas

### C2: wrong re-authentication password → **400**

| Route | Site | Today | After |
| :--- | :--- | :--- | :--- |
| `POST /auth/change-password` | `auth_service.py:501-505` | 401 + `WWW-Authenticate` | **400**, no header |
| `POST /auth/delete-account`, `DELETE /auth/account` | `auth_service.py:814-820` | 401 + `WWW-Authenticate` | **400**, no header |
| `POST /auth/2fa/enable` | `auth_service.py:894-898` | 401 | **400** |
| `POST /auth/2fa/disable` | `auth_service.py:941-945` | 401 | **400** |

- `detail` stays `"Incorrect current password"`. The existing
  `register_failed_attempt` + `commit` before the raise on both 2FA routes is
  unchanged.
- **Why 400.** A wrong password in the body is a failure of the request, not
  of the bearer credential. `authenticatedFetch` (`auth.js:416`) refreshes
  and **retries** on any 401. That doubles the lockout count on the 2FA
  routes and burns a refresh rotation on the other two. 403 would have the
  client sign the visitor out (`isCredentialRejection`, `auth.js:358-360`).
  422 is documented as a schema failure (`docs/API.md:787`).
- 401 stays reserved for a missing, invalid or expired bearer token, and for
  wrong credentials on `/auth/login`.
- **Client**: no change is needed. `changePassword`, `deleteAccount`,
  `enable2FA` and `disable2FA` all throw `getErrorMessage(detail)` whatever
  the status.

### C3: `POST /auth/logout` revokes this device's session only

```python
# server/schemas/ (next to RefreshTokenRequest)
class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None   # optional: cached old clients send no body
```

```python
# server/routes/auth_routes.py
@router.post("/logout")
async def logout(
    data: Optional[LogoutRequest] = None,
    current_user: Optional[User] = Depends(get_optional_current_user),
    session_jti: Optional[str] = Depends(get_current_session_jti),
    db: AsyncSession = Depends(get_db),
): ...
```

The service resolves the session to end in this order and stops at the first
match:

| # | Input | Action | Response |
| :--- | :--- | :--- | :--- |
| 1 | `refresh_token` in body, valid signature, `type == "refresh"` (**expiry not enforced**) | `UPDATE refresh_tokens SET is_revoked = true WHERE token_jti = :jti AND user_id = :sub AND is_revoked = false` | 200, whether or not a row matched |
| 2 | Valid bearer with a `sid` claim | Same `UPDATE` on `(current_user.id, sid)` | 200 |
| 3 | Valid bearer without `sid` (minted before the claim existed) | `revoke_user_tokens`, which is today's behaviour | 200 |
| 4 | None of the above: no body, bad signature, no valid bearer | nothing | **401** |

- **Expiry is not enforced in row 1, on purpose.** An expired refresh token
  is already dead, so revoking it is harmless, and the call stays
  idempotent. The signature check is what matters. It runs through a new
  `decode_refresh_token_for_revocation()` in `server/auth/security.py`, which
  calls `jwt.decode(..., options={"verify_exp": False})` and checks `type`.
  `verify_token()` is not loosened.
- **Response body unchanged**: `{"message": "Logged out successfully."}`. It
  does not say whether a row matched, so the route is not an oracle.
- **Standing rule deliberately crossed**: this is a user-data write that does
  not *require* `get_current_user`. The credential is the refresh token
  itself, the same one `POST /auth/refresh` accepts. Recorded in
  `docs/SECURITY.md`.
- **Revocation blast radius narrows.** Row 1 and row 2 no longer void pending
  one-time tokens, which expire within 15 minutes anyway. Password change,
  password reset and account deletion still void them through
  `revoke_user_tokens`. "Sign out everywhere" is still
  `POST /auth/sessions/revoke-others`, followed by the caller's own logout.
- Correct the `logout_user` docstring (`auth_service.py:480-486`). The access
  token has carried the refresh `jti` as `sid` ever since the claim shipped.
- **Client (`auth.js:321-334`)**: `logoutUser()` sends
  `{"refresh_token": <stored>}` as JSON and **no `Authorization` header**. If
  no refresh token is stored, it falls back to the bearer. If neither is
  stored, it makes no request. It then always calls `clearTokens()` and
  dispatches `auth-changed`, as today.

### C17: summarise enforces the anonymous free-message cap

- Extract `enforce_free_message_limit(messages, current_user)` from
  `chat_routes.py:57-64` into a module-level function in the same file. It
  raises the same 401, with the same `detail` and `WWW-Authenticate` header.
- `chat_summarize_endpoint` (`:197`) gains
  `current_user: Optional[User] = Depends(get_optional_current_user)` and calls
  the guard **before** `acquire_bedrock_slot`, so a refused call spends no
  slot.
- It is a helper, not a FastAPI dependency. A dependency would have to
  declare the `ChatStreamRequest` body a second time next to the route's own.
- **Must not touch `model_id`**. That is S1, in a separate change.
- The client needs no change. `chat.js:1865` treats a non-ok summarise as "no
  summary" and goes on to `/chat`, which returns the same 401 that the
  free-limit UI already handles (`chat.js:1912`).

### C8: `POST /events/bulk` stops reporting an outage as 422

| Exception from `commit()` | Status | Client (`analytics.js:426`) |
| :--- | :--- | :--- |
| `IntegrityError` (such as an FK violation) | 422 `"Failed to insert events (possibly invalid session_id)"` | drops the batch, correctly |
| `OperationalError`, `InterfaceError` | **503** `"Event storage is temporarily unavailable"` | **re-queues** |
| anything else | re-raised, so **500** | re-queues |

The broadcast loop (`event_controller.py:123-133`) moves **out** of the `try`.
The rows are already committed by then, so an exception there must not become
a rollback followed by an error status. A 5xx would make the client re-send
rows that were already saved.

---

## 3. Database Schema & Migration Plan

Not applicable. No file under `server/models/` changes. C3 reads and writes
`refresh_tokens.token_jti`, `user_id` and `is_revoked`, which already exist.
CI's `alembic check` is the proof that nothing drifted.

---

## 4. Implementation & Acceptance

Each row names the signal a test asserts. File paths are relative to
`frontend/js/` unless they start with a top-level directory.

### Phase A: auth session integrity

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **C1** | In `refreshAccessTokenOnce`, when `/auth/refresh` answers 401/403, **re-read** `REFRESH_TOKEN_KEY` before reporting a rejection. If the stored token is non-null and differs from the one this tab sent, another tab has rotated it: return `{ token: getAuthToken(), rejected: false }`, and `authenticatedFetch` retries with the winning tab's access token. It is a real rejection only when storage still holds the token this tab sent. Update the comment at `:339-345` to say that the de-duplication is per tab and that the re-read covers other tabs. **Revised during implementation:** the re-read alone does not close the race. The loser's 401 can arrive before the winning tab has *written* its new pair, so the re-read still finds the old token and signs out. The refresh now also runs under a Web Lock (`navigator.locks`, `rj-auth-refresh`), the report's own "better still". Each request remembers the refresh token stored when it was sent, and if storage holds a different one once the lock is granted, the new access token is used with no second refresh. The post-401 re-read stays as the fallback where there is no lock manager. | `auth.js` | `auth-refresh.test.js`: the refresh mock writes a new pair into `localStorage` and then answers 401. Tokens end up as the new pair, `auth-changed` does not fire, and the original request is retried with the new access token. Also: two module instances of `auth.js` (two tabs) over one storage and a fake lock manager make exactly one refresh call, and a request that failed before another tab rotated retries without refreshing |
| **C2** | The four status changes in §2. | `server/services/auth_service.py` | `test_auth.py:263`, `:776` and `:862` expect 400. A **new** delete-account wrong-password test expects 400. A **new** test shows that one wrong password on `/2fa/enable` raises `failed_login_attempts` by exactly 1. **Revised during implementation:** that backend test was dropped. The server never counted twice per request; the double count came from the client retrying on a 401. What proves the fix is a client test that a 400 from `enable2FA` is not refreshed or retried (`auth-refresh.test.js`), plus a backend assertion that the 400 carries no `WWW-Authenticate` |
| **C3** | §2 contract: server route, service and decode helper, plus the `logoutUser()` client. | `server/routes/auth_routes.py`, `server/services/auth_service.py`, `server/auth/security.py`, `server/schemas/`, `auth.js` | Backend: (a) a body-only logout with **no** bearer returns 200, that token then refreshes to 401, and a second device's token still refreshes to 200. (b) An expired access token plus a body token returns 200 and revokes. (c) A bearer-only logout revokes only its own `sid` session. (d) The existing `test_logout_revokes_the_refresh_token` and `test_logout_requires_authentication` pass unchanged. (e) A garbage `refresh_token` with no bearer returns 401. Frontend: the logout request carries the refresh token in the body and no `Authorization` header, and tokens are cleared even when `fetch` rejects |
| **C4** | `authenticatedFetch` keeps its return shape, because about 20 callers depend on it. When the refresh returns no token **and** `rejected === false`, it adds the original response to a module-level `WeakSet`. A new export, `isRejectedResponse(res)`, is `isCredentialRejection(res.status) && !transient.has(res)`. `setupNavUI` (`auth-ui.js:1541`) switches from `isCredentialRejection(res.status)` to it. | `auth.js`, `auth-ui.js` | `/auth/me` returns 401 and `/auth/refresh` returns 429, 503 or a thrown error: both tokens stay in storage. `/auth/me` returns 401 and refresh returns 401: tokens are cleared, which is today's behaviour. Tested at the helper level in `auth-refresh.test.js`, and through `setupNavUI` in a new `auth-nav-session.test.js` on the `auth-2fa.test.js` harness |
| **C14(b)** | `setupNavUI` registers its outside-click `document` listener with `{ signal }` from a module-level `AbortController`. Each call aborts the previous controller before it registers. | `auth-ui.js` (`:1490`) | After N `auth-changed` dispatches, at most one outside-click listener is live. A spy on `document.addEventListener` shows that each registration's signal is aborted by the next one. The two jsdom harnesses that mount `auth-ui.js` add `AbortController` to the window globals they copy, because jsdom's `addEventListener` rejects an `AbortSignal` from Node's realm (in a browser there is only one realm) |

### Phase B: chat state

**Invariant for the phase**: *"Loading this conversation…" is painted only
while a `GET /chat/history/{id}` for that conversation is in flight.*

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **C5** | (1) `saveSessions()` serialises through a replacer that drops `TRANSIENT_SESSION_KEYS = new Set(['hydrating', 'loadError'])`. No message object uses those keys. (2) `loadSessions()` deletes both keys from every parsed row, which cleans rows persisted before the fix. (3) `hydrateSession` clears `hydrating` **before** each of its `saveSessions()` calls, so the sidebar repaint that the save triggers sees the settled state. (4) Init (`chat.js:2276`): when the active session is an unhydrated stub (`remote && !hydrated`), it goes through `openSession()` instead of a bare `restoreActiveSession()`. When `hydrateSession` returns false because the visitor is signed out, set `loadError = 'Sign in to load this conversation.'`, so the spinner is not left with nothing in flight. *(Implemented inside `hydrateSession`, which sets the error and returns true so its caller repaints.)* S9 removes server-backed rows on sign-out later; this covers the gap until then. | `chat.js` | `chat-history-sync.test.js`: (a) after a hydrate, the persisted JSON has no `hydrating` or `loadError` key. (b) A stored row with `"hydrating": true` loads, and opening it fetches. (c) A reload with an active stub makes exactly one `GET /chat/history/{id}`. (d) Signed out with an active stub paints the error notice, not the spinner |
| **C11** | (a) `deleteRemoteConversation` checks `res.ok`. A 404 counts as success, because the conversation was never saved. Any other failure, thrown or not, renders the transcript notice that Clear-all uses (`:1081-1087`): *"Deleted on this device. The saved copy could not be removed from your account and may reappear — try again in a moment."* The report says "toast", but the code's own precedent is a transcript notice, and the code wins. (b) `openSession` calls `restoreActiveSession()` unconditionally after `hydrateSession` returns. The 404 path changes `activeSessionId`, and that is exactly when the repaint was being skipped. (c) The cap in `saveSessions()` evicts **unhydrated stubs**, oldest first, until the list fits. Only if it is still over does it fall back to `slice(0, MAX_SESSIONS)`. The report's rule of keeping rows without a `conversationId` would protect nothing, because `backfillConversationIds()` (`:484`) gives every row one. | `chat.js` | (a) A DELETE that returns 500 shows the notice, and a 404 shows nothing. (b) A 404 on open repaints the newly active session with no "Loading…". (c) 45 local rows plus 10 newer server stubs: after the sync all 45 local rows remain, along with the 5 newest stubs |
| **C12** | (1) At the top of `handleChatSubmit`, straight after the `isApiConfigured()` check, create `const controller = new AbortController()`, assign it to `currentAbortController`, and call `setInputState(true)`. That moves the busy flag above `await ensureSession()` (`:1767`), which closes the double-submit on a first visit. (2) The summarise block moves inside the existing `try` (`:1902`), so its `finally` (`:2189`) cleans up after both requests. `/chat/summarize` gets `signal: controller.signal`. (3) Add a checkpoint `if (controller.signal.aborted) return;` after each `await` that comes before the stream: `ensureSession` and summarise. The early `ensureSession` failure also resets through the `finally`. (4) The outer catch (`:2141`) starts with `if (err?.name === 'AbortError' \|\| controller.signal.aborted)`. It removes the indicators and placeholders and returns, with no error card and no Retry. The inner check (`:2054`) uses the local `controller` too, because `abortGeneration()` sets `currentAbortController` to `null` before the rejection lands (`:1625-1627`). **Revised during implementation:** (2) the summarise block stays where it is. An abort checkpoint straight after it removes the typing indicators and returns, which is the same outcome with less movement in a 440-line function. The `finally` resets the composer only while this turn still owns the controller (`ownsTurn()`), because after a Stop `abortGeneration()` has already reset it and the next turn may own it. A fourth gap turned up and is closed with the rest: Stop after the headers but before the first token fell through to "The assistant did not return a response. Try again." It now ends as quietly as the other stops. | `chat.js` | Stop during summarise: no `/chat` request, no bot reply, input idle. Stop before headers (the fetch mock rejects with `AbortError`): no "Could not reach the assistant" and no Retry. Two submits in the same tick on a first visit: exactly one `/chat` request. Stop before the first token: no "did not return a response" card and no orphaned placeholder. All four in a new `chat-stop.test.js`, which adds the AI page's composer to the `chat-history-sync.test.js` harness |
| **C17** | §2 contract. | `server/routes/chat_routes.py` | `test_chat_stream.py`: an anonymous summarise with `CHAT_FREE_MESSAGE_LIMIT + 1` user messages returns 401, Bedrock is never called and no slot is taken. A signed-in caller with the same payload is not refused by the guard |

### Phase C: client lifecycle

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **C10** | `flushEventsOnUnload(isEndingSession)`: (1) The body holds the **oldest events that fit** in `KEEPALIVE_BUDGET_BYTES = 60 * 1024`, measured as UTF-8 bytes of the serialised payload. That leaves headroom for the small `/sessions/{id}/end` PATCH that follows on unload. The report suggested splitting into several requests, but the Fetch limit is on the *sum* of in-flight keepalive bodies, so a second chunk would be rejected too. (2) **`hidden`**: nothing is cleared up front. The sent events are marked in flight, in a module `Set` of references, so another `hidden` or a threshold flush in `sendEvents` skips them. On `response.ok` exactly those events are removed and the queue is saved. On a non-ok response or a rejection, they are un-marked and stay queued, still trimmed by the existing cap. (3) **`unload`**: only the *sent* events are removed straight away. The page may not survive to see the response, and at-most-once is today's behaviour for these events. Any remainder stays persisted, and the next page load already restores it. | `analytics.js` | `analytics-queue.test.js`: a `hidden` flush that rejects leaves both the in-memory and the persisted queue intact. A `hidden` flush that succeeds removes only the sent events, and events queued during the flight remain. 200 events of about 1 KiB each produce a body of at most 60 KiB, and the rest stays persisted. `unload` removes only the sent events |
| **C13** | (1) Add a module-level `activityEntryGeneration`. `enterActivitySection` captures `++activityEntryGeneration`, and after each `await` (`ensureSession` at `:1121`, `loadActivity` at `:1124`) it returns if the value has changed. `leaveActivitySection` increments it. (2) In `onerror` (`:1047`), if `readyState === EventSource.CLOSED`, set `"error"` immediately and set `activityStreamSource` to `null`, so a restart can open a fresh source. `startActivityStream` returns early while it is set (`:993`). (3) The Refresh handler (`:1403`) also runs `stopActivityStream(); startActivityStream();`. `startActivityStream` already resets `streamErrorCount` (`:1001`). | `activity.js` | `activity-events.test.js` with a fake `EventSource`: leaving while `loadActivity` is pending means no `EventSource` is constructed and no interval is left set. One error with `readyState` CLOSED sets the pill to "error". Refresh after an error constructs a new `EventSource` |
| **C14(a)** | Add `let loadSeq = 0` to the window picker (`owner-analytics.js:152-160`). Each click takes `const seq = ++loadSeq`. After `await load()`, it paints and calls `setBusy(false)` only if `seq === loadSeq`. | `owner-analytics.js` | `owner-analytics.test.js`: click 30d, then 7d, and resolve 30d last. The painted data is 7d's, and 7d is `aria-pressed` |
| **C15** | (1) After `register()` resolves (`main.js`), `if (registration.waiting && navigator.serviceWorker.controller) showUpdateNotification(registration)`. (2) Stale chunks: `loadChatModule` and `loadActivityModule` (`main.js:54-86`), and the owner-analytics import in `activity.js:1260`, dispatch `window` `rj:stale-build` **only when the `import()` itself rejects**, not when `init*()` throws. Each import gets its own `.catch` before the `.then(init)`. `main.js` listens and shows the existing update banner with Reload. With a waiting worker, Reload takes the existing `SKIP_WAITING` path; otherwise it calls `location.reload()`. The `updateBanner` guard keeps it to one banner. The `console.warn` stays. | `main.js`, `activity.js` | A fake `navigator.serviceWorker` whose `register()` resolves with `waiting` set shows the banner on load. A rejected dynamic import shows the banner once, and an `initChat()` throw shows none. If importing `main.js` into jsdom is too heavy, the two handlers are extracted as exported functions and tested directly |
| **C16** | `escaped.replace(placeholders[i].key, () => placeholders[i].html)` (`syntax-highlighter.js:63`). | `syntax-highlighter.js` | New `syntax-highlighter.test.js`: a JS string literal containing `$&`, `` $` ``, `$'` and `$$` comes back with its `textContent` identical to the input |

### Phase D: ingest durability

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **C8** | §2 contract. Import `IntegrityError`, `OperationalError` and `InterfaceError` from `sqlalchemy.exc`. | `server/controllers/event_controller.py` | `test_activity_events.py`: a `commit` monkeypatched to raise `OperationalError` gives 503, and one raising `IntegrityError` gives 422. A failing broadcast after a successful commit still returns 200 with `inserted` set |
| **C9** | In `save_batch` (`kafka_stream.py:618`), add `except IntegrityError` **before** the generic branch, and **bisect** instead of discarding. Split the batch in half and commit each half in its own `AsyncSessionLocal()`. A half that raises `IntegrityError` splits again, until a single failing row is dropped and counted in `events_dropped_rejected`. Written rows count in `rows_written`. A per-row retry was rejected: after an outage the buffer can hold `MAX_BUFFERED_EVENTS` (10,000) rows, and bisection costs O(k log n) commits for k bad rows. An `OperationalError` or `InterfaceError` during the bisection puts the rows **not yet written** back into the buffer, the same way the batch-level recoverable branch does. | `server/services/kafka_stream.py` | `test_ingest_buffer.py`: in a batch of 10 where one row raises `IntegrityError`, 9 rows are written, `events_dropped_rejected` rises by 1 and `rows_written` by 9. A recoverable error mid-bisection puts back exactly the unwritten rows, in order |

### Phase E: build, CI, dependencies

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **C6** | Add `STABLE_ALIASES` to `build.mjs`: `rjasti_resume.pdf`, `favicon.ico`, and every `*-preview.png` at the `frontend/` root. It is matched by pattern, so a new app's preview needs no registration. These files still get their hashed copy, which pages keep referencing, **and** an un-hashed copy at the source path. `sitemap.xml` keeps shipping verbatim, since every URL in it now resolves. The report's alternative, rewriting the sitemap, was rejected: crawlers index `<image:loc>` by URL, and a stable URL is what they should hold. `.htaccess` is unchanged. Its rule at `:112-114` already gives un-hashed images and PDFs `max-age=3600, must-revalidate`, and the immutable rule (`:130`) needs a hash suffix, which aliases do not have. That is already asserted at `build.test.js:134-147`. | `scripts/build.mjs`, `scripts/tests/build.test.js` | **Amend** `build.test.js:150`. The rule "every shipped image and PDF is hashed" becomes "every shipped image and PDF has a hashed copy, and an un-hashed copy ships only for the alias set". **Add**: `dist/rjasti_resume.pdf` and `dist/favicon.ico` exist; every `<image:loc>` in `dist/sitemap.xml` is a file in `dist/`; every `<loc>` resolves to `index.html` or `<path>.html`. The test that no page points at an un-hashed asset (`:163`) stays **unchanged** |
| **C7** | Put a step-level `timeout-minutes` on every step that can hang: Deploy Backend (`:417`), Deploy Frontend (`:428`), Install + Migrate (`:440`), Restart (`:458`), Verify Health (`:470`) and Smoke Test (`:513`). A step timeout is a step *failure*, so `failure()` fires whichever way Actions treats a job timeout. Both rollback steps (`:563`, `:601`) become `if: (failure() \|\| cancelled()) && env.DEPLOY_SNAPSHOT == 'ok'`, and get their own timeouts. Raise the job `timeout-minutes` (`:288`) so that the sum of the step timeouts from Snapshot through Smoke, plus both rollback steps, fits inside it. Values are set from recent green runs' step durations, with headroom, and recorded in a comment. A manual cancel mid-deploy also rolls back now, which is intended: a cancelled `rsync --delete` leaves a half-deployed release. | `.github/workflows/deploy.yml` | The YAML parses (`python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'`). Each named step has `timeout-minutes`. Both rollback conditions include `cancelled()`. Arithmetic in the PR description: the step budgets fit the job budget |
| **C18** | Add `python-dotenv` to `server/requirements.in`, with a comment naming its two importers (`server/alembic/env.py:27`, `scripts/clear_2fa.py:40`). Regenerate `server/requirements.txt` with the command in `requirements.in:6-8`, and regenerate the dev lock with its own header command. **Expected diff**: only the `# via` annotations change, and `1.2.3` and its hashes stay the same, because `uv` prefers existing pins in the output file. If any other pin moves, stop and report. Do not accept an unrelated upgrade. | `server/requirements.in`, `server/requirements.txt`, `server/requirements-dev.txt` | `test_dependency_locks.py::test_every_direct_dependency_is_pinned` covers the new line. The lock diff is annotation-only |

### DOM sanitization

No new `innerHTML` sink. The C11 notice and the C15 banner go through the
existing `renderTranscriptNotice` and `showUpdateNotification`, which set text
through `textContent`. C16 narrows an existing sink: the replacement is a
function, so a `$` pattern in highlighted source can no longer be interpreted.

### Styling

No CSS change. The C15 stale-build prompt reuses `.update-banner` as it is.

---

## 5. Security & Rate Limiting Review

Run the `docs/SECURITY.md` pre-merge checklist on Phase A, because it touches
auth and session tokens. Run it again on Phase B, because C17 touches a
rate-limited anonymous route.

- [x] **Rate limits**: no budget changes. `/auth/logout` is not added to the
      strict auth budget. It is not a guessing surface, because every path
      that revokes anything needs a validly signed JWT.
- [x] **No secrets logged or returned**: C3 logs `user_id` and `jti`, as
      `refresh_user_token` already does, and never the token. Its response
      does not reveal whether a row matched.
- [x] **Authorisation scope (C3)**: the revocation `WHERE` clause always
      includes `user_id = sub`, so a token can revoke only its own subject's
      session. Tokens cannot be forged without `JWT_SECRET`.
- [x] **Downgrade path (C3)**: a cached old client that sends only a bearer
      token resolves by `sid`. That is narrower than today's revoke-all and
      never wider.
- [x] **Cost ceiling (C17)**: the anonymous free-message cap now covers both
      Bedrock routes. `model_id` is left alone for S1.
- [x] **CSP hashes**: no inline `<script>` in `index.html` is touched.
      `scripts/check_csp_hashes.py` still runs as a gate, because the
      2026-09-22 spec predicted the same thing and was wrong.

---

## 6. Verification & Test Plan

Run each gate **once, after the last edit of that phase**. If one fails, fix
it and re-run that gate alone (`AGENTS.md` §6).

```bash
# Phases A, B, C, E (frontend + build)
npm run lint
npm test                      # also builds dist/ and runs scripts/tests/build.test.js

# Phases A, B, D, E (backend + locks)
ruff check server tests
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55

# Every phase
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens
```

**Docs changed with the code**, in the same PR as the change they describe:

| Phase | Doc | Change |
| :--- | :--- | :--- |
| A | `docs/API.md:193` | `/auth/logout`. Auth: "refresh token in body (bearer fallback)". Purpose: "End this device's session" |
| A | `docs/API.md:282` and the change-password and delete-account sections | 401 becomes **400** on a wrong current password |
| A | `docs/API.md:782` (error table) | 400 row gains "wrong current password on a re-authenticated route" |
| A | `docs/SECURITY.md:85-88` | Logout is single-session, authenticated by the refresh token, and no longer voids one-time tokens |
| A | `docs/JAVASCRIPT.md:189` | `logoutUser` sends the refresh token. New `isRejectedResponse` export |
| B | `docs/API.md:647` (`/chat/summarize`) | The anonymous free-message cap applies |
| D | `docs/API.md:787`, `:790` (error table) | 422 means a constraint rejected the bulk insert. 503 also covers an `/events/bulk` storage outage |
| E | `docs/FRONTEND.md:927` (build table, "Static") and `:385` | The stable aliases |
| E | `docs/OPERATIONS.md` Rollback | Also runs on cancel and on step timeout |

`check_docs.py --fix` repairs the per-module counts in `docs/JAVASCRIPT.md` and
`docs/TESTING.md` that the new tests move.

**Report update.** `docs/review/codebase_review_20260924.md` is edited only
after a phase's gates pass. Each C-finding is marked with its real outcome.
Where the fix differs from the report's suggestion (C6, C10, C11(c)), it says
so.

### Sequencing with the report's other sections

| Later finding | Overlap | Rule |
| :--- | :--- | :--- |
| U1 (P1, account menu) | Same `setupNavUI` block as C4 and C14(b) | Phase A merges first, and U1 rebuilds the markup on the signal-scoped listener |
| S9 (transcripts after sign-out) | Same `auth-changed` handler and `saveSessions` as C5 | Phase B merges first. S9 then removes the signed-out `loadError` stopgap from C5(4) |
| S12 (re-auth lockout) | Adds `register_failed_attempt` to change-password and delete-account | Needs C2 first, or each typo there counts twice as well |
| S1 (`model_id`) | `ChatStreamRequest`, used by both chat routes | Independent. C17 must not read or remove `model_id` |
| U3 (Stop button name) | The same Stop path as C12 | Independent. U3 changes only labels |

### Unverified going in

- **C7**: whether a job-level timeout makes `failure()` or `cancelled()` true.
  The step-level timeouts make the fix independent of the answer.
- **C10**: jsdom does not enforce the keepalive 64 KiB limit. The test asserts
  the body size, not what the browser does with it.
- **C15**: the error message for a rejected dynamic import differs between
  engines. The handler keys on the `import()` promise rejecting, not on the
  message text.
