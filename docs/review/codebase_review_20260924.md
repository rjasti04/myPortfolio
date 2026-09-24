# Whole-Codebase Review

**Date:** 2026-09-24
**Scope:** everything tracked: `server/`, `frontend/` (SPA, service worker and
the seven standalone apps), `scripts/`, `.github/workflows/`, dependency
manifests, and the Claude Code setup (`AGENTS.md`, `.claude/`, hooks, agents,
skills, `settings.json`, `.mcp.json`).
**Mode:** read-only. No source file was changed; this document is the only
output.

## Method

- **Backend and Claude setup:** read directly, file by file.
- **Frontend JS, UI/UX and CI/dependencies:** swept in parallel by three
  read-only search agents. Every `file:line` they reported was reopened and
  confirmed before it went in here, and anything that didn't reproduce was
  dropped.
- **Claude Code settings:** checked against the current published docs at
  `code.claude.com/docs` (`sub-agents`, `hooks`), not against memory.
- **Dependency CVEs:**
  - Python: exact pinned versions checked against the PyPI advisory API.
  - npm: `npm audit` run once.
  - Vendored `frontend/vendor/` files: compared byte for byte with
    `node_modules`.

### What this review does not re-report

Eleven earlier reviews in this folder are closed: `bugs.md`, `uiux.md`,
`2fa.md`, `apps-uiux.md`, `claude-setup.md`, `features.md`, `anti-slop.md` and
the four `visual-*.md`. Nothing below repeats one of them. Where a finding
touches ground an earlier review covered, the entry says what is new.

These standing decisions are respected as written and are not reopened:

- **ADR-001:** no frontend framework.
- **ADR-016:** no third-party asset origins in the SPA.
- **ADR-023:** the server owns the persona and the cost ceilings.
- `POST /chat` and `POST /sessions` stay anonymous on purpose.
- `ucl.html` and `worldcup.html` are allowed to load third-party assets.

Risks the repo already accepts in `docs/SECURITY.md` "Known limitations" or
`docs/DATABASE.md` "Retention and lifecycle" are listed once at the end and are
not scored.

### Severity scale

| Level | Meaning |
| :--- | :--- |
| **P0** | Exploitable now with severe impact: a breach, an authentication bypass, or unbounded spend |
| **P1** | Material security, cost or data-loss impact, or a WCAG Level A failure that blocks a core flow. Fix next |
| **P2** | A real defect whose impact is bounded or that needs a precondition |
| **P3** | Hardening, hygiene, drift, polish |

Each finding uses the attribute table from `AGENTS.md` §5, with Severity given
as P0–P3. Line numbers refer to the tree at commit `f33d629`.

---

## Summary

**No P0.** Two P1s: an anonymous caller can pick an expensive Bedrock model
(S1), and the signed-in account menu can't be operated with a keyboard (U1).

| Area | P0 | P1 | P2 | P3 | Total |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 1. Correctness | 0 | 0 | 6 | 12 | 18 |
| 2. Security | 0 | 1 | 8 | 9 | 18 |
| 3. Performance | 0 | 0 | 2 | 4 | 6 |
| 4. UI/UX | 0 | 1 | 8 | 3 | 12 |
| 5. Claude setup | 0 | 0 | 1 | 6 | 7 |
| **Total** | **0** | **2** | **25** | **34** | **61** |

### Index

| ID | P | Title | Primary location |
| :--- | :--- | :--- | :--- |
| S1 | P1 | Anonymous callers choose the Bedrock model | `server/schemas/chat.py:52` |
| U1 | P1 | Account menu is not keyboard-operable | `frontend/js/auth-ui.js:1450` |
| C1 | P2 | Cross-tab refresh race signs both tabs out | `frontend/js/auth.js:346` |
| C2 | P2 | A wrong re-auth password returns 401, so the client refreshes and sends it again | `frontend/js/auth.js:416` |
| C3 | P2 | Logout either signs out every device or revokes nothing | `frontend/js/auth.js:321` |
| C4 | P2 | Nav header clears tokens after a transient refresh failure | `frontend/js/auth-ui.js:1541` |
| C5 | P2 | Opened server conversations stick on "Loading…" after reload | `frontend/js/chat.js:1025` |
| C6 | P2 | Content-hashed build removes stable public URLs | `scripts/build.mjs:435` |
| S2 | P2 | Raw Bedrock exception text is streamed to anonymous clients | `server/services/bedrock_service.py:316` |
| S3 | P2 | Lockout undercounts concurrent guesses, and IPv6 gets one rate bucket per address | `server/services/auth_service.py:115` |
| S4 | P2 | Anyone can lock any account, and the lock message reveals that it exists | `server/services/auth_service.py:85` |
| S5 | P2 | Account-enumeration defences are documented but don't work | `server/services/auth_service.py:203` |
| S6 | P2 | The `.env.example` JWT placeholder passes the startup check | `.env.example:25` |
| S7 | P2 | The deploy key sits on disk while npm install scripts run | `.github/workflows/deploy.yml:323` |
| S8 | P2 | Deleted accounts are never actually deleted | `server/services/auth_service.py:802` |
| S9 | P2 | Signed-in chat transcripts survive sign-out | `frontend/js/auth.js:15` |
| PF1 | P2 | bcrypt runs on the event loop | `server/auth/security.py:19` |
| PF2 | P2 | An unused GIN index sits on the hottest insert path | `server/models/event.py:35` |
| U2 | P2 | Predictors throw focus to `<body>` on every pick; World Cup rows have no role or state | `frontend/worldcup.html:2452` |
| U3 | P2 | The chat is announced wrongly to screen readers | `frontend/js/chat.js:1644` |
| U4 | P2 | Keyboard focus is invisible on the Dev Tools panels and outputs | `frontend/cron.css:407` |
| U5 | P2 | Three apps die when browser storage is blocked | `frontend/js/crypto/crypto-main.js:70` |
| U6 | P2 | Dev Tools widgets have missing or wrong semantics | `frontend/crypto.html:354` |
| U7 | P2 | Touch targets are too small or overlap | `frontend/auth-modal.css:569` |
| U8 | P2 | Reduced-motion setting is ignored by confetti and JS scrolling | `frontend/js/confetti.js:6` |
| U9 | P2 | World Cup share link is ignored for returning visitors | `frontend/worldcup.html:1878` |
| CS1 | P2 | "Read-only" subagents have unrestricted Bash | `.claude/agents/*.md` |
| C7–C18 | P3 | Twelve smaller correctness items | §1 |
| S10–S18 | P3 | Nine hardening items | §2 |
| PF3–PF6 | P3 | Indexes, logging, repeated scans | §3 |
| U10–U12 | P3 | Feedback states, structure, cross-app consistency | §4 |
| CS2–CS7 | P3 | Review policy, hook robustness, drift | §5 |

---

## 1. Correctness

### C1 — Cross-tab refresh race signs both tabs out

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P2 |
| **Location** | `frontend/js/auth.js:346-405` (`refreshAccessTokenOnce`), `:430-433` (clear on rejection) |
| **The "Why"** | `refreshInFlight` is a module variable, so it de-duplicates refreshes only within one tab. Two tabs whose access tokens expired together (a laptop waking up, say) both read the same refresh token from shared `localStorage` and both POST it. The server's atomic claim (`auth_service.py:388-398`) lets exactly one win. The loser gets 401, sets `rejected`, and calls `clearTokens()`, which deletes the pair the winner has just stored, so **both** tabs are signed out. The comment at `:339-345` describes this exact failure as fixed. It is fixed only for one tab. No `storage` listener, `navigator.locks` or `BroadcastChannel` exists anywhere in `frontend/js`. |
| **The Fix** | Before clearing, re-read the stored refresh token. If it is no longer the one this tab sent, another tab rotated it: adopt the new pair and retry. Better still, run the refresh under a Web Lock and re-read storage once the lock is held. |
| **Status** | ✅ **Resolved** |
| **What changed** | `refreshAccessTokenOnce` runs under a Web Lock (`navigator.locks`, `rj-auth-refresh`), and each request remembers the refresh token that was stored when it was sent. A tab that finds the pair already rotated once it holds the lock retries with the new access token instead of spending the token again. Where there is no lock manager, a 401 from `/auth/refresh` re-reads storage before it counts as a rejection. **Differs from the suggested fix:** the re-read alone leaves the race open when the loser's 401 arrives before the winner has written its new pair, so the lock is the fix and the re-read is the fallback. `auth-refresh.test.js` runs two module instances over one storage. |

```js
// inside refreshAccessTokenOnce, after a 401/403 from /auth/refresh
if (localStorage.getItem(REFRESH_TOKEN_KEY) !== refreshToken) {
  return { token: getAuthToken(), rejected: false }; // another tab won
}
```

### C2 — A wrong re-auth password returns 401, so the client refreshes and sends it again

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P2 |
| **Location** | Server: `server/services/auth_service.py:501-503` (change-password), `:816-818` (delete), `:898` (2FA enable), `:945` (2FA disable). Client: `frontend/js/auth.js:76,89,283,303` call these through `authenticatedFetch`, whose `:416` treats any 401 as an expired access token |
| **The "Why"** | An "Incorrect current password" answer is indistinguishable from "your bearer token expired". The client rotates the refresh token and re-POSTs the same wrong password. On 2FA enable/disable each attempt calls `register_failed_attempt`, so **one typo counts twice** and the account locks (15 min) on the third typo instead of the fifth. Every typo on the other two routes also burns a refresh-token rotation. |
| **The Fix** | Fix it on the server. A wrong *re-authentication* password is a validation failure of the request body, not of the bearer credential, so answer **400**. Not 403: `isCredentialRejection` (`auth.js:358-360`) treats 403 as "sign out". Update the four `HTTPException`s and their tests, and keep 401 for the bearer token only. |
| **Status** | ✅ **Resolved** |
| **What changed** | All four routes answer **400** `"Incorrect current password"`, with no `WWW-Authenticate` header. The client needed no change: its four wrappers were already status-agnostic, and 400 is not in `isCredentialRejection`. `docs/API.md` documents the rule once, under change-password. |

### C3 — Logout either signs out every device or revokes nothing

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug / Security |
| **Severity** | P2 |
| **Location** | `frontend/js/auth.js:321-334`; `server/services/auth_service.py:479-489`; `server/auth/security.py:92-93` |
| **The "Why"** | The client logs out with a plain `fetch` carrying the current access token and ignores the status. After 30 minutes of reading, the token has expired: `get_current_user` answers 401, `logout_user` never runs, and the **30-day refresh token stays valid server-side** while the UI says "Signed out." (With no token at all the header is `Bearer null`.) When the call does succeed, it revokes **every** refresh token the user holds. The docstring says this is because "the access token carries no refresh `jti`". That stopped being true when the `sid` claim shipped, and `revoke_all_other_sessions` already uses it. Signing out of a phone signs out the laptop. |
| **The Fix** | `POST /auth/logout` takes the refresh token in the body (the client has it) and revokes that one row, authenticating by the refresh token itself so an expired access token doesn't matter. Keep "sign out everywhere" as the existing `/auth/sessions/revoke-others` plus the caller's own logout. Correct the docstring. |
| **Status** | ✅ **Resolved** |
| **What changed** | `POST /auth/logout` takes an optional `{"refresh_token"}` and revokes that one row, scoped to the token's own `sub`. The signature and `type` are verified and expiry is deliberately not. With no body, a valid bearer's `sid` names the session, and a pre-`sid` token still ends all of them. `logoutUser()` sends the body and no bearer. The docstring is corrected, and `docs/SECURITY.md` records the deliberate exception to the `get_current_user` rule. |

### C4 — Nav header clears tokens after a transient refresh failure

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P2 |
| **Location** | `frontend/js/auth-ui.js:1444` (`authenticatedFetch('/auth/me')`), `:1541-1545` |
| **The "Why"** | If the access token has expired and `/auth/refresh` answers 429, 5xx or fails offline, `authenticatedFetch` deliberately keeps the tokens (`auth.js:390-395,427-433`). It then hands back the **original 401**. `setupNavUI` reads that 401 as `isCredentialRejection` and calls `clearTokens()`, undoing the design in `auth.js:348-360`. The refresh route shares the general per-IP budget, which the comment at `:1546-1552` itself says the Activity page can exhaust. |
| **The Fix** | Have `authenticatedFetch` report whether the credential was actually rejected (return `{ response, rejected }`, or tag the response). `setupNavUI` clears only on `rejected === true`. |
| **Status** | ✅ **Resolved** |
| **What changed** | `authenticatedFetch` keeps its return shape and records a 401 whose refresh failed transiently. `setupNavUI` clears tokens only on the new `isRejectedResponse(res)`. Covered through the real header in `auth-nav-session.test.js`. |

### C5 — Opened server conversations stick on "Loading…" after reload

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P2 |
| **Location** | `frontend/js/chat.js:1025-1027` (save), `:1035` (`finally` clears the flag), `:1457` (render), `:1003` (guard) |
| **The "Why"** | `hydrateSession` calls `saveSessions()` while `session.hydrating` is still `true`; the `finally` resets it only afterwards, so `"hydrating": true` is what lands in `localStorage`. After a reload, `:1457` paints "Loading this conversation…" with a spinner. `:1003` then refuses to refetch, because `remote` is already `false`. Every later save writes the flag back, so the conversation stays stuck until it is deleted. Not covered by `chat-history-sync.test.js`. |
| **The Fix** | Clear `hydrating` before `saveSessions()`, and have `saveSessions` strip transient fields (`hydrating`, `loadError`) from what it serialises. Also reset them on load for rows already persisted. |
| **Status** | ✅ **Resolved** |
| **What changed** | `saveSessions()` serialises through a replacer that drops `hydrating` and `loadError`, and `loadSessions()` strips both from rows an older build saved. `hydrateSession` settles `hydrating` before it saves. **Wider than reported:** init repainted an active stub without ever fetching it, so even with the flag fixed, "Loading…" could sit with nothing in flight. Init now opens an active stub through `openSession()`, and a signed-out stub says "Sign in to load this conversation." instead of spinning. |

### C6 — Content-hashed build removes stable public URLs

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P2 |
| **Location** | `scripts/build.mjs:41-43` (`HASHED_COPY_EXTENSIONS`), `:435` (only the hashed name is emitted), `:454-458` (rewrite list: HTML + `manifest.json` only); `frontend/sitemap.xml:10,21,32,43,54,65,76,87` |
| **The "Why"** | Every png/jpg/webp/ico/svg/pdf ships **only** under its hashed name. `sitemap.xml` is copied verbatim, so all eight `<image:loc>` URLs 404 in production. `/rjasti_resume.pdf` stops existing at the URL a recruiter bookmarks or a résumé links to, and `/favicon.ico`, which browsers and crawlers request unprompted, 404s too. `.htaccess` has no redirect for any of them. Recruiters are the site's first audience (`AGENTS.md`). |
| **The Fix** | Emit an unhashed copy (short cache, `must-revalidate`, as `.htaccess:112-114` already sets for un-hashed assets) for an allowlist: resume PDF, favicon, the `*-preview.png` social images. Add `sitemap.xml` to the rewrite pass for anything else. Add a `build.test.js` assertion that `dist/rjasti_resume.pdf` and every `sitemap.xml` URL exist. |
| **Status** | ✅ **Resolved** |
| **What changed** | `build.mjs` ships `rjasti_resume.pdf`, `favicon.ico` and every root `*-preview.png` un-hashed at their source path as well as hashed (`isStableAlias`, matched by pattern). Pages still point at the hashed names, and `.htaccess` already serves un-hashed images `max-age=3600, must-revalidate`, so it needed no change. `sitemap.xml` ships verbatim, since every URL in it now resolves. The report's alternative, rewriting it, was not taken, because crawlers should hold stable URLs. `build.test.js`'s "every image is hashed" rule now allows exactly that alias set, and new cases assert the résumé and favicon exist, each alias matches its hashed copy byte for byte, and every sitemap image and page is a shipped file. |

### C7 — Rollback probably doesn't run on a job timeout

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (CI) |
| **Severity** | P3 |
| **Location** | `.github/workflows/deploy.yml:288` (`timeout-minutes: 20`), `:562-563`, `:600-601` (`if: failure() && env.DEPLOY_SNAPSHOT == 'ok'`) |
| **The "Why"** | A job-level timeout cancels the job rather than failing a step, and `failure()` is false on cancellation. A hang in rsync or `alembic upgrade` would leave a half-deployed release with no rollback. |
| **The Fix** | `if: (failure() \|\| cancelled()) && env.DEPLOY_SNAPSHOT == 'ok'`, and give the rsync and migration steps their own `timeout-minutes` so a hang surfaces as a step failure. |
| **Status** | ✅ **Resolved** |
| **What changed** | Every deploy step that can take more than seconds has its own `timeout-minutes`, sized to its worst case: snapshot 5, build 5, backend 3, frontend 3, install and migrate 8, restart 3, health 5 (its probe loop alone can run 3 min), smoke 3. A step timeout is a step failure, so a hang reaches the rollback through `failure()` whichever way Actions treats a job timeout. Both rollback steps also run on `cancelled()` and carry their own budgets (8 and 3). The job timeout rises from 20 to 50 so the 46-minute sum fits, and a comment above it shows the arithmetic. A green deploy takes about 30 s, measured from the last eight runs. |

### C8 — A bulk-event database outage is reported as 422, so the client drops the batch

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `server/controllers/event_controller.py:134-137` |
| **The "Why"** | Any exception from the insert, a dropped connection included, becomes a 422 "possibly invalid session_id". `analytics.js` re-queues only on 5xx/429, so a transient database blip permanently loses every buffered event in the batch. |
| **The Fix** | `except IntegrityError` → 422; `except (OperationalError, InterfaceError)` → 503; let anything else be a 500. |
| **Status** | ✅ **Resolved** |
| **What changed** | `IntegrityError` → 422; `OperationalError`/`InterfaceError` → **503**, which `analytics.js` re-queues; anything else is re-raised as a 500, which it also re-queues. The flush metric and live broadcast moved after the commit and are best-effort, so a failure there can neither roll back nor misreport rows already saved. |

### C9 — One bad Kafka event drops its whole batch

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `server/services/kafka_stream.py:682-694` |
| **The "Why"** | A single message naming an unknown `session_id` (an FK violation) sends the whole `save_batch` to the "unrecoverable" branch, which discards up to `BATCH_SIZE` valid events along with it. |
| **The Fix** | On `IntegrityError`, retry the batch row by row and drop only the rows that fail, counting them in `events_dropped_rejected`. |
| **Status** | ✅ **Resolved** |
| **What changed** | A batch refused with an `IntegrityError` is **bisected** rather than dropped: each half commits in its own transaction, a refused half splits again, and only a single row still refused is dropped and counted in `events_dropped_rejected`. **Differs from the suggested fix:** not row by row. After an outage the buffer can hold `MAX_BUFFERED_EVENTS` (10,000) rows, and bisection costs O(k log n) commits for k bad rows. An outage part-way through returns the unwritten rows to the buffer, in order. |

### C10 — The unload/hidden flush clears the event queue before the send finishes

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/analytics.js:471-489`; queue cap `:38` |
| **The "Why"** | `eventQueue.length = 0; saveEventQueue()` runs straight after firing the `keepalive` fetch, without waiting for the result. On `visibilitychange` while offline, the persisted queue the offline design exists to keep is wiped. A backlog near the 200-event cap can also exceed the 64 KiB `keepalive` body limit, which rejects the request outright. |
| **The Fix** | For `hidden`, remove events only once the send resolves OK. Chunk `keepalive` bodies under about 60 KiB. |
| **Status** | ✅ **Resolved** |
| **What changed** | A hide flush keeps its events queued, and persisted, until the send succeeds; other flushes skip them while it is in flight. An unload removes what it sends at once and leaves the rest persisted. Both send only the oldest events that fit a 60 KiB budget, less whatever a hide flush still has in flight. **Differs from the suggested fix:** chunking does not help, because Fetch's 64 KiB applies to the sum of in-flight keepalive bodies; a second chunk is refused like the first. |

### C11 — Chat history edge cases

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/chat.js:939-951`; `:1015,1046`; `:992-993` with `:497-499` |
| **The "Why"** | (a) `deleteRemoteConversation` never checks `res.ok`, and `fetch` doesn't throw on 429/5xx. A failed server delete is silent, and the conversation reappears on the next sync. (b) A 404 while opening a conversation removes the stub and activates another one, but `openSession` skips the repaint, leaving the deleted conversation's "Loading…" in the transcript. (c) Merging server stubs happens before the 50-row cap is applied, so a sign-in can evict **local-only** transcripts that exist nowhere else. |
| **The Fix** | (a) Check `res.ok` and surface a toast, as Clear-all already does (`:1081-1087`). (b) Repaint unconditionally after a 404. (c) Never cap away rows without a `conversationId`; cap stubs first. |
| **Status** | ✅ **Resolved** |
| **What changed** | (a) `deleteRemoteConversation` checks the status. A 404 counts as deleted; anything else paints the same may-reappear notice Clear-all uses. The report said "toast", but the code's own precedent is the transcript notice. (b) `openSession` repaints unconditionally after hydrating. (c) The cap evicts unhydrated server stubs first, oldest first and never the active one. **Differs from the suggested fix:** "rows without a `conversationId`" would protect nothing, because `backfillConversationIds()` gives every row one. |

### C12 — The Stop button's state handling has three gaps

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/chat.js:1622-1628` (`abortGeneration`), `:1860` (`/chat/summarize` without a signal), `:2141` (outer catch), `:2054` (inner `AbortError` check), `:1767` vs `:1805` |
| **The "Why"** | (1) Pressing Stop while a long conversation is being summarised only resets the UI. The turn continues, and a second submit can interleave two replies into one transcript. (2) Stopping before response headers arrive lands in the outer catch, which lacks the `AbortError` check the inner one has, and shows "Could not reach the assistant" with a Retry button. (3) `await ensureSession()` runs before `setInputState(true)`, so two fast submits on a first visit both stream. |
| **The Fix** | Create the `AbortController` before the summarise call and pass its signal. Treat `AbortError` in the outer catch as a clean stop. Set the busy flag before the first `await`. |
| **Status** | ✅ **Resolved** |
| **What changed** | One `AbortController` per turn, created and the turn marked busy before the first `await`. Its signal covers `/chat/summarize`, each `await` before the stream is a checkpoint, and both catch blocks check the turn's own controller. Stop before the headers, before the first token or during the summary ends quietly. The last of those was a fourth gap: it painted "The assistant did not return a response." `chat-stop.test.js` drives all four through the real composer. |

### C13 — Activity dashboard lifecycle

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/activity.js:1120-1151`; `:1047-1053`; `:1403-1408` |
| **The "Why"** | (1) `enterActivitySection` awaits `ensureSession`/`loadActivity`. If the visitor leaves during that wait, `leaveActivitySection` finds nothing to stop, and entry then opens the EventSource and a 15-second refetch timer on a hidden section. (2) When `/stream` returns an HTTP error, the browser closes the EventSource for good after **one** `error` event. The count (1) never passes `STREAM_GIVE_UP_AFTER` (3), so the pill says "Connecting…" forever. (3) The error state tells the visitor to "use Refresh", but Refresh never restarts the stream. |
| **The Fix** | Keep an entry generation counter and bail out after each `await` if it changed. When `readyState === EventSource.CLOSED`, go straight to "error". Have Refresh call `startActivityStream()`. |
| **Status** | ✅ **Resolved** |
| **What changed** | (1) An entry generation, bumped on enter and leave, stops an entry that was awaited across a leave from opening the stream and its timers. (2) A source the browser has `CLOSED` reports "error" at once and is released. (3) Refresh reopens a stream that is not open and leaves a healthy one alone. Covered by `activity-lifecycle.test.js` with a fake `EventSource`. |

### C14 — Out-of-order paints and a listener leak

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/owner-analytics.js:154-160`; `frontend/js/auth-ui.js:1490` |
| **The "Why"** | The owner dashboard's 7d/30d buttons `paint(await load())` with no sequencing, so a slower earlier response paints last under the wrong pressed button. `setupNavUI` runs on every `auth-changed` event and adds another `document` click listener each time, holding a detached dropdown. |
| **The Fix** | A request counter (ignore stale results), or `AbortController` per load. Register the outside-click listener once, or with an `AbortSignal` that is aborted on the next `setupNavUI`. |
| **Status** | ✅ **Resolved** |
| **What changed** | (a): the owner panel's window picker numbers each load, and only the latest click paints or clears the busy state. (b): the header's outside-click listener is registered with an `AbortSignal`, and each render aborts the previous one. |

### C15 — Service worker: stale tabs and the update prompt

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/main.js:260-268`; `frontend/sw.js:85-92`; `.github/workflows/deploy.yml:436-438` (`rsync --delete`) |
| **The "Why"** | Deploys delete the previous build's hashed chunks, and the lazily loaded chat, activity and owner-analytics chunks are not precached. A tab still on the old build 404s on those imports, and the only trace is a `console.warn`. The update banner appears only on an `updatefound` during the current page's life. A worker already `waiting` when the page loads is never offered. |
| **The Fix** | After `register()`, check `registration.waiting` and show the banner. On a dynamic-import failure, show "A new version is available — reload". |
| **Status** | ✅ **Resolved** |
| **What changed** | A worker already `waiting` when the page loads is offered. The lazy loaders go through `loadLazyModule`, which reports a failed import (not a throwing initialiser, and not while offline) as `rj:stale-build`. `main.js` answers with the update banner, and `activity.js` fires the same event for the owner panel's chunk. The registration wiring and the loader are exported so `sw-update.test.js` can drive them. |

### C16 — Syntax highlighter garbles `$&`, `` $` ``, `$'` and `$$`

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P3 |
| **Location** | `frontend/js/syntax-highlighter.js:62-64` |
| **The "Why"** | `escaped.replace(key, html)` passes the replacement as a string, so `$` patterns inside a highlighted token are interpreted. JS `'$&'` renders as a placeholder fragment. Only the display is affected; Copy is correct. |
| **The Fix** | `escaped.replace(key, () => html)`. |
| **Status** | ✅ **Resolved** |
| **What changed** | Placeholders are restored with a replacement function. `syntax-highlighter.test.js` round-trips all four `$` patterns and a template literal's `$${…}`. |

### C17 — `/chat/summarize` skips the anonymous free-message cap

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (cost control) |
| **Severity** | P3 |
| **Location** | `server/routes/chat_routes.py:197-234` (compare `:57-64`) |
| **The "Why"** | ADR-023 lists the free-message limit among the server-side ceilings, but only the streaming route applies it. Summarise is still bounded by the chat rate budget and a concurrency slot, so the exposure is small, but the two routes enforce different contracts. |
| **The Fix** | Share one guard (a dependency) between both routes. |
| **Status** | ✅ **Resolved** |
| **What changed** | `enforce_free_message_limit()` is shared by both routes, and `/chat/summarize` calls it before taking a concurrency slot. It is a plain function rather than a dependency, so the request body is declared once. `model_id` (S1) is untouched. |

### C18 — `python-dotenv` is imported directly but only installed transitively

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (build) |
| **Severity** | P3 |
| **Location** | `server/alembic/env.py:27`, `scripts/clear_2fa.py:40`; `server/requirements.txt:778` (`# via uvicorn`) |
| **The "Why"** | Migrations and the 2FA recovery script work only because `uvicorn[standard]` happens to pull `python-dotenv` in. A change to uvicorn's extras would break `alembic upgrade` in the deploy. |
| **The Fix** | Add `python-dotenv` to `server/requirements.in` and regenerate both locks (ADR-021). |
| **Status** | ✅ **Resolved** |
| **What changed** | `python-dotenv>=1.0.0` is a direct dependency in `server/requirements.in`, with a comment naming its two importers. Both locks were regenerated with `uv pip compile`. The diff is annotation-only: the pin stays 1.2.3 with the same hashes, and `# via uvicorn` becomes `# via -r server/requirements.in, uvicorn`. |

---

## 2. Security

### S1 — Anonymous callers choose the Bedrock model

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (cost) |
| **Severity** | **P1** |
| **Location** | `server/schemas/chat.py:52` (`model_id` field); `server/routes/chat_routes.py:50-52`; `server/config/settings.py:124-125` |
| **The "Why"** | `AGENTS.md` lists "client-chosen models" as a non-goal (ADR-023 row), yet `ChatStreamRequest` still accepts `model_id` from **unauthenticated** callers. `settings.py` also hard-adds `anthropic.claude-3-5-sonnet-20241022-v2:0` (and `google.gemma-3-4b-it`) to the allowlist whatever the environment says. The SPA never sends the field (`chat.js` only reads `model_id` back from metrics), so its only user is someone calling the API directly. Whatever `DEFAULT_MODEL_ID` is, a caller can upgrade every request to a Sonnet-class model at $3/$15 per million tokens. At the schema ceilings (24,000 characters in, 2,048 tokens out) that is about $0.05 a request. One IP is within the 12/min budget and can hold all four concurrency slots, which puts the saturated worst case around $400–500/day. If that model is no longer enabled on the account, the request fails instead, and S2 applies. |
| **The Fix** | Remove `model_id` from `ChatStreamRequest`. Pydantic's default `extra="ignore"` then drops it silently; set `extra="forbid"` if a 422 is preferred. Always stream with `DEFAULT_MODEL_ID`. Delete the two hard-coded `ALLOWED_MODEL_IDS.add(...)` lines (and the allowlist if nothing else needs it). Update `docs/API.md:594,629` and `docs/CONFIGURATION.md:121,129`. Add a backend test asserting a supplied `model_id` has no effect. See also CS2. |
| **Status** | ✅ **Resolved** |
| **What changed** | `model_id` is gone from `ChatStreamRequest`, and `extra="ignore"` is now explicit, so a supplied value is dropped rather than refused. Both chat routes and the transcript save use `DEFAULT_MODEL_ID`. `ALLOWED_MODEL_IDS` and its two hard-coded additions are deleted from `settings.py`, because nothing is left to allowlist. `test_a_supplied_model_id_is_ignored` sends a Sonnet id with a gemma default and asserts Bedrock is called with the gemma id through Converse; a sibling test covers `/chat/summarize`. The tests that needed the Anthropic invoke path now set the default instead of naming a model. |

### S2 — Raw Bedrock exception text is streamed to anonymous clients

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (information disclosure) |
| **Severity** | P2 |
| **Location** | `server/services/bedrock_service.py:316-318` → `server/routes/chat_routes.py:121-123` |
| **The "Why"** | `yield {"type": "error", "error": str(e)}` is forwarded verbatim in the SSE frame. botocore `AccessDeniedException`/`ValidationException` messages include the AWS account id, the assumed-role ARN and model ARNs, all handed to any anonymous visitor who can trigger an error (for example with S1's model switch). |
| **The Fix** | Log `str(e)` server-side with the request id. Send a fixed `{"error": "The assistant is unavailable right now.", "request_id": …}`. |
| **Status** | ✅ **Resolved** |
| **What changed** | The route logs the raw error with the request id and streams `{"error": "The assistant is unavailable right now.", "request_id": …}`. The id matches the response's `X-Request-ID`. `bedrock_service` is unchanged, because it is the internal contract, and `/chat/summarize` already mapped an error to a generic 502. `test_a_bedrock_error_does_not_reach_the_client` feeds an AccessDenied message carrying an account id and role ARN and asserts neither reaches the body. |

### S3 — Lockout undercounts concurrent guesses, and IPv6 gets one rate bucket per address

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P2 |
| **Location** | `server/services/auth_service.py:115-121` (`register_failed_attempt`), user row read at `:242-243`; `server/middlewares/rate_limit.py:124`; `server/utils/ip_utils.py:31-43` |
| **The "Why"** | `failed_login_attempts = (n or 0) + 1` is a read-modify-write on an ORM object loaded at the start of the request. Parallel wrong-password requests all read the same `n` and all write `n + 1`, so N concurrent guesses count as about one. The five-strike lockout therefore bounds sequential guessing only. The rate limiter keys on the full client address, so a single IPv6 /64 gives an attacker 2⁶⁴ separate 5/min budgets. Together these remove both online brute-force bounds for anyone who parallelises. |
| **The Fix** | Make the increment atomic and decide on the returned value; key IPv6 limiter buckets on the /64. |
| **Status** | ✅ **Resolved** |
| **What changed** | Each attempt is **reserved before the credential is checked**: `reserve_attempt` numbers it with an atomic `UPDATE … RETURNING`, commits, and refuses without checking once the number passes the threshold. **Differs from the suggested fix:** an atomic increment on its own still let every parallel request pass the lock check and be checked; reserving first is what bounds them. A lapsed lock is reset keyed on the value the request saw, so a burst at the moment of expiry cannot all get attempt number one. The rate limiter keys every budget on `_rate_bucket`: the /64 for IPv6, the IPv4 inside a mapped address. `test_parallel_guesses_are_not_all_checked` fires ten wrong guesses at once and passes on both SQLite and PostgreSQL 16; at most five reach the password check. |

```python
row = (await db.execute(
    update(User).where(User.id == user.id)
    .values(failed_login_attempts=User.failed_login_attempts + 1)
    .returning(User.failed_login_attempts)
)).scalar_one()
if row >= LOCKOUT_THRESHOLD:
    await db.execute(update(User).where(User.id == user.id)
                     .values(locked_until=now + LOCKOUT_DURATION))
```

### S4 — Anyone can lock any account, and the lock message reveals that it exists

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (availability / enumeration) |
| **Severity** | P2 |
| **Location** | `server/services/auth_service.py:85-112` (`enforce_lockout`), `:268` (login), `:1015` (2FA verify) |
| **The "Why"** | Five wrong passwords from one IP, which is exactly the per-minute auth budget, lock any address for 15 minutes, and repeating it keeps the owner out indefinitely. A 2FA-enabled owner can't get around it with a magic link, because `verify_2fa_login` enforces the same lock. "Account is temporarily locked" is also an oracle: addresses without an account never lock. `docs/SECURITY.md` "Known limitations" doesn't list either effect. |
| **The Fix** | Return the generic 401 while locked. Replace the hard lock with per-(account, source) counting plus an exponential delay, or exempt a mailed link (magic link / reset) from the lock. At minimum, record the DoS in "Known limitations". |
| **Status** | ✅ **Resolved** |
| **What changed** | The tally is split into a **password** tally (`failed_login_attempts`, `locked_until`) and a **code** tally (`totp_failed_attempts`, `totp_locked_until`, migration `l5a6b7c8d9e0`). `/auth/login` answers a locked account with the same 401 and body as a wrong password, at the same bcrypt cost. `verify_2fa_login` checks only the code tally, so a password lock no longer closes magic link → 2FA. **Differs from the suggested fix:** a mailed-link exemption is only safe once the tallies are separate, because a shared one cannot say which kind of guessing locked it. The split also closes a gap the report missed: a password reset cleared the shared tally, so an inbox holder could reset between rounds of five code guesses. The reset now clears the password tally only. The residual (anyone can keep password sign-in locked) is recorded in `SECURITY.md` "Known limitations". |

### S5 — Account-enumeration defences are documented but don't work

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (enumeration) |
| **Severity** | P2 |
| **Location** | `server/services/auth_service.py:203-212` (register); `server/auth/security.py:33-43` (legacy fallback), `:49-64` (`spend_verification_time`); `server/main.py:99` (`Server-Timing` exposed); `docs/SECURITY.md:186-192` |
| **The "Why"** | `/auth/register` answers "Email already registered", a direct oracle that the enumeration table in `SECURITY.md` doesn't mention. On login, a wrong password for a real account runs **two** bcrypt checks (prehash, then the legacy raw-password fallback), but an unknown address burns **one**. `ServerTimingMiddleware` then publishes the handler time to the millisecond, readable cross-origin. The documented "response time is not an oracle" claim doesn't hold. |
| **The Fix** | Registration returns the same 201/202 either way and mails "you already have an account" to an existing address. Burn two verifications on the unknown path, or retire the legacy branch once rehashing has migrated the rows. Omit `Server-Timing` on `/auth/*`. Update the `SECURITY.md` table. |
| **Status** | ✅ **Resolved** |
| **What changed** | `/auth/register` answers **202** with one `RegisterResponse` body for every address. An existing one costs the same bcrypt hash and is mailed `send_existing_account_email`, with no token, instead of a link. Every login refusal (unknown, wrong password, locked, purged) now costs two verifications, `spend_verification_time(rounds=2)`, which is what a wrong password costs. The legacy branch stays, because a hash alone cannot say which scheme made it. `Server-Timing` is left off `/auth/*`. The register panel's copy no longer says "Account created". The `SECURITY.md` enumeration table lists register and the timing defence. |

### S6 — The `.env.example` JWT placeholder passes the startup check

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (secrets) |
| **Severity** | P2 |
| **Location** | `.env.example:25` (`JWT_SECRET=replace-me-with-openssl-rand-hex-32`); comment `:19-24`; `server/config/settings.py:10,22,27` |
| **The "Why"** | The guard rejects only the legacy string and anything under 32 characters. The placeholder is 35 characters, so a `.env` copied as-is starts cleanly. Anyone who reads this public file can then mint HS256 tokens for any user id, owner analytics included. The comment tells the operator the opposite. |
| **The Fix** | Leave the example value empty so `required_env` fails. Also reject values containing `replace-me`/`change`, and values with low character diversity. |
| **Status** | ✅ **Resolved** |
| **What changed** | `.env.example` ships `JWT_SECRET=` empty, so a copied `.env` fails with "JWT_SECRET must be set". `_required_secret` also rejects `replace-me`, `change-me` and `changeme`, and fewer than 10 distinct characters (`JWT_SECRET_MIN_DISTINCT`). The report's broader "contains change" was narrowed, because a real passphrase may say it. The CI and test secrets all pass. **Owner action:** confirm the production `JWT_SECRET` is not the old placeholder before this deploys; if it is, the API refuses to start and the deploy rolls back. |

### S7 — The deploy key sits on disk while npm install scripts run

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (supply chain) |
| **Severity** | P2 |
| **Location** | `.github/workflows/deploy.yml:323-327` (writes `~/.ssh/id_rsa`), then `:399-402` (`npm ci`, `npm run build`); `:437,462-463` (`sudo rsync`, `sudo systemctl`) |
| **The "Why"** | `npm ci` runs dependency install scripts (esbuild's and Font Awesome's `postinstall`), and the build then executes esbuild, both **after** a root-equivalent SSH key is on disk. One compromised devDependency in a weekly Dependabot group means root on the production host. |
| **The Fix** | Build `dist/` in a job with no secrets and pass it on with `actions/upload-artifact`. Write the key only in the deploy job, which then runs no package code. |
| **Status** | ✅ **Resolved** |
| **What changed** | `frontend-check`, which holds no secrets, uploads the `dist/` it built and tested (a push to `main` only, kept one day). The deploy job downloads it *before* writing the key, and no longer sets up Node or runs `npm ci` or the build, so it runs no package code at all. The report's separate build job was folded into the existing gate, which already builds the same commit. The step budget comment is recomputed (33 + 11 of 50). |

### S8 — Deleted accounts are never actually deleted

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (privacy) |
| **Severity** | P2 |
| **Location** | `server/services/auth_service.py:802-835` (soft delete), `:196-200` (purge only on re-registration); `docs/DATABASE.md:325` |
| **The "Why"** | The UI tells the user their account is "scheduled for deletion", but nothing ever runs that schedule. The email, password hash, TOTP secret and every saved conversation are kept indefinitely, unless someone else happens to register the same address after 30 days. |
| **The Fix** | A scheduled purge (a systemd timer or a lifespan task) that deletes `users WHERE deleted_at < now() - interval '30 days'`. The `ondelete="CASCADE"` FKs already take the rest. |
| **Status** | ✅ **Resolved** |
| **What changed** | `purge_deleted_accounts` deletes every account soft-deleted more than `ACCOUNT_REACTIVATION_WINDOW` (30 days) ago, and the existing `ON DELETE CASCADE` foreign keys take its tokens, password history, conversations and session rows. `run_account_purger` is a lifespan task, like the ingest workers: it runs at start (so on every deploy) and every 24 hours, and logs a failed run instead of ending. The window is compared in Python, the same tz precedent as token expiry. Registration, login and the purge now read one constant. The test passes on SQLite, with `PRAGMA foreign_keys` on, and on PostgreSQL 16. |

### S9 — Signed-in chat transcripts survive sign-out

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (privacy) |
| **Severity** | P2 |
| **Location** | `frontend/js/auth.js:15-18` (`clearTokens` removes two keys); `frontend/js/chat.js:2281-2290` (`auth-changed` handler returns early when signed out) |
| **The "Why"** | `rj_chat_sessions` keeps every transcript fetched from the account. After sign-out, the next person on that browser sees them in the sidebar, and a different account signing in inherits the previous user's `conversationId`s. |
| **The Fix** | On sign-out, drop every session with a `conversationId` (server-backed) and re-render. Keep anonymous local conversations. |
| **Status** | ✅ **Resolved** |
| **What changed** | Rows are tagged with the owning account's id (`ownerId`, the token's `sub` through a new `getTokenSubject()`) when the server lists them and when a turn is sent signed in. `dropForeignSessions()` runs at load and on `auth-changed`: signed out, it drops tagged rows and untagged stubs; signed in, it drops another account's rows. Anonymous conversations stay. **Differs from the suggested fix:** "drop every session with a `conversationId`" would have dropped anonymous conversations too, because `backfillConversationIds()` gives every row one. The §1 C5 notice stays for a sign-out in another tab, which fires no `auth-changed` here. |

### S10 — Single-use tokens are consumed non-atomically

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `server/services/auth_service.py:165-183` (`consume_one_time_token`); compare `:388-398` |
| **The "Why"** | It SELECTs the row, checks `used_at` in Python, then writes. Two concurrent redemptions of one magic link both pass and both mint sessions. The refresh path already fixed the same race with a conditional UPDATE. (For 2FA pre-auth, an incidental autoflush lock happens to serialise the lockout counter, but that is luck, not design.) |
| **The Fix** | `UPDATE one_time_tokens SET used_at=now() WHERE jti=:jti AND purpose=:p AND used_at IS NULL AND expires_at > now()`, and check `rowcount == 1`. |
| **Status** | ✅ **Resolved** |
| **What changed** | `consume_one_time_token` claims with one conditional `UPDATE … WHERE jti = :jti AND purpose = :purpose AND used_at IS NULL` and checks `rowcount`. **Differs from the suggested fix:** expiry is checked in Python after the claim, not in the `WHERE`, mirroring `refresh_user_token`, because stored timestamps compare differently under SQLite and PostgreSQL. A wrong-purpose claim is refused and leaves the token unspent. |

### S11 — TOTP codes can be replayed within their 30-second step

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `server/services/auth_service.py:903-904`, `:950-951`, `:1017-1018` |
| **The "Why"** | No last-used timestep is stored, so a code observed by a phishing proxy or over a shoulder is valid again until its step ends (RFC 6238 §5.2). |
| **The Fix** | Store `totp_last_step` and reject a step ≤ it. This needs a column and a migration, so it fits with the open `2fa.md` findings 9/10. |
| **Status** | ✅ **Resolved** |
| **What changed** | New `users.totp_last_step` (migration `l5a6b7c8d9e0`). `consume_totp` verifies the code, then claims its step with `UPDATE … WHERE totp_last_step IS NULL OR totp_last_step < :step`; a replay is refused as a wrong code and counts on the code tally. It is used at 2FA verify, enable and disable. The code that enables 2FA cannot sign in within its step. The tests own the TOTP clock (`_totp_time`), so each `_totp_now()` gets a fresh step. |

### S12 — Change-password and delete-account are password oracles outside the lockout

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `server/services/auth_service.py:499-505`, `:814-820`; `server/middlewares/rate_limit.py:17-42` |
| **The "Why"** | Both verify the current password without `enforce_lockout`/`register_failed_attempt`, and neither path is on the strict auth budget. With a stolen access token (30 min), that is about 1,000 guesses a minute. 2FA enable/disable already do this correctly. |
| **The Fix** | Apply the same lockout sequence and add `/auth/change-password`, `/auth/delete-account` and `/auth/account` to `AUTH_RATE_LIMITED_PATHS`. |
| **Status** | ✅ **Resolved** |
| **What changed** | Change-password and delete-account go through `check_current_password`, the same reserve / record / clear sequence 2FA enable and disable now use, on the password tally. `/auth/change-password`, `/auth/delete-account` and `/auth/account` are on the strict auth budget. C2's 400 on a wrong current password was already in place. |

### S13 — `/models` is anonymous and calls the AWS control plane

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `server/routes/system_routes.py:19-24`; `server/controllers/system_controller.py:46-66` |
| **The "Why"** | Nothing in the frontend calls it. Any visitor can drive `ListFoundationModels` at the 1,000/min general budget, throttling the account's control-plane quota, and read the account's model inventory. |
| **The Fix** | Remove it, or put it behind `require_owner`. |
| **Status** | ✅ **Resolved** |
| **What changed** | Removed: the route, `list_models`, and the `bedrock_mgmt` client, so the API no longer calls the Bedrock control plane at all. `GET /models` and `GET /api/models` return 404. Removing `bedrock:ListFoundationModels` from the instance role is an owner action outside the repo. |

### S14 — Reset, verify and magic-link tokens travel in the query string

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `server/services/notification_service.py:232,271,305`; `frontend/sw.js:177-188` |
| **The "Why"** | The GET that loads `/?magic_token=…` is written to Apache's access log. The service worker then caches every navigation under its **full URL** with no expiry, so the token is persisted in Cache Storage. Every `?s=` share link also adds another full HTML copy to that cache. |
| **The Fix** | Put tokens in the fragment (`/#magic_token=…`), which never reaches the server. Strip it **before analytics starts**, because `analytics.js:364` records `pathname + hash` as `page_path`; today's query tokens are safe from that. Have the service worker cache navigations under `url.pathname` only. |
| **Status** | ✅ **Resolved** |
| **What changed** | The three mail helpers link to `/#reset_token=…`, `/#verify_token=…` and `/#magic_token=…`; a fragment never reaches the server, its access log or a fetch. The inline pre-boot script, which runs before any module, hands the token to `auth-ui.js` as `window.__rjAuthLink` and strips it from the address bar, so `analytics.js`'s `pathname + hash` page_path and the error reporter never see it. Its CSP hash is re-pinned. **Differs from the suggested fix:** the report did not account for the hash router; stripping in that first-running inline script is what makes the fragment safe. `takeAuthLinkTokens()` keeps the query string as a fallback for links mailed before the change (verify links live 24 h). `sw.js` caches navigations under `origin + pathname`, so neither an old query token nor a `?s=` share link becomes a cache key. |

### S15 — AI chat can make the SPA load arbitrary third-party images

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `frontend/js/chat.js:17-28` (`DOMPurify.sanitize(marked.parse(text))`, default config); `frontend/index.html:7` (`img-src 'self' data: https:`) |
| **The "Why"** | Markdown images in a model reply survive sanitisation, and the CSP allows any HTTPS origin. Model output, or text a visitor pastes in, becomes a tracking pixel or a markdown-image exfiltration channel. That goes against the spirit of ADR-016, even though script execution stays blocked. |
| **The Fix** | `DOMPurify.sanitize(html, { FORBID_TAGS: ['img'] })`, or a `marked` image renderer that emits a link. Narrow `img-src` to `'self' data:`. |
| **Status** | ✅ **Resolved** |
| **What changed** | `renderBotHTML` sanitises with `FORBID_TAGS: ['img', 'image']`, and a marked `image` renderer emits a link to the URL instead, so the visitor sees where it points and nothing is fetched. `img-src` is narrowed to `'self' data:`; checked first that no SPA image comes from another origin or `blob:` (the blob URLs in the diff and JSON apps are downloads, on pages with their own CSP). `chat-render.test.js` loads the real vendored DOMPurify and marked. |

### S16 — Security headers and CSP have drifted

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security |
| **Severity** | P3 |
| **Location** | `frontend/.htaccess:102-107`; `frontend/index.html:7` |
| **The "Why"** | `X-XSS-Protection "1; mode=block"` is deprecated; the current guidance is `0`. `Header set` without `always` leaves Apache's own 4xx/5xx pages unprotected. There is no `Permissions-Policy`. The production `connect-src` still lists `http://localhost:8000`, `http://127.0.0.1:8000` and `staging-api`. HSTS is already a known limitation. |
| **The Fix** | Use `Header always set`; set `X-XSS-Protection "0"`; add `Permissions-Policy: camera=(), geolocation=(), microphone=(self)` (voice input needs the mic). Have `build.mjs` strip the dev origins from the shipped CSP and re-pin the hashes. |
| **Status** | ✅ **Resolved** |
| **What changed** | Every `.htaccess` security header is `Header always set`; `X-XSS-Protection` is `0`; `Permissions-Policy: camera=(), geolocation=(), microphone=(self)` is added (only the chat's voice input uses a device). `build.mjs` strips the two loopback origins from `dist/index.html`'s `connect-src`; the source keeps them for local development, and `staging-api` stays because `getApiBaseUrl()` still routes a staging host there. **Differs from the suggested fix:** no hash re-pin was needed for that, because a CSP hash covers an inline script's body, not the meta tag. A build test asserts every inline script in the shipped page is still pinned. |

### S17 — GitHub workflows lack basic hardening

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (CI) |
| **Severity** | P3 |
| **Location** | All three `.github/workflows/*.yml` (no `permissions:`); `deploy.yml:25,56,318` (tag-pinned actions); `:326-330` (secrets interpolated into `run:`); `:138-140` and `weekly-audit.yml:34` (audit never fails); `deploy.yml:58,320` (Node 18, end of life) |
| **The "Why"** | The token gets the repository default scope. Actions float on mutable tags. A secret containing `$(`, a backtick or a quote would be evaluated by the shell. Vulnerabilities never block a merge: `npm audit` currently reports 8 high, all in transitive dev tooling. There is no pip-audit or CodeQL, and the CI runtime is past end of life. |
| **The Fix** | Add `permissions: contents: read` at the top level. Pin actions to SHAs (Dependabot keeps them current). Pass secrets through `env:`. Make `npm audit --omit=dev` blocking and add `pip-audit -r server/requirements.txt`. Move to Node 20 or 22 in the workflows and in `package.json` `engines`. |
| **Status** | ✅ **Resolved** |
| **What changed** | All three workflows run with `permissions: contents: read`. Every `uses:` is pinned to a commit SHA with its release in a comment (the latest release within the major each already used), and the existing Dependabot `github-actions` entry keeps them current. The SSH secrets reach the shell through `env:`. **Differs from the suggested fix:** `npm audit --omit=dev` audited nothing, because every package was a devDependency. `dompurify`, `marked` and Font Awesome, whose bytes ship, move to `dependencies`; a new build test holds the vendored copies byte-identical to `node_modules`; and the blocking shipped audit warns rather than fails when the advisory endpoint is unreachable. `pip-audit` is added to the dev lock and blocks in `backend-check` and the weekly audit. Node moves to 22, not 20, which reached end of life on 2026-04-30. Both audits are clean at introduction. |

### S18 — Repo hygiene: `.gitignore` gaps and an unmaintained password library

| Attribute | Detail |
| :--- | :--- |
| **Category** | Security (hygiene) |
| **Severity** | P3 |
| **Location** | `.gitignore:13-14`; `server/requirements.in:35-36` (`passlib[bcrypt]`, `bcrypt<4.0.0` → `bcrypt==3.2.2`) |
| **The "Why"** | Only `.env` and `.env.local` are ignored, so `.env.production`, `*.pem` or `id_rsa` would be committed. The deploy's rsync already excludes `.env*`, which suggests those variants exist. `passlib` has had no release since 2020 and forces bcrypt below 4. There is no known advisory; it is a maintenance trap. |
| **The Fix** | `.env*` + `!.env.example`, `*.pem`, `*.key`. The prehash scheme is already custom, so calling `bcrypt` directly is a small change and lifts the cap. |
| **Status** | ✅ **Resolved** |
| **What changed** | `.gitignore` covers `.env*` except `.env.example`, `*.pem`, `*.key` and SSH keys; a test runs `git check-ignore` over eight cases. passlib is gone: `security.py` calls `bcrypt` 5.0.0 directly (12 rounds, passlib's default). The legacy branch truncates to 72 bytes, because bcrypt < 4 did that silently and bcrypt 5 raises instead. Fixtures made by passlib 1.7.4 over bcrypt 3.2.2 before the swap, including a legacy hash of an 81-byte password, still verify. Only passlib, bcrypt and the two packages old bcrypt needed (`cffi`, `pycparser`) moved in the locks. The pytest ignore for passlib's `crypt` warning went with it. |

---

## 3. Performance

### PF1 — bcrypt runs on the event loop

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | P2 |
| **Location** | `server/auth/security.py:19-67` (sync `pwd_context.verify/hash`), called from `async` services in `server/services/auth_service.py`; worst case `:527-534` and `:743-750` |
| **The "Why"** | Each bcrypt call takes about 250 ms of CPU, and it runs inside `async def` handlers, which blocks the event loop. A password change or reset checks up to six history hashes in a row, **freezing the worker for about 1.5 s**. That stalls every open SSE stream, chat response and health check on the worker. Any login, including an attacker's wrong guesses, does the same in smaller steps. |
| **The Fix** | Offload to a worker thread. |

```python
from anyio import to_thread
async def verify_password_async(p: str, h: str) -> bool:
    return await to_thread.run_sync(verify_password, p, h)
```

### PF2 — An unused GIN index sits on the hottest insert path

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | P2 |
| **Location** | `server/models/event.py:35-39` (`ix_events_data_gin`); migration `h1c2d3e4f5a6_activity_events_jsonb_index.py:53`; `server/routes/analytics_routes.py:204-206` |
| **The "Why"** | Every analytics event pays for GIN index maintenance, but no query uses `@>`, `?` or `?&`; a grep across `server/` finds none. The `/commands` docstring says `event_data->>'command'` is "indexable through `ix_events_data_gin`". It isn't: `jsonb_ops` GIN serves containment and key-existence, not `->>` extraction or `GROUP BY`. |
| **The Fix** | Drop the index in a new migration (never edit `h1c2…`). If `/commands` needs help, use a partial expression index: `(event_data->>'command') WHERE event_type = 'terminal_command'`. Correct the docstring. |

### PF3 — Owner analytics filter on unindexed timestamps

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | P3 |
| **Location** | `server/routes/analytics_routes.py:61,68,77,89,133,226` and the `/llm` queries |
| **The "Why"** | Every panel filters `created_at >= since` or `started_at >= since`, but the event indexes lead with `session_id`, so each request is a sequential scan of a table that never shrinks. The module comment acknowledges this. |
| **The Fix** | Add `(event_type, created_at)` on `user_activity_events` and `(started_at)` on `user_sessions`, via a new Alembic migration. |

### PF4 — Redundant single-column indexes

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | P3 |
| **Location** | `server/models/event.py:16`; `server/models/ai_conversation.py:9`; `server/models/password_history.py:9`; `server/models/one_time_token.py:22` (`index=True` on a column that already leads a composite index) |
| **The "Why"** | Each duplicates the leading column of a composite index on the same table, so every write pays for it and no read benefits. |
| **The Fix** | Drop the four single-column indexes in one migration and remove `index=True` from the models (`alembic check` then stays green). |

### PF5 — Per-event INFO logging in the ingest path

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | P3 |
| **Location** | `server/services/kafka_stream.py:327` (`broadcasting_event`), `:796` (`kafka_message_received`) |
| **The "Why"** | Two JSON log lines per event on the hottest path, which dominates log volume and serialisation cost. |
| **The Fix** | DEBUG level, or sampled counters surfaced through `pipeline_snapshot()`. |

### PF6 — The funnel subquery is evaluated three times

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | P3 |
| **Location** | `server/controllers/event_controller.py:352-416`; `server/routes/analytics_routes.py:121-174` |
| **The "Why"** | The same `ordered` window-function subquery is executed separately for steps, transitions and total, which is three scans and three window sorts. |
| **The Fix** | One CTE, with the three aggregates as `UNION ALL` branches, or materialise it once per request. |

---

## 4. UI/UX

### U1 — The account menu is not keyboard-operable

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | **P1** |
| **Location** | `frontend/js/auth-ui.js:1450` (markup), `:1472-1494` (click-only handler), `:150-151` (focus fallback) |
| **The "Why"** | Signed in, the header's account control is a `<div aria-haspopup>` with no role, no `tabindex`, no key handler, and an accessible name of one initial. Keyboard and switch users can't reach Logout, Setup 2FA, Active Devices, Change Password or Delete Account, a WCAG 2.1.1 (Level A) failure. The dialog-close focus fallback calls `.focus()` on this div, which does nothing, so focus is lost to `<body>`. `visual-header.md` #14 changed its size only. |
| **The Fix** | Use `<button type="button" id="nav-user-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu for {name}">`, with Escape and arrow-key handling in the dropdown, and focus returned to the button on close. |
| **Status** | ✅ **Resolved** |
| **What changed** | `#nav-user-btn` is a `<button type="button">` with `aria-expanded` and `aria-controls`, named "Account menu for {name}" through `setAttribute`, since the username is user input and the header is built with `innerHTML`. Opening focuses the first item; ArrowUp, ArrowDown, Home and End move between items; Escape closes and returns focus to the button; Tab out closes without moving focus. Choosing an item closes the menu and focuses the button before the item's dialog opens, so the dialog returns focus there. **Differs from the suggested fix:** a disclosure, not `aria-haspopup="menu"`: every other header panel is a disclosure, and a `menu` role commits the control to arrow-only navigation. Also fixed: the items used to close the panel but leave `aria-expanded="true"`. Four tests in `auth-nav-session.test.js`, including one that closes the dialog and checks where focus lands. |

### U2 — Predictors throw focus to `<body>` on every pick; World Cup rows have no role or state

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P2 |
| **Location** | `frontend/worldcup.html:1977,2163,2424` (re-render via `innerHTML = ""`), `:2186-2187` and `:2452-2453` (rows: `tabindex` + `aria-label`, no role or state); `frontend/ucl.html:2738` (same re-render). `ucl.html:2701-2703` is the correct pattern |
| **The "Why"** | Each Enter or arrow keypress destroys the focused element, so keyboard users Tab back from the top after every pick. That makes ordering 48 teams or picking 32 ties impractical (WCAG 2.4.3). On `/worldcup`, a `div` with an `aria-label` and no role is often not announced at all, and the chosen team is shown by a CSS class only (WCAG 4.1.2). |
| **The Fix** | Remember the focused row's key, re-render, then refocus the matching node, as `ucl.html`'s league reorder already does with `pendingFocusRank`. Give World Cup rows `role="button"` and `aria-pressed`, and wildcard cards `role="checkbox"` and `aria-checked`. |

### U3 — The chat is announced wrongly to screen readers

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P2 |
| **Location** | `frontend/index.html:2023,2096` (static `aria-label="Send message"`), `frontend/js/chat.js:1644-1647,1654-1657`; `index.html:2003,2086` (`aria-live="polite"` on the message lists) with `chat.js:15,1960,1964`; `chat.js:1246-1248`; `chat.js:2294-2316` |
| **The "Why"** | (1) While streaming, the button becomes Stop, but its static `aria-label` wins over the updated `title`, so it is still announced as "Send message". (2) The reply bubble's `innerHTML` is replaced every 100 ms **inside** a live region, and `aria-busy` is set on the input rather than the list, so screen readers may re-read fragments repeatedly. (3) The "response truncated" warning is an icon with only a `title`, so screen-reader, touch and keyboard users never learn the answer was cut off. (4) Announcements are made by creating a live region that already contains the text, which several screen readers ignore. The permanent `#route-announcer` goes unused for them. |
| **The Fix** | Toggle `aria-label` along with the icon. Set `aria-busy="true"` on the message list while streaming, clear it at the end, and announce "Response received" once. Render the truncation as visible text, or with an `sr-only` sibling. Announce through the existing `#route-announcer`. Screen-reader behaviour was not tested with real assistive technology; see Unverified. |

### U4 — Keyboard focus is invisible on the Dev Tools panels and outputs

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P2 |
| **Location** | `frontend/cron.css:407-409` and `frontend/crypto.css:249-251` (`.panel-container:focus { outline: none; }` on `tabindex="0"` panels: `cron.html:165,346,515`, `crypto.html:219,374,552,664,852,931`); `crypto.css:803-812,990-999` (`.hash-input`, `.field-output`) |
| **The "Why"** | These are Tab stops with no visible focus and no `:focus-visible` replacement (WCAG 2.4.7). |
| **The Fix** | Replace with `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }`, using whatever token the apps' shared chrome uses. |

### U5 — Three apps die when browser storage is blocked

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | P2 |
| **Location** | `frontend/worldcup.html:2671-2682` (unguarded `localStorage`, called at `:1878` before first render); `frontend/js/crypto/crypto-main.js:70`; `frontend/js/cron/cron-main.js:287` |
| **The "Why"** | With storage blocked or full, `/worldcup` renders nothing and every pick throws. `/crypto` never wires its tabs. `/cron` loses its theme toggle. `uiux.md` fixed this class of bug for the SPA, and `/json`, `/diff` and `/ucl` guard it. |
| **The Fix** | Wrap reads and writes in `try/catch`, as `ucl.html:3062-3077`, `json-main.js:82` and `diff-main.js:72` do, or use one shared safe-storage helper from `app-shared/`. |

### U6 — Dev Tools widgets have missing or wrong semantics

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P2 |
| **Location** | `frontend/crypto.html:348-354`, `frontend/json.html:236-242` (unlabelled file input inside `role="button"`; `diff.html:187` is correct); `frontend/js/diff/diff-ui.js:464-469`; `frontend/js/app-shared/app-shortcuts.js:107-112,156-157`; `frontend/js/app-shared/app-switcher.js:65,92-97`; `frontend/js/crypto/crypto-ui.js:157-163`; two-press confirm in `worldcup.html:3158-3166`, `ucl.html:3390-3396`, `diff-ui.js:542-551`, `json-main.js:176-185`, `crypto-ui.js:652-661` |
| **The "Why"** | (1) A hidden file input remains a Tab stop with no name, nested inside another control. (2) Diff's Split/Unified toggle has no `aria-pressed`, unlike the other apps. (3) The shortcuts sheet declares `aria-modal="true"` but doesn't trap Tab or make the page inert. (4) The Apps menu uses `role="menu"` without arrow-key behaviour, and all 11 items stay in the Tab order. (5) `/crypto` results and errors land in a read-only field with no live region. (6) The armed "Confirm?" state changes `innerHTML` under a fixed `aria-label`, so it is never announced, and it times out after 3–4 s. |
| **The Fix** | Add `aria-hidden="true" tabindex="-1"` to the inputs (the `diff.html` pattern). Add `aria-pressed`. Trap focus with the shared `handleFocusTrap` (`frontend/js/modal.js`). Drop the `menu` roles for a plain `nav`/`ul` of links, or implement roving focus. Add a `role="status"` region to `/crypto`. Update `aria-label` when a confirm button is armed. |

### U7 — Touch targets are too small or overlap

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P2 |
| **Location** | `frontend/auth-modal.css:569-570` (show/hide password, 20×20 px, inside the input); `frontend/worldcup.html:662-684`, `frontend/ucl.html:614-635` (up/down arrows whose extended hit areas overlap) |
| **The "Why"** | The password toggle is below WCAG 2.5.8's 24 px, and the spacing exception doesn't apply because it overlaps the field. It is also well under the project's own 44 px target. On phones, the bottom few pixels of a "move up" arrow belong to the "move down" arrow painted over it, so the team moves the wrong way. This comes from reading the CSS geometry, not from measuring on a device. |
| **The Fix** | Make the toggle 44×44 px with padding in the input's right inset. Make the arrow hit areas meet at the midline, for example with `::before` insets that stop at half the gap. |

### U8 — Reduced-motion setting is ignored by confetti and JS scrolling

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P2 |
| **Location** | `frontend/js/confetti.js:6-23` (called from `frontend/js/form.js:389` with no guard); `frontend/worldcup.html:2874-2925` and its animations (no `prefers-reduced-motion` rule; `ucl.html:1487-1496` has one); `behavior: 'smooth'` in `frontend/js/chat.js:1174,1185-1188`, `cron/cron-main.js:99-103`, `crypto/crypto-main.js:109-113`, `diff/diff-ui.js:329`, `terminal/palette.js:192` |
| **The "Why"** | A 150-particle, full-viewport canvas animation plays for 3 s after every contact submission, and JS-initiated smooth scrolling bypasses the global CSS `scroll-behavior: auto`. Both ignore a stated OS preference (`config.js` already exports `prefersReducedMotion`). |
| **The Fix** | Return early from `triggerConfetti` when `prefersReducedMotion()` is true. Pass `behavior: prefersReducedMotion() ? 'auto' : 'smooth'`. Add a reduced-motion block to `worldcup.html` that mirrors `ucl.html`'s. |

### U9 — World Cup share link is ignored for returning visitors

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (UX) |
| **Severity** | P2 |
| **Location** | `frontend/worldcup.html:1878-1881` (compare `ucl.html:3420`) |
| **The "Why"** | Saved picks are loaded first and the `?s=` link is read only when there are none. Someone opening a friend's shared bracket sees their own bracket, with no message. `/ucl` gives the link priority. |
| **The Fix** | Prefer the URL state, and offer "Restore my saved bracket" as a secondary action, as `/ucl` does. |

### U10 — Feedback states that report the wrong thing

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (UX) |
| **Severity** | P3 |
| **Location** | Copy fallbacks: `frontend/js/cron/cron-ui.js:438-457`, `frontend/js/cron/regex-ui.js:367-385`, `frontend/js/crypto/crypto-ui.js:60-81`, `ucl.html:3344-3355`, `worldcup.html:3197-3208`. Chat status: `frontend/index.html:2073`. Toasts: `worldcup.html:1851-1868`, `ucl.html:2203-2219`, `cron-main.js:35-50`. Diff file load: `frontend/js/diff/diff-ui.js:333-344`. `/` shortcut: `frontend/js/app-shared/app-shortcuts.js:28-35` |
| **The "Why"** | "Copied!" shows even when the fallback copy failed; only `/json` says "Copy failed". The chat widget always says "Online" in green, even offline or with no API configured. Toasts vanish after 2.2–3 s with no dismiss control or hover pause, which is `uiux.md` #2's issue again in files that review didn't cover. `/diff` uses `alert()` for large files and has no handler for read errors. `/` calls `preventDefault()` and focuses an input inside a hidden tab, swallowing the keystroke. |
| **The Fix** | Check the fallback's return value. Drive the status from `navigator.onLine` and `isApiConfigured()`. Reuse the SPA's dismissable toast. Show an inline status in `/diff`. In `/`, check the target is visible before claiming the key. |

### U11 — Heading, landmark and naming structure

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | P3 |
| **Location** | `frontend/index.html:1113→1132`, `1356→1361`, `1432→1455`, `1626→1698`, `1764→1842` (h1 → h3); no `<h1>` in `cron.html:74`, `crypto.html:75`, `diff.html:66`; `/json`'s h1 is "Source document" (`json.html:195-197`); `arcade.html` has no `<main>`; label-in-name mismatches (`crypto.html:93-99`, `index.html:859-862`, the predictors' Random Fill); `index.html:2163-2164` (`<a href="#">` used as buttons); `frontend/js/terminal/palette.js:119-123,159` |
| **The "Why"** | Five SPA views skip a heading level, and three apps have no top-level heading for screen-reader navigation. Voice-control users can't activate "Share" or "Ask AI" by their visible text (WCAG 2.5.3). 73 of 165 Font Awesome icons in `index.html` lack `aria-hidden`. The command palette's empty state leaves `aria-activedescendant` pointing at an id that no longer exists. |
| **The Fix** | Promote the h3s, make the app titles `<h1>`, wrap arcade in `<main>`, start each `aria-label` with its visible text, use `<button>` for the two auth actions, clear `aria-activedescendant` on the empty state, and bulk-add `aria-hidden="true"` to decorative icons. |

### U12 — Inconsistencies between apps

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (UX) |
| **Severity** | P3 |
| **Location** | `frontend/arcade.html:97` (Back link lacks `.back-btn`) + `frontend/js/app-shared/app-switcher.js:43-44` (`if (!back) return null`) + `frontend/js/arcade/shell.js:506`; `cron.html:2`, `crypto.html:2`, `json.html:2`, `diff.html:2` (`data-theme="dark"` hard-coded) |
| **The "Why"** | `/arcade` calls `initAppSwitcher` and silently gets nothing, so the Apps menu from the closed `apps-uiux.md` H2 is missing there, and the tests mount it only on `/diff` and `/cron`. The four Dev Tools apps paint dark, then switch to a saved light theme after `DOMContentLoaded`, a visible flash the SPA and predictors avoid with an inline pre-paint script. The confirm timeouts differ (3 s vs 4 s), and `/crypto` uses `.confirming` where the others use `.is-confirming`. |
| **The Fix** | Add `.back-btn` to arcade's Back link and a switcher test for it. Add the predictors' pre-paint theme snippet, which adds a CSP hash only if those pages gain a CSP. Standardise the confirm timeout and class. |

---

## 5. Claude setup

**Checked against current docs and conformant, so not findings:**

- Subagent frontmatter: `omitClaudeMd` (v2.1.271+), `maxTurns`, `skills`, `model: sonnet`, and `tools` as a YAML list are all documented.
- Hooks: `statusMessage` is a documented field.
- `$CLAUDE_PROJECT_DIR` quoting is correct.
- `.claude/CLAUDE.md` imports `AGENTS.md` with `@../AGENTS.md`.
- The `Read(!**/.env.example)` carve-out works in practice: reading `.env.example` succeeds under the deny list.
- The ten skills mirrored in `.agents/skills/` are byte-identical.
- `check_agent_config.py` passes.
- The four `Deprecated.` stubs (`.codex/`, `.amazonq/`, `.antigravity/`, `AI_CONTEXT.md`) correctly point to `AGENTS.md`.
- **`.mcp.json`:** absent. The project defines no MCP servers, so there is nothing to review.
- **Still open from `claude-setup.md`:** #11, `allowed-tools` on `testing`/`verify`, marked "Blocked — needs owner approval".

### CS1 — "Read-only" subagents have unrestricted Bash

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P2 |
| **Location** | `.claude/agents/backend-reviewer.md`, `frontend-reviewer.md`, `security-reviewer.md`, `verifier.md` (`tools: [Read, Grep, Glob, Bash]`) |
| **The "Why"** | All four describe themselves as read-only, and `disallowedTools` removes Write/Edit/NotebookEdit, but Bash can still `sed -i`, redirect and `git commit`. The docs say that when the main session is in `acceptEdits`, `auto` or `bypassPermissions` (the usual mode for web sessions), the subagent runs in that mode and **its own `permissionMode` is ignored**, so `permissionMode: plan` wouldn't hold. The project-level Bash guard protects only migrations, templates, secrets and egress. |
| **The Fix** | Use the documented subagent-scoped hook. `_bash_targets.parse` already extracts write targets from a command, so reuse it in a new `.claude/hooks/readonly-bash.py` that exits 2 when `targets` is non-empty or the command is opaque (`bash -c`, `eval`). Register it in each agent's frontmatter. `check_agent_config.py` should validate the new hook script and its registration. |

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/readonly-bash.py"
```

### CS2 — REVIEW.md's ADR-023 check looks at the wrong layer

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P3 |
| **Location** | `.claude/REVIEW.md:11`; `.claude/skills/security-audit/SKILL.md` |
| **The "Why"** | The rule asks whether the **frontend** sends model ids, system prompts or token limits. The frontend doesn't. The API accepts them, so S1 passes every review the policy drives. The security-audit checklist has no item for it, and no backend test asserts that `model_id` is refused. |
| **The Fix** | Reword it as: "Does any request schema accept a model id, system prompt or token ceiling from the client?" Add the same line to `security-audit` and a pinning test to `tests/backend`. |

### CS3 — PreToolUse guards fail open

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P3 |
| **Location** | `.claude/hooks/protect-migrations.sh`, `.claude/hooks/protect-spa-egress.sh` (`set -euo pipefail` + `jq`) |
| **The "Why"** | Per the hooks docs, only exit 2 blocks. Any other non-zero exit is a "non-blocking error" and the tool call **proceeds**. A missing `jq` (exit 127), malformed input or an unexpected `jq` error therefore waves through the edit these hooks exist to stop. `jq` is present in this container, so this is defence in depth. |
| **The Fix** | `trap 'echo "guard error; refusing" >&2; exit 2' ERR` at the top of both guards, plus a `command -v jq >/dev/null \|\| { echo "jq required" >&2; exit 2; }` check. |

### CS4 — Egress guard misses protocol-relative URLs

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P3 |
| **Location** | `.claude/hooks/protect-spa-egress.sh` (`grep -oE 'https?://…'`); the same regex family in `protect-bash-writes.py` |
| **The "Why"** | `<script src="//cdn.example.com/x.js">` contains no `http`, so it passes the ADR-016 guard. The CSP would still block it at runtime, but the guard is meant to catch it at edit time. |
| **The Fix** | Match `(https?:)?//[host]` in `src=`/`href=`/`url(` contexts. |

### CS5 — README.md drift is checked by CI but not by the hooks

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P3 |
| **Location** | `scripts/check_docs.py:170` (reference-table regex matches root `README.md`); `.claude/hooks/verify-docs.sh:13-18`; `.claude/hooks/verify-bash-edits.py:28` (`DOCS_COVERED`) |
| **The "Why"** | Editing `README.md` can drift its token figure in `.claude/rules/reference-docs.md`, but neither PostToolUse hook watches `README.md`, so the drift first appears in CI. That is the gap the hooks exist to close. |
| **The Fix** | Add `README.md` to both pattern lists. |

### CS6 — The vendored `accessibility` skill description is garbled upstream

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P3 |
| **Location** | `.claude/skills/accessibility/SKILL.md:3-4` (digest `d8578fe7…` matches `.claude/ecc/install-state.json`, ECC 2.2.1) |
| **The "Why"** | The folded description reads "…screen-reader support. standards. Use this skill…", and it spends always-loaded description tokens on iOS/Android scope this repo doesn't have. The file matches upstream, so this is an ECC bug, not a local edit, and `docs/ECC.md` rightly forbids hand edits. |
| **The Fix** | Report it upstream and pick up the fixed version with `npx ecc-universal … --skills accessibility`. If upstream is slow, record a deliberate local override in `docs/ECC.md` so `check_agent_config.py` expects the new digest. |

### CS7 — A stale IDE artifact is committed

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | P3 |
| **Location** | `.antigravity/antigravity-ide/brain/1c01715d-7fc3-4e95-ac02-e30a6ec898bf/task.md` |
| **The "Why"** | This is a half-finished task list from another agent's session. It refers to `server/routers/auth.py`, which doesn't exist. Any tool that indexes the folder picks up instructions that are obsolete. |
| **The Fix** | `git rm` it and ignore `.antigravity/antigravity-ide/`. |

---

## Accepted risks confirmed (not scored)

Each of these was re-checked and still matches its documentation:

- Access tokens can't be revoked for their 30-minute life (`SECURITY.md` token table).
- Rate limiting is in memory and per instance (ADR-012).
- No CAPTCHA.
- No HSTS.
- No 2FA recovery codes.
- `totp_secret` is stored in plaintext.
- HIBP fails open.
- The deploy SSH host key is trust-on-first-use without `EC2_HOST_KEY`.
- No retention sweep for events, sessions or used tokens (`DATABASE.md`). S8 is scored separately because it breaks a promise the UI makes to the user.

## Checked and clean

- **Chat rendering:** all bot HTML goes through `marked` → `DOMPurify.sanitize`, with an `escapeHTML` fallback. User bubbles, the session list, owner analytics and the activity rows use `textContent` or `escapeHTML`.
- **DOM sinks:** no `insertAdjacentHTML`, `outerHTML`, `document.write`, `srcdoc` or page-side `message` listener anywhere in `frontend/js`.
- **CSP hashes:** the three pinned hashes match. `script-src` has no `unsafe-inline`, and `object-src 'none'` is set.
- **Service worker:** never caches `/api/` or non-GET requests; the cache name is content-hashed; `sw.js` is served `no-store`.
- **Refresh rotation:** atomic server-side, and single-flight within a tab.
- **Chat history:** ownership is enforced in the `WHERE` clause; a foreign `conversation_id` gets a 404 before streaming.
- **Session capability tokens:** HMAC with domain separation, constant-time compare, an identical 403 for unknown or forbidden sessions, and cookie-backed EventSource.
- **Contact form:** CR/LF rejected in the subject name; `formataddr` for `Reply-To`; honeypot enforced server-side.
- **Bedrock streaming:** runs off the event loop through a bounded queue, and the concurrency slot is released on both the generator and background-task paths.
- **SQL:** parameterised everywhere; no `shell=True`; `scripts/sqls/activity.sql` is a read-only SELECT.
- **CI:** no `pull_request_target` or `github.event.*` in `run:`. Deploy is gated on all checks and pins the tested SHA. Migrations get a single-head check, `alembic check`, and a downgrade/upgrade round trip.
- **Dependencies:** the pinned Python set shows no PyPI advisories (fastapi 0.141.1, starlette 1.6.0, h11 0.16.0, python-multipart 0.0.32, pyjwt 2.13.0, sqlalchemy 2.0.52, pillow 12.3.0, urllib3 2.7.0). The vendored DOMPurify 3.4.14 and marked 15.0.12 are byte-identical to `node_modules`. The `npm audit` highs are all transitive dev tooling that never ships.
- **Committed secrets:** none found in tracked files. The clone is shallow, 50 commits deep.

## Unverified

- **Apache vhost (not in the repo):** does it set `X-Forwarded-Proto`? That decides whether the analytics session cookie gets `Secure` (`server/controllers/session_controller.py:70` reads `request.url.scheme`, and `mod_proxy` doesn't send the header by default). Also unknown: whether `.htaccess` headers apply to proxied `/api` responses.
- **Production environment:** the values of `CORS_ORIGINS` (if unset, ten localhost origins are allowed with `allow_credentials=True`) and `DEFAULT_MODEL_ID`, and whether Claude 3.5 Sonnet v2 is still enabled on the account (S1).
- **C7:** that GitHub Actions treats a job timeout as `cancelled()` rather than `failure()` for step conditions. Stated from documented behaviour and not reproduced.
- **U3 and U7:** screen-reader and touch behaviour were inferred from code and CSS. They were not exercised with assistive technology or on a device.
