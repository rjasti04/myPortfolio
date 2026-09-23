# JavaScript Module Reference

Every ES module under `frontend/js/`, with its real
exports and responsibilities. Modules are plain ES modules with no build-time
syntax; `frontend/` runs directly in a browser.

- [Module graph](#module-graph)
- [Entry points](#entry-points)
- [Core services](#core-services)
- [Feature modules](#feature-modules)
- [The command prompt](#the-command-prompt)
- [UI and interaction](#ui-and-interaction)
- [Visual effects](#visual-effects)
- [Logic Inspector (`/cron` and `/regex`)](#logic-inspector-cron-and-regex)
- [Crypto & Encoders (`/crypto` and `/encode`)](#crypto--encoders-crypto-and-encode)
- [Browser storage keys](#browser-storage-keys)
- [Conventions](#conventions)

---

## Module graph

```
  index.html
     ├── vendor/purify.min.js          (classic, defer → global DOMPurify)
     ├── vendor/marked.min.js          (classic, defer → global marked)
     ├── js/app-logic.js               (classic, defer → window.AppLogic)
     ├── js/theme-bootstrap.js         (classic → replays custom palette)
     ├── js/auth-ui.js   ── module entry ──► auth.js ──► analytics.js
     │                                        modal.js, navigation.js
     └── js/main.js      ── module entry ──► navigation, theme, form, animations,
                                             hero-title, tilt, terminal/, analytics,
                                             skills-carousel, ripple, scroll-to-top,
                                             theme-customizer, error-handler, resume-pdf
                                               │
                                               ├─ dynamic ─► chat.js       (first AI interaction)
                                               └─ dynamic ─► activity.js   (first Activity interaction)
```

`analytics.js` is the hub: it owns `API_BASE`, `apiFetch`, the session and its
capability token, and `trackEvent`. Anything talking to the API imports from it.

---

## Entry points

### `main.js` (333 lines)

Wires everything on `DOMContentLoaded` and owns the lazy-loading policy.

- Installs `window.onerror` and `unhandledrejection` handlers that forward to
  `reportClientError`. `preventDefault()` is called **only** for the network
  case it actually handles with a toast — calling it unconditionally suppressed
  every unhandled rejection from the console.
- Eager init, each call wrapped by `boot(name, init)` so one module's failure
  costs its own feature and nothing else. They used to run as a bare sequence
  in one handler, which meant they shared a fate: `initTheme` reading blocked
  storage was enough to skip `initAnimations` four calls later, leaving every
  `.reveal` element at `opacity: 0` — the contact form, both Apps tiles and the
  About cards as blank space. Failures report through `reportClientError`.
  In order: theme, navigation, contact form, hero title, animations, tilt,
  terminal, analytics, skills carousel, ripple, scroll-to-top, theme customizer,
  and both `PullToRefresh` instances — `#ai .ai-content-area` first (it marks
  itself `[data-ptr-scroller]`, which the second one reads), then
  `document.scrollingElement`. Eager because `chat.js` is lazy and a visitor
  landing on `/#ai` can pull before it has loaded.
- Lazy loaders for `chat.js` and `activity.js`, triggered by a click on the
  relevant nav target, by the section gaining `.active` (via `MutationObserver`),
  or by the matching location hash. Each delegated document listener is bound to
  an `AbortController` and removed once its module resolves — otherwise the
  listener runs on every click in the viewport forever.
- Background layer selection: **gone.** `main.js` no longer mounts an animated
  background on any device, so there is no capability gate, no viewport gate and
  no route listener for it, and the two canvas modules that painted it have been
  deleted.
- Service-worker registration, an update check every 60 s, and the update
  banner whose button posts `SKIP_WAITING` and reloads on `controllerchange`.
  One banner node for the life of the page, with a dismiss control and its
  listener bound to the element: every `updatefound` used to append another
  banner carrying the same `id`, so `getElementById` found the first and the
  newest banner's Refresh did nothing.

### `auth-ui.js` (1,588 lines)

`export async function initAuthUI()` — one large function owning the entire
account surface: modal tabs (login / register / forgot), password strength
meter and requirement checklist, confirm-password matching, visibility toggles,
2FA enrolment with the QR code and the manage panel that turns it back off,
active-session list with per-session and
"log out everywhere else" revocation, change password, delete account, magic-link
and reset-token handling from query parameters, and the injected profile
dropdown in the header (`setupNavUI`).

Loaded as its own esbuild entry so the account UI is available without waiting
for `main.js`.

### `app-logic.js` (46 lines)

A **classic script**, not a module. Assigns `window.AppLogic` and also exports
via `module.exports` so the Node test runner can `require` it.

| Export | Role |
| :--- | :--- |
| `setActiveSection(target, sections, navLinks)` | Toggle `.active` and manage `aria-current` |
| `getValidHashTarget(hash, getElementById, fallback = "about")` | Resolve a hash to a real section id |

### `theme-bootstrap.js` (36 lines)

Classic script. Replays a saved custom palette from
`localStorage.rj_theme_palette` onto `document.body` inline properties before
the modules run, and seeds the `theme-color` meta from that palette's
`--accent-fill` in the same pass — otherwise a saved theme launches on the
shipped citron browser bar until `applyTheme()` runs at DOMContentLoaded, which
is most visible in the installed PWA. It takes the value from the palette
rather than a computed style: this runs before first paint, so there may be
nothing resolved to read.

---

## Core services

### `config.js` (52 lines)

Media queries, the contact address, and the bridge from the CSS motion scale
into JS. **Does not** hold `API_BASE`.

| Export | Value |
| :--- | :--- |
| `CONTACT_EMAIL` | `inboxtorj@gmail.com` — also hardcoded in `index.html` (mailto links, structured data, connect menu); keep them in sync |
| `prefersReducedMotion` | `(prefers-reduced-motion: reduce)` |
| `prefersDarkScheme` | `(prefers-color-scheme: dark)` |
| `compactViewport` | `(max-width: 1150px)` |
| `supportsHover` | `(hover: hover) and (pointer: fine)` |
| `mobileDevice` | `(pointer: coarse) and (max-width: 768px)` — phones only; iPads are 768px+ in portrait and laptops always have a fine pointer |
| `motionMs(name, fallbackMs)` | A `--motion-*` token as milliseconds, e.g. `motionMs("base", 180)`. Reads the computed value off the root element and caches per token; returns the fallback when the property is absent or unparseable, which is the case under jsdom and before the stylesheet applies. Exists so JS animating alongside CSS reads the scale rather than restating it — see ADR-025 |

### `analytics.js` (599 lines)

API base resolution, session lifecycle, the event queue, and request telemetry.

| Export | Role |
| :--- | :--- |
| `API_BASE` | `let` binding from `getApiBaseUrl()`; reassigned if a localhost health check fails |
| `isApiConfigured()` | Whether a base URL is set at all |
| `apiFetch(url, options)` | `fetch` with `mode: "cors"` and the `X-Session-Token` header attached centrally, so no call site can forget it |
| `ensureSession()` | Start a session if needed; resolves `true` even when tracking is blocked, so chat still works |
| `trackEvent(type, data)` | Queue an event; flush at the size threshold |
| `initAnalytics()` | Attach global listeners, restore or start a session |
| `onTelemetry(observer)` | Subscribe to per-request timing samples; returns an unsubscribe function |
| `withSessionToken(url)` | **Identity function.** Kept as the single place that decides how the stream authenticates — it used to append `?session_token=`, which put a bearer credential into access logs and browser history |

**API base resolution** — `localhost`/`127.0.0.1`/`[::1]` →
`http://localhost:8000` (with a `/health` probe that falls back to production);
hostname containing `staging` → `https://staging-api.rjasti.com/api`; origin
containing `www.` → `https://www.rjasti.com/api`; otherwise
`https://rjasti.com/api`.

**Queue** — max 200 events, flushed at 10 queued, on a 2 s timer, on
`visibilitychange` → hidden, and on `pagehide` (with `keepalive`). Persisted to
`localStorage` under `rj_event_queue:<session_id>`. Namespacing matters: the
session id lives in `sessionStorage` (per tab) while the queue lives in
`localStorage` (shared), and each queued event carries a baked-in `session_id` —
under one shared key a second tab would restore the first tab's events, flush
them with its own token, and lose the whole batch to a 403. `initAnalytics`
purges foreign and legacy queues before restoring its own.

**Retry policy** — only `5xx` and `429` re-queue (bounded at 200). A `4xx` drops
the batch and logs which event types were lost.

**Auto-tracked events** — `page_view` (start, reload, `hashchange`), `click`
(delegated over `a, button, [data-track]`), `scroll_depth` (25/50/75/90/100 %,
once each, debounced 500 ms). Heartbeat every 60 s, with a `404` clearing the
stale session and starting a fresh one.

**Telemetry** — every bulk flush publishes `{roundTripMs, serverMs, networkMs,
count, reason, ok, at}` to `onTelemetry` subscribers. `serverMs` is parsed from
the `Server-Timing: app;dur=…` header; `networkMs` is the remainder.

### `auth.js` (437 lines)

Token storage and every authenticated call.

| Export | Role |
| :--- | :--- |
| `AUTH_TOKEN_KEY`, `REFRESH_TOKEN_KEY` | `rj_access_token`, `rj_refresh_token` |
| `getAuthToken()`, `setTokens(a, r)`, `clearTokens()` | `localStorage` accessors |
| `getErrorMessage(errorData, fallback)` | Normalises FastAPI's string / array `detail` shapes |
| `loginUser`, `registerUser`, `logoutUser` | Credential flows. `registerUser` returns the created `UserResponse` and signs **nobody** in — the address has to be confirmed first |
| `setup2FA`, `enable2FA(pw, code)`, `disable2FA(pw, code)`, `verify2FA` | TOTP enrolment, teardown and challenge. Enable and disable both re-authenticate with the password |
| `requestMagicLink`, `verifyMagicLink` | Passwordless sign-in |
| `requestPasswordReset`, `resetPassword`, `changePassword` | Password flows |
| `deleteAccount` | Soft delete |
| `fetchActiveSessions`, `revokeOtherSessions`, `revokeSpecificSession` | Session management |
| `authenticatedFetch(url, options)` | Bearer-attached fetch with a single-flight 401 refresh and retry |
| `isCredentialRejection(status)` | `401`/`403` only — separates a refused credential from an unanswered request |

`authenticatedFetch` is the important one. The server **rotates** refresh
tokens, so concurrent 401s each sending the same refresh token would have the
first win and the rest told the token was revoked — signing the user out
mid-session, with the last loser also overwriting the winner's new pair. A
module-level `refreshInFlight` promise makes every concurrent 401 share one
refresh, and it is cleared before awaiting callers resume so a later 401 starts
a fresh attempt. Guarded by `frontend/tests/auth-refresh.test.js`.

**Registration does not log anyone in.** `registerUser` used to call
`loginUser` straight after a 201 — correct when registration handed back a
usable account, but `authenticate_user` refuses an unconfirmed address and every
registration creates exactly that, so the login could never succeed. It returned
`403`, `registerUser` rethrew it, and `auth-ui.js` painted "Confirm your email
address" into the register form's **error** slot: no success toast, the dialog
still open, and `"Email already registered"` if the visitor tried again. It also
spent a second request on `/auth/login`, which shares the strict 5-per-minute
auth budget with `/auth/register`, on a call certain to fail. `registerUser` now
returns the created user, and the register panel paints `#register-success` with
a "check your inbox" message plus the same resend affordance the login panel
offers. Pinned by `frontend/tests/auth-register.test.js` and, server-side, by
`test_a_fresh_registration_cannot_log_in_until_it_is_confirmed`.

**Only a refused credential ends the session.** `refreshAccessTokenOnce()`
returns `{token, rejected}` rather than a bare token, and `clearTokens()` runs
only when `rejected` is set — that is, when `/auth/refresh` answered `401` or
`403`. Every other outcome leaves the stored pair alone: a `429` from the rate
limiter, a `5xx` while the database restarts, a `502` mid-deploy, or a fetch
that never completed. All of those used to be read as "the credential is bad"
and destroyed a refresh token still valid for thirty days server-side. The
symptom was reported as *refreshing the activity page logs me out*: that page
is the chattiest in the app, its repeated loads push the shared per-minute
budget over, and the `429` that came back was indistinguishable from a
rejection. `auth-ui.js` applies the same predicate to its `/auth/me` call on
load. Note that the rate limiter buckets by the direct peer unless
`TRUSTED_PROXY_IPS` names the reverse proxy, so behind Apache the whole site
shares one budget — see `docs/CONFIGURATION.md`.

### `utils.js` (228 lines)

| Export | Role |
| :--- | :--- |
| `escapeHTML(value)` | Escapes `& < > " '` by regex, not by DOM round-trip — six call sites interpolate into double-quoted attributes, and `page_path` reaching `activity-charts.js` is visitor-controlled *and persisted*, so a missed quote was a stored injection |
| `copyText(text)` | Clipboard API with a hidden-textarea fallback |
| `showToast(message, type)` | Toast with a close button, auto-dismissed after 3.2 s — a timer that *holds* while the toast has hover or focus (WCAG 2.2.1). `role="alert"` when `type` is `"error"`, `role="status"` otherwise: the container is already `aria-live="polite"`, so an error announced politely could queue behind other speech and be gone before it was read |
| `debounce(fn, delay)` / `throttle(fn, interval)` | Standard |
| `estimateTokens(text)` | Heuristic token count, weighted for words, punctuation, code fences and URLs |
| `onOnline(cb)` / `onOffline(cb)` / `isNetworkOnline()` | Connectivity observers |

### `error-handler.js` (68 lines)

| Export | Role |
| :--- | :--- |
| `reportClientError(error, context)` | Forward one client error to the analytics pipeline as a `client_error` event |

This module also carried a typed-error layer — `AppError`, `NetworkError`,
`APIError` and `ValidationError` plus `handleError`, `withErrorHandling` and
`retryWithBackoff`. Nothing ever imported any of it; the code that does raise
errors throws plain `Error`s and surfaces them with `showToast`. It was removed
rather than kept as a second, unused way to do what the code already does.

`reportClientError` rides the existing analytics pipeline rather than a
dedicated endpoint — no new surface, no new auth, no new table. It caps at
**10 reports per page load** and deduplicates by `name:message` signature,
because an error inside a render loop would otherwise become the outage. The
reported path is `pathname + hash`, never the query string: that can carry a
reset or magic-link token, and this payload is persisted.

---

## Feature modules

### `chat.js` (2,317 lines, lazy)

`export function initChat()` — one large initialiser driving **two surfaces**
from the same state: the floating chat widget and the full-page `#ai` section.

Constants: `MAX_SESSIONS = 50`, `TOKEN_LIMIT = 2000` (warn at 1500, error at
1950), `SUMMARIZE_TOKEN_THRESHOLD = 6000`, `MARKDOWN_PARSE_THROTTLE_MS = 100`,
`FREE_MESSAGE_LIMIT = 6` (**must match `CHAT_FREE_MESSAGE_LIMIT` server-side**).

Internals worth knowing:

| Area | Behaviour |
| :--- | :--- |
| Rendering | `renderBotHTML` = `DOMPurify.sanitize(marked.parse(text))`, degrading to escaped text with `<br>` if either global is missing |
| Message actions | `createMessageActions()` serves both surfaces, but the `#ai` page passes it only bot turns: a question there sits a scroll away from an always-visible composer, so Edit and Copy earned nothing beside it. The widget's bubbles still carry both on the visitor's own turns |
| Code blocks | A custom `marked` renderer injects a copy button carrying the source as a URI-encoded `data-code` attribute; a delegated document listener handles the copy |
| Highlighting | `syntax-highlighter.js`, not a library |
| Sessions | Up to 50 conversations in `localStorage` (`rj_chat_sessions`, `rj_chat_active_session`), with a sidebar for rename/delete/switch. Each carries `createdAt`/`updatedAt`; rows stored before those shipped fall back to `Number(session.id)`, which is the creation timestamp, so there is no migration |
| History rail | Rows are ordered by `updatedAt` and bucketed into Today / Yesterday / Previous 7 days / Previous 30 days / Older against local midnights, with an empty state for a cleared or unmatched list. The row's title is a real `<button>` — as a bare `<div>` with a click listener the whole history was unreachable by keyboard |
| Restore on load | `initChat()` ends in `restoreActiveSession()`. Without it, `loadSessions()` only reached that call through `createNewSession()`, so a returning visitor landed on the empty greeting while the rail listed the thread they had just been reading |
| Thread title | `renderConversationTitle()` writes the active session's title into the `#ai` top bar, hung off `renderSidebar()` and `restoreActiveSession()` rather than off each call site |
| Jump to latest | A scroll listener on `.ai-content-area` toggles `#ai-jump-btn` once the scroller is more than `JUMP_THRESHOLD_PX` clear of the bottom; `scrollToBottom()` re-syncs it, because a turn appended while the reader is scrolled up changes `scrollHeight` without firing a scroll event |
| Streaming | `authenticatedFetch` → `response.body.getReader()`, manual SSE line parsing, throttled markdown re-parse, `AbortController` for stop-generation |
| Metrics | The `{"type":"metrics"}` frame is kept **per turn** as well as on `window.lastStreamMetrics`. The per-turn copy is credited to the conversation once the turn produces text, so a later turn moving the global on cannot double-count it; the global stays for console debugging |
| Usage totals | `session.usage` (`inputTokens`, `outputTokens`, `latencyMsTotal`, `timedTurns`) accumulates each turn's metrics frame and renders into the `#ai` top bar as `in / out` and a mean latency. The strip is `hidden` until a turn has actually been measured - on an empty conversation `0 / 0` beside an em dash is the loudest pair on the bar and reports nothing. It lives on the session, so it survives a reload, follows the sidebar's selection and starts at zero on a New Chat; turns that never report a latency (a stopped generation) are left out of the mean rather than counted as 0 ms. Sessions stored before this shipped get the key lazily, with no migration |
| Summarisation | At `SUMMARIZE_TOKEN_THRESHOLD` estimated tokens, everything before the current message is sent to `/chat/summarize` and replaced by the summary |
| Conversation identity | Each session carries a local `id` (the `localStorage` key, still `Date.now().toString()`) **and** a `conversationId` v4 UUID sent as `conversation_id` on every turn. Without it `save_or_update_conversation` took its create branch each turn and wrote a fresh `ai_conversations` row holding the whole transcript so far - ten turns, ten rows. Two fields rather than one because stored sessions predate UUID ids, and reusing `id` would mean migrating the active-session pointer with them. `backfillConversationIds()` gives old rows one on load |
| Server history | For a signed-in visitor `syncServerHistory()` lists `GET /chat/history` on load and on `auth-changed`, merging server-only conversations into the rail as **stubs** (`remote: true`, `messages: []`). The listing carries summaries only, so `hydrateSession()` fetches `GET /chat/history/{id}` when a stub is opened, a 404 drops it (deleted from another device), and `deleteSession()` also issues `DELETE /chat/history/{id}` or the next sync brings it back. On a merge the local copy wins on title and transcript - it is the fuller one - and only `updatedAt` is reconciled. Anonymous visitors keep the pure-`localStorage` path; `POST /chat` stays deliberately anonymous |
| Clearing all history | **Delete all** was browser-only: it emptied `sessions` and `rj_chat_sessions` and left every `ai_conversations` row alone, so the next `syncServerHistory()` re-listed the whole account and the history reappeared. `deleteAllRemoteConversations()` now issues one `DELETE /chat/history` after the local clear. One request, not a loop over the rail: the listing is capped at 100 and `saveSessions()` truncates at `MAX_SESSIONS`, so anything older than the newest 50 is not in `sessions` to delete. A failed request paints a `renderTranscriptNotice()` alert rather than reporting a history that will come back as cleared, and a signed-out visitor calls nothing |
| Transcript states | A conversation arriving from the server and one that failed to arrive are both distinct from an empty one. `renderTranscriptNotice()` paints a `role="status"` spinner or a `role="alert"` error with a retry into **both** surfaces, so neither reports a failure as emptiness - the defect `activity.js` was audited for in `docs/review/uiux.md` finding 19 |
| Auth | A `401` while signed out dispatches `request-login-modal` rather than showing a raw error |
| Voice | Separate `SpeechRecognition` instances per input — a shared singleton had both mic buttons overwriting each other's `onresult` and routing transcripts to the wrong field. Buttons are hidden entirely when unsupported. Both composers are wired by one `setupVoiceInput()`: the mic opens a `.voice-bar` over the composer (cancel, an animated waveform sized to the row, stop, send), and every run ends in `onend` with an intent — `insert` writes the transcript to the field, `send` writes it and calls `requestSubmit()`, `cancel` (the X, Escape, or a recognition error) discards it |
| Waiting state | `createTypingIndicator()` renders an *indeterminate* indicator. It used to march "Initializing context -> Fetching profile data -> Querying Bedrock LLM" on a fixed 700 ms timer with nothing behind it, so a slow turn showed three completed steps while nothing had arrived and a fast turn showed steps for work that never happened. Waiting and streaming are the only two states this code can observe |
| Busy composer | `setInputState()` sets `readOnly` plus `aria-busy`, not `disabled`. The visitor is almost always focused in the composer when they press Enter, and disabling the focused element drops focus to `<body>`; both submit handlers already guard on `isGenerating`, so Enter cannot re-send. The refocus after a turn is gated on `#ai` still being the active section |
| Modality | The widget sets `aria-modal` while open and traps Tab with `handleFocusTrap` from `modal.js`. `body.chat-open` paints a scrim that takes pointer events, so it was already modal for a mouse while Tab walked out of it into a page the visitor could no longer click. It focuses the composer directly on open — it used to wait on a `transitionend` that never fires, because the global `.hidden` utility is `display: none !important` and an element leaving `display: none` runs no transition |
| Destructive actions | Deleting one conversation and clearing all history both go through `confirmAction` from `confirm-dialog.js`. Delete used to ask nothing while Clear All called the browser's blocking `confirm()` |
| Accessibility | `announceToScreenReader` for streamed replies. The conversation row menu carries `aria-haspopup`, a synced `aria-expanded`, `role="menu"`/`"menuitem"`, focus moved in on open and Escape returning it |

### `activity.js` (1,344 lines, lazy)

`initActivity()`, `loadActivity()`, `loadActivitySummary()`,
`loadActivityFunnel()`.

The section answers one question for the reader: *what has this site recorded
about my visit?* The whole session is fetched once (`limit=500`, the API's own
page ceiling) and held in memory, so every filter — search, family, time slice,
path — is local and instant, and the session strip has the complete series it
needs.

`loadState` (`idle | loading | ready | error`) drives the event stream's own
loading, empty and error painting. The two side panels load independently, so
they carry their own `summaryFailed` / `funnelFailed` flags: both used to
`return` on a bad status and log a throw to the console, which rendered a
failure as "No navigation recorded yet." and left the headline stats at `0` and
an em dash — placeholders reading as measurements. `renderPaths` takes a
`failed` option, and the stat grid marks unconfirmed figures.

**Five families over ten event types**, because five hues are learnable at a
glance and ten are a legend: `nav` (page_view, scroll_depth), `tap` (click,
terminal_command), `pref` (theme_change and other preferences), `reach`
(copy_email, contact_submission, contact_prompt) and `sys` (ai_llm_telemetry,
client_error). The grouping carries the colour encoding across the strip, chips,
dots and bars.

`sys` is the odd one out deliberately: telemetry and crash reports are things
the site recorded about itself, not things a visitor did, so it takes the only
neutral hue in the set. Those two and `contact_prompt` were missing from
`EVENT_FAMILY` entirely, so `familyOf` fell back to `nav` — a JavaScript crash
report rendered as Navigation, filed under the one label that hides it and
reachable only from the filter chip with nothing to do with it.

Also owns: the live SSE connection (`EventSource` with `withCredentials: true`
so the `HttpOnly` session cookie is sent even when the API is on another port),
frame normalisation between the compact and verbose shapes, the pipeline DAG
painted from `pipeline`/`hello` frames, a rolling 200-sample latency reservoir
fed by `onTelemetry`, focus restoration across re-renders, and paginated
grouped rows (`PAGE_SIZE = 20`).

### `activity-charts.js` (204 lines)

Pure paint helpers — `activity.js` owns all state; every export here renders
from a snapshot passed in.

| Export | Role |
| :--- | :--- |
| `TIMELINE_BUCKETS` (48), `FAMILY_ORDER`, `TIMELINE_PEAK_FLOOR` (3) | Shared constants |
| `bucketSession(samples, from, to, buckets)` | Per-family counts across the session span |
| `renderTimeline(root, buckets, options)` | The brushable session strip |
| `moveTimelineFocus(root, key)` | Keyboard navigation across buckets |
| `percentile(values, fraction)`, `latencyBand(ms)` | Pipeline chain health figures |
| `renderPaths(root, funnel, options)` | Ranked path rows |

Deliberately dependency-free: a bucketed strip and a ranked bar list are a loop
and some positioned elements, while a charting library would add 45–200 KB to a
PWA that precaches its whole shell. DOM rather than canvas, because every bar is
a filter control that needs to be a real focusable, labelled element. Colours
come from CSS custom properties, so both themes and any accent change flow
through without touching this file.

### `form.js` (448 lines)

`export function initContactForm()` — the contact section.

Validation with accessible per-field error elements, a live message counter
(warning at 90 % of the limit), a copy-email control, prompt chips that prefill
the message (emitting `contact_prompt`), and AJAX submission to
`https://formsubmit.co/ajax/<CONTACT_EMAIL>` with a 10 s timeout
(`SUBMIT_TIMEOUT_MS`). Offline submissions are blocked with a message rather
than attempted. The FormSubmit honeypot is excluded from validation but
forwarded in the payload. A timeout must not fall through to a native
resubmission — `frontend/tests/contact-form.test.js` guards that. Success fires
confetti and tracks `contact_submission`.

`aria-describedby` is treated as the token list it is: `#contact-message` also
points at its character counter, and assigning the error id over the top of it
used to detach "0 / 1200" permanently on the first error. Blur reports an
*empty* required field too, and submit runs `validateAllFields`, which renders
every inline error and focuses the first bad one, rather than handing off to
`reportValidity()` and its native bubble that no live region mirrors.

### `resume-pdf.js` (166 lines)

`export function initResumePdf()` — the in-page preview for the resume PDF,
opened from the Experience section.

The trigger stays a plain link in the markup. Without JS, on a touch device or
on iOS the click is left alone and the browser's own PDF viewer takes over;
only where an embedded viewer actually works is it intercepted and turned into
a dialog. Two constraints shape it: `index.html`'s CSP sets `object-src 'none'`,
so the viewer is an `<iframe>` under the `default-src 'self'` fallback, not an
`<embed>`; and the dialog lives outside `#resume .item` so it can size to the
viewport. iPadOS reports itself as `MacIntel` with touch points, so
`hover: hover` alone does not exclude it — `supportsEmbeddedPdf()` checks the
user agent too. On close the iframe element is dropped rather than pointed at
`about:blank`, which would leave the plugin's rendering surface alive behind
the closed dialog. The `src` comes from the trigger's `href`, because the build
content-hashes the PDF. Covered by `frontend/tests/resume-pdf.test.js`.

### `analytics`-adjacent: `syntax-highlighter.js` (67 lines)

`highlightCode(code, lang)` — regex highlighting for Python, JavaScript, SQL,
JSON, HTML and Bash/Shell, escaping first. Small enough to ship instead of a
highlighting library.

---

## The command prompt

`frontend/js/terminal/` — the interactive prompt in the About section, plus the
`Ctrl+K` command palette. Seven modules.

### `registry.js` (301 lines)

**Commands are data, not behaviour bolted onto a DOM closure.** Each descriptor
carries everything three surfaces need — the terminal, the mobile chip row and
the palette — so `help`, tab completion and the palette can never drift from
what is implemented.

```
name      string   the word typed
summary   string   one line, shown by `help` and the palette
usage     string   argument form, shown on misuse
hidden    boolean  omitted from help, completion and the palette
chip      boolean  surfaced as a tappable starter chip
complete  (ctx, partial, argIndex) => string[]
run       (ctx, args) => Node | Promise<Node> | void
```

`run` never touches `document` outside the output builders — every side effect
goes through the injected `ctx`, so a nav or theme refactor cannot silently
break a command the way a hardcoded `querySelector` once did.

Commands: `help`, `whoami`, `skills`, `stats`, `ls`, `cd`, `ask`, `ai`, `wget`,
`calc`, `echo`, `cowsay`, `fortune`, `history`, `matrix`, `theme`, `date`,
`clear`, `sudo`. `export const commands` is the list; `createRegistry(list)`
builds the lookup/completion surface.

### `math.js` (74 lines)

`evaluateMathExpression(expr)` — the arithmetic behind the `calc` command.

A recursive-descent parser over `+ - * / ( )` and numeric literals,
**deliberately not `eval`**: the grammar is the entire language, so no
identifier can ever be resolved and no visitor-supplied string can reach the JS
evaluator. Rejects malformed numbers, unbalanced parens, trailing input and
non-finite results by throwing.

### `output.js` (116 lines)

DOM-node builders — `line`, `text`, `err`, `pre`, `list`, `columns`, `tags`,
`frag`, `echoLine`. Every builder writes user-controlled strings through
`textContent`, **never `innerHTML`**, so escaping is structural: a command
handler cannot inject markup even if it forgets to sanitise.

### `history.js` (118 lines)

`createHistory({storage, key})` — bounded (100 entries), sanitised (non-strings
rejected, entries truncated at 500 characters individually so one oversized
entry never discards the list), debounced persistence (400 ms), and a one-time
migration from the v1 key. `export const STORAGE_KEY = "rj_terminal_history_v2"`.

### `keymap.js` (116 lines)

`Intent` (`SUBMIT`, `HIST_PREV`, `HIST_NEXT`, `COMPLETE`, `CLEAR`, `ABORT`,
`BLUR`, `NONE`), `intentFor(event)`, `commonPrefix(candidates)`,
`completeInput(raw, registry, ctx)`. Kept away from the DOM so the binding table
is testable and the palette can reuse the same vocabulary.

**Tab is claimed in one direction only.** `Shift+Tab` returns `NONE` and
`Escape` returns `BLUR`, and `index.js` declines to `preventDefault` a
completion on an empty prompt. Claiming Tab in both directions made
`#terminal-input` a keyboard trap (WCAG 2.1.2): focus could enter the About
prompt and never leave it without a mouse.

### `palette.js` (271 lines)

`initPalette({registry, run, panel, navigate})` — the `Ctrl+K` overlay. A second
renderer over the same registry, which is the payoff for modelling commands as
data: every terminal command is reachable site-wide with no duplicated list.
`role="dialog"`, `aria-modal`, focus restoration on close.

It searches page content on that same seam. `matches()` merges command hits
with hits from `CONTENT_INDEX` (`js/search-index.js`), capped at
`MAX_CONTENT_RESULTS = 6` so a broad word cannot push every command off the
list; commands always render first. A content result carries `section` and
sometimes `anchor`: selecting one calls the injected `navigate` — the same
`ctx.navigate` the `cd` command uses, so there is one router entry point rather
than two — then focuses the anchor with `tabindex="-1"` and scrolls to it.

The list stays one flat listbox. A group-header `<li>` between options is
invalid inside `role="listbox"`, so the kind is a badge *inside* each option
(`.cmd-palette-kind`), which a screen reader announces as part of the label.

Find-in-page is not a substitute: the router keeps one section in the DOM at a
time, so the browser never has the other seven to search.

### `owner-analytics.js` (310 lines, lazy)

`initOwnerAnalytics()` — the aggregate panel at the foot of the Activity
section. Everything above it is the visitor's own session, which is what the
section's intro promises; this reads across **every** session, so it is built
only after `/admin/analytics/*` confirms the caller is the owner. A 401 or 403
hides the panel and clears it, so the page never ships an empty shell of it to
a visitor — and signing out takes it down, or the next person at that browser
would see the previous owner's figures.

`activity.js` imports it dynamically and does **not** await it: a slow or
failing request for this must not hold up the dashboard the section actually
promises. It re-runs on `auth-changed`, which is exactly when the answer to
"is this the owner" changes.

The chart layer is reused unchanged. `renderPaths` from `activity-charts.js`
takes `{steps, transitions}`, which is the shape the cross-session funnel
endpoint returns — the payoff for those exports having been written as pure
paints over data rather than against session state.

A panel whose request failed renders a `role="alert"` card, not zeroes.
Rendering it as zeroes would report a measurement nobody took, which is the
defect `docs/review/uiux.md` finding 19 was written against.

### `search-index.js` (155 lines, generated)

`CONTENT_INDEX` — the entries the `Ctrl+K` palette searches alongside the
command registry. Each is `{section, title, text, kind}` plus an optional
`anchor`.

**Generated** by `scripts/generate_resume.py` from `content/resume.json` and the
section headings read back out of `index.html`. Do not hand-edit:
`npm run check:resume` fails CI when it drifts from the source. Section titles
and intros are read from the page rather than duplicated into the source file,
so a new section becomes searchable as soon as it is written.

### `index.js` (331 lines)

`initTerminal()` — owns all DOM wiring, the output log (capped at
`MAX_BLOCKS = 200`, because unbounded output left hundreds of nodes under a
`backdrop-filter` ancestor), rotating placeholders, the mobile chip row, the
matrix toggle (`rj_terminal_matrix`), and the `ctx` object handed to commands
(navigation via `navigateToSection`, theme via `toggleTheme`, analytics via
`trackEvent`).

---

## UI and interaction

### `navigation.js` (714 lines)

`initNavigation()`, `setActiveSection(target)`,
`navigateToSection(target, {updateHash})`, `syncSectionWithHash(hash)`,
`closeAllDropdowns()`.

Hash-based section routing, header state on scroll, the hamburger menu, dropdown
menus, the image modal, keyboard shortcuts, the mobile bottom nav, swipe
gestures between sections, and online/offline banners. `isModalOpen()` checks
**both** dialog implementations — `.image-modal.active` and
`#auth-modal:not(.hidden)` — or shortcuts would fire through an open dialog.

`setMobileMenuState()` owns the panel's focus and scroll behaviour. It moves
focus to `#nav-menu-close` on open, traps Tab via `handleFocusTrap`, returns
focus to the hamburger on close when focus is still inside, and takes the
reference-counted `lockBodyScroll` from `modal.js` rather than writing
`body.style.overflow`. On a phone this panel *is* the navigation, and it was
the only scrim-backed surface on the site with none of that.

The **mobile bottom bar is switched off.** It is fully styled and fully built,
but `--mobile-bottom-nav` in the design tokens is `0`, `bottomNavEnabled()`
reads that flag and `initMobileBottomNav()` returns early — so the stylesheet
and the DOM cannot disagree about whether a whole navigation surface exists.
Turning it on is that flag, `display: flex` in the MOBILE BOTTOM NAV region,
and `--mobile-bottom-nav-height` back to 56px in RESPONSIVE.

This module is not the *first* thing to route: it arrives through `main.js` and
does not run until `DOMContentLoaded`, so the inline pre-boot router in
`index.html` has already applied the fragment (see
[`FRONTEND.md`](FRONTEND.md#indexhtml)). Two things here close that handover.
`initNavigation()` adds `nav-ready` to `<html>` right after its first
`syncSectionWithHash()`; and `setActiveSection()` clears the pre-boot router's
`is-boot-target` marker — but only once `nav-ready` is up, so the marker
survives this module's own first sync (same target, same page) and dies on the
first real navigation, when the entrance animation should return.

The two routers also have to *agree*, or a refresh lands somewhere the first
paint did not. `syncSectionWithHash()` hands `getValidHashTarget` a
`resolveSection(id)` that looks the id up in `sections`, not
`document.getElementById`: the laxer question — "is there any element with this
id?" — said yes for `<main id="main-content">`, which is the skip link's own
target, so following the skip link, or reloading after having followed it,
routed to a "section" that is not one, deactivated all eight real ones and left
the page blank. The pre-boot router validates the same way, against the header
nav. The fallback is the section that is active *now* rather than a literal
`"home"`, which is the other half of the same fix: the skip link has to move
focus into `<main>` without navigating away from what the visitor was reading,
and on the first sync the active section is already the one the pre-boot router
chose — home included, since that is what the markup ships.

### `modal.js` (178 lines)

`openModal(modal, {initialFocus, onClose})`, `closeModal(modal, {restoreFocus})`,
`getFocusableElements(container)`, `handleFocusTrap(event, modal)`.

Focus trapping, focus return via a `WeakMap`, per-modal teardown callbacks, and
a **reference-counted** body scroll lock — nested opens must not each stash
their own scroll position, so only the outermost close restores the page.
Integrates `ModalSwipeDismiss` for touch.

`lockBodyScroll` / `unlockBodyScroll` are exported for the mobile nav in
`navigation.js`, which is not a `.active`-toggled dialog but needs the same
lock — it used to write `document.body.style.overflow` directly, which neither
preserves the scroll offset nor applies the `position: fixed` that is what
actually stops iOS scroll-chaining.

### `confirm-dialog.js` (114 lines)

`confirmAction({title, body, confirmLabel, cancelLabel, destructive})`, which
resolves to a boolean.

The site's one confirmation dialog, built on `modal.js` so it inherits the
focus trap, the reference-counted scroll lock, Escape and focus restore.
Cancel takes initial focus, so a stray Enter is never the destructive answer,
and dismissing by Escape or backdrop resolves `false` through the `onClose`
hook rather than leaving the promise pending.

It exists because destructive actions used to disagree about what
confirmation meant: clearing all chat history called the browser's blocking
`confirm()` — the only unthemed dialog in the codebase — while deleting a
single conversation and revoking a device session asked nothing at all.
Callers: `chat.js` (delete one chat, clear all history) and `auth-ui.js`
(revoke one session, log out all other devices).

### `swipe-handler.js` (448 lines)

`SwipeHandler`, `PullToRefresh`, `ModalSwipeDismiss`. `SwipeHandler` records
whether `touchstart` accepted the gesture, because `touchstart` and `touchend`
filtering independently on their own targets (which differ) produced phantom
swipes.

`PullToRefresh` is the site's **only** pull-to-refresh, on every page. It began
as a stand-in for the AI panel, which blocks the browser's own gesture:
`.layout` is `height: 100dvh`, `body` is `overflow: hidden` (which propagates
to the viewport, as no rule sets `overflow` on `html`), and `.ai-content-area`
sets `overscroll-behavior: contain` — so a downward drag never chains out to
the viewport and Chrome never sees the overscroll its pull-to-refresh is built
on. That left the gesture reading one way there and another everywhere else, so
the native one is now off site-wide (`overscroll-behavior-y: contain` on the
root and `body`, scoped to `.js-enabled`) and this drives all of it. It is also
the only version that works once the site is installed to a home screen.

Two modes, picked in the constructor from the element it is handed:

| | Nested scroller | Document scroller |
| :--- | :--- | :--- |
| Mounted on | `#ai .ai-content-area` | `document.scrollingElement` |
| Listens on | the element | `document` — a page pull can start on anything |
| Indicator | `.ptr-indicator`, absolute, on the positioned parent | `.ptr-indicator--viewport`, fixed under the header, on `body` |
| Marks itself | `[data-ptr-scroller]` | — |

The document instance stands down wherever the page is not what scrolls: a
touch starting inside a `[data-ptr-scroller]`, or a `body` whose computed
`overflow-y` is `hidden` (the AI shell, an open nav). Both would otherwise arm
off one touch and raise a second indicator, in a different place, on a page
that already has one.

`touchmove` is the only non-passive listener in the module, and it is bound
only for the length of a live pull — left bound on `document` it would make
every touch scroll on the site wait for JS. It cancels only while a pull that
started at `scrollTop === 0` is still heading down.

### `apps-filter.js` (140 lines)

`initAppsFilter()` — a category filter over the Apps shelf. The seven tiles
already displayed a category eyebrow (Football, Games, Dev Tools, Security);
this makes it a control. Reads `data-app-category` on the tile rather than the
eyebrow's text, so the visible label and the filter key are independent.

Counts on each chip are rendered in the markup so they are correct before this
module loads, then recomputed here — a category that ends up empty hides its
chip rather than offering a choice that shows nothing. Pressing the active chip
again clears the filter, because the row has no separate "clear" and a dead
control is worse than a redundant one. Each change is announced through
`#app-filter-status`, since the only other feedback is tiles disappearing.

Hiding sets **both** `hidden` and `.is-filtered-out`: `.app-tile` is
`display: flex` from the grid rules, and a display declaration beats the
`hidden` attribute's UA style, so the attribute alone would leave a hidden tile
laid out and tabbable.

The chip row is `js-only` — with scripting off the grid shows everything, which
is the right state for a launcher.

### `experience-groups.js` (96 lines)

`initExperienceGroups()` — the Experience section's seven bullet groups are
`<details>` elements emitted by `scripts/generate_resume.py`, with the first
shipped `open`. The collapsing needs no JavaScript; this module adds only what
`<details>` cannot do alone:

- **Expand all / Collapse all**, injected here rather than shipped in the markup
  because it does nothing without JS. Its label states what the next press will
  do, while `aria-expanded` reports the state of the set it controls — two
  different facts, and conflating them is why this kind of control usually
  announces backwards. A `toggle` listener on every group keeps the label honest
  when one is opened individually. It is appended to `#resume .section-actions`
  so it shares a line with the View/Download resume pair, pushed to the trailing
  edge by `margin-inline-start: auto`; the old placement above the list survives
  only as the fallback for a document with no controls row.
- **Revealing a navigated-to group.** The Ctrl+K palette resolves a content hit
  to `#exp-...` and focuses it; with the group closed that landed on a collapsed
  row and appeared to do nothing. Both a `hashchange` and a capturing `focusin`
  inside `#resume` open the ancestor `<details>` chain, so a pasted URL, a
  back/forward step and the palette all behave identically.

This is also why the anchor id sits on the `<details>` rather than the `<h4>`.

### `skills-carousel.js` (286 lines)

`initSkillsCarousel()` — a carousel below 640 px and a static grid above.
Autoplay at 4.5 s, 40 px swipe threshold, dot navigation, paused under
`prefers-reduced-motion`. Initialises after two `requestAnimationFrame` ticks so
measurements happen on a painted layout.

Autoplay also has a **latched pause control** (WCAG 2.2.2). Hover, focus and an
in-progress touch pause it transiently, but this runs only on the phone layout,
where there is no hover to give — so a reader had no way to stop the slide
moving under them. `.skills-carousel-pause` sits in a controls row *outside*
the `role="tablist"` (a pause button is not a tab) and is revealed only where
autoplay can actually run.

### `ripple.js` (31 lines)

`initRipple()` — **one** delegated `pointerdown` listener on `document` for
`.btn`, `.contact-copy-btn`, `.contact-prompt`. Binding per element was both
memory overhead and blind to dynamically created nodes.

### `scroll-to-top.js` (36 lines)

`initScrollToTop()` — injects the button, shows at 500 px and hides at 300 px
(hysteresis avoids flicker), and honours `prefers-reduced-motion` for the scroll
itself.

### `home-portrait.js` (81 lines)

`initHomePortrait()` — the landing portrait's flip card. The rotation is
entirely CSS; this module owns the two things CSS cannot do.

It **enables the button**, which `index.html` ships `disabled` so a page
without JS never offers a control that cannot work — that one line is the whole
of the upgrade. And it **announces the change**: both faces are `alt=""`, so
`#home-portrait-status` is the only place a screen reader is told anything
happened, the same pattern as the theme shuffle's status line.

State lives in `aria-pressed`, which is also the selector the stylesheet
rotates on — one source of truth, and no class that can drift from what is
announced. It means "turned from rest", though, not "showing the back": above
900px the stylesheet rests the card on the *studio* face, so `STUDIO_LEADS`
(`matchMedia("(width >= 901px)")`, read live on every click rather than once at
startup) is what the announcement is resolved against. That query is the
stylesheet's own boundary, and the one number the two files have to agree on.

The back face is `fetchpriority="low"` so it queues behind the LCP; the first
`pointerenter` or `focus` raises it to `high`, which is the earliest honest
signal that a click is coming. Above 900px that face *is* the LCP and
`index.html` preloads it, so the warm-up is a no-op there — the `complete`
check is what makes it one, and no width test belongs in it.

See [The flip card](FRONTEND.md#the-flip-card) for the markup and CSS contract.

### `tilt.js` (97 lines)

`initTilt()` — pointer-tracked 3D tilt on `.tilt-card`, `requestAnimationFrame`
batched, and a complete no-op without hover support or with reduced motion.

### `theme.js` (202 lines)

`initTheme()`, `applyTheme(isDark)`, `toggleTheme()`. `toggleTheme` is exported
so callers (the command prompt) need not synthesise a click on `#theme-toggle`.

Both `localStorage` reads go through `readStoredTheme()`, which returns `null`
for "no stored choice" and for "storage is unreachable" alike, because the
caller falls back to the OS either way. Reading storage *throws* where it is
blocked, and `initTheme` is the first call in `main.js` — an uncaught throw
here used to unwind the whole `DOMContentLoaded` handler.
Calls `syncThemeColorMeta()` from `theme-customizer.js` after
`reapplyCustomTheme`, which covers the plain light/dark flip on the shipped
colours — the palette paths sync the tag themselves.

The header button advances through `nextThemeMode()`, which reads the OS: from
"system" it goes to the theme the OS is *not* showing, then to the one it is,
then back to "system". The one press that cannot repaint the page therefore
comes last; a fixed light → dark → system order made it the first press for
every visitor on a light OS. The glyph names the mode in effect (sun, moon,
display), and the OS `change` listener re-syncs the label because the next
mode depends on it.

### `theme-customizer.js` (1,183 lines)

`initThemeCustomizer()`, `reapplyCustomTheme(isDark)`, `randomPalette(hex)`,
`syncThemeColorMeta(isDark)`.
Derives a full palette from one hex accent (`hexToHsl`, `generateVariants`),
checks contrast (`getLuminance`, `getContrast`) before applying, writes CSS
custom properties onto `document.body`, and persists to
`localStorage.rj_theme_palette`. `clearCustomPalette()` restores the defaults.
Every theme chip, built-in or saved, carries a swatch: `paintChip()` writes the
triple it applies as `--chip-a/b/c`, which the `.preset-btn::before` bar in
`styles.css` reads. Those are CSSOM writes, which `style-src 'self'` allows
where a `style` attribute would not be.

`initHomeThemeShuffle()` wires the wand in the landing view's `.home-socials`
row. It calls `applyRandomTheme()`, which rolls, derives and paints **without
persisting** — a visitor who presses it out of curiosity gets the real palette
back by reloading rather than hunting for Reset in a header dropdown. It is a
separate initialiser from `initThemeCustomizer()` because that one bails early
when its dropdown is absent, and that must not take the home button with it.

`syncThemeColorMeta()` copies the live **computed** `--accent-fill` into the
`theme-color` meta tag — the mobile browser toolbar, and the top bar of the
installed PWA. It is called from inside `applyPaletteVariables()` and
`clearCustomPalette()` rather than from their call sites, because the tag is a
plain attribute nothing re-derives and *every* paint path has to move it: a
roll, a panel preview, the rollback on cancel, Apply, Reset and a theme flip.
Writing it only from `applyTheme()` and Apply was the bug — a randomised theme
left the bar on the previous colour until the visitor pressed Apply. It reads
off `<body>`, not the root element, because the dark `--accent-fill` is
declared on `body.dark-theme`. The manifest `theme_color` is not a fallback for
any of this: it is static, read at install time, and only reaches the launch
splash and the task switcher.

The unsaved roll lives in one module-level `unsavedRawPalette`, and three
things have to agree about it. The home button sets it. `loadDefaults()` reads
it *before* localStorage, so opening the panel after a roll shows the roll —
otherwise Apply would save colours the visitor never saw. And
`reapplyCustomTheme` prefers it, so flipping light/dark re-derives the roll
instead of destroying it.

Apply and Reset clear it outright. Closing the panel without applying rolls it
back to `paletteOnOpen` — a copy taken when the panel opened — rather than to
the saved palette, and the difference is the whole point: everything done
*inside* the panel is a preview, so cancel discards it, but a roll made on the
landing view before the panel was ever opened is not the panel's to throw away.
Opening the panel to look at a randomised theme and closing it untouched
therefore leaves the screen exactly as it was. Covered by
`theme-panel-cancel.test.js`, which drives the real panel because the rollback
hangs off a MutationObserver watching `is-open` and cannot be reached any other
way.

`readThemeLibrary()`, `saveTheme(name, raw)`, `deleteTheme(id)` and the
`THEME_LIBRARY_LIMIT` / `THEME_NAME_MAX` bounds are the saved-theme library,
kept in `localStorage.rj_theme_library` with no account behind it: the site's
auth exists for the owner's dashboard, so gating this behind a login would hide
it from everyone who actually uses the page. `readThemeLibrary` never throws —
it is called on every panel open, and a hand-edited value has to read as an
empty list rather than take the customiser down. Saving under an existing name
overwrites it rather than adding a second chip, keeping the original id, and
`saveTheme` returns that id because the panel has to keep pointing at what it
just wrote. Covered by `theme-library.test.js`.

The panel tracks the saved theme those colours came from (`activeThemeId`, set
by a chip click and derived from the controls on every open so it survives a
reload). An edit KEEPS it — that is the point: the chip stays `aria-pressed`,
gains an `is-edited` dot while the controls hold something the theme does not,
and the Save field opens prefilled with the name so Enter updates it in place.
A preset, a roll or a delete drops it, so none of them can overwrite a theme by
accident, and Apply deliberately writes only `rj_theme_palette` — see the
saved-themes section of [FRONTEND.md](FRONTEND.md) for why that boundary is
where it is. Covered by `theme-library-update.test.js`, which drives the real
panel.

`randomPalette(currentPrimaryHex)` backs both shuffles and is
exported because it is the one piece here worth testing on its own
(`theme-randomizer.test.js`). It is deliberately not uniform random: three
independent hues read as noise, and a colour outside a narrow
saturation/lightness band produces derived variants that fail against one theme
or the other. So it rolls ONE base hue — guaranteed 40-320 degrees from the
palette already on screen, because a shuffle that lands where it started looks
like a broken button — picks one of four fixed harmonies (analogous, triad,
split-complementary, accented analogous) for the other two, and constrains
saturation to 58-88% and lightness to 42-58%. `hslToHex` is its inverse of
`hexToHsl`. Like a preset click, a roll made inside the panel is a **preview**:
the panel's MutationObserver restores what the panel opened showing unless Apply
is pressed.

---

## Visual effects

### `animations.js` (309 lines)

`initAnimations()` — scroll reveals via `IntersectionObserver` (all revealed
immediately under reduced motion or without the API), animated stat counters,
the terminal intro sequence, a matrix-style text decode effect, spring-driven
hover states, and page transitions.

The terminal intro's start delay and per-line step come from `--motion-base`
through `config.js`'s `motionMs()`, not from a constant here — they were a
literal 180 twice, which is a CSS token restated in JS and free to drift from
it (ADR-025). The four constants that remain (`REVEAL_STAGGER_MS`,
`STAT_COUNT_DURATION_MS`, `MATRIX_FRAME_MS`, `MATRIX_ITERATION_STEP`) have no
counterpart in the stylesheet, so they stay constants.

### `hero-title.js` (194 lines)

`initHeroTitle()` — tokenises the hero title into words and characters
(preserving wrapping), plays a staggered 3D roll-up entrance, and adds a
magnetic pointer tilt with a specular highlight. Fully reduced-motion aware.

The characters it builds start at `opacity: 0`, so this module is what makes
the page's only `<h1>` visible. Two things bound that. The wait on
`document.fonts.ready` is raced against `FONT_WAIT_CEILING_MS` (300 ms), so a
slow or hanging font request delays the entrance rather than withholding the
name; and `.hero-char` carries a `hero-char-failsafe` animation in
`styles.css` that reveals the characters at 1.5 s from CSS alone, so a throw
anywhere in this module cannot leave the hero blank. Keep the JS ceiling well
under the CSS deadline.

### `physics.js` (75 lines)

`Spring` (stiffness / damping / mass / rest thresholds) and
`animateSpring({from, to, onUpdate, onComplete, config})` — a small spring
integrator that gives `animations.js` framework-quality motion without a
framework.

### `confetti.js` (144 lines)

`triggerConfetti(options)` and `confettiPresets`. Canvas-based, self-removing,
colours read from CSS custom properties so it matches the active accent.

---

## Shared app chrome (`js/app-shared/`)

Two modules every standalone app runs, and the one entry point that carries
them into the two football predictors. They live outside the per-app folders
because they are genuinely shared - `docs/review/apps-uiux.md` H2 and H3 found
seven apps that were dead ends and one app (`/diff`) whose keyboard shortcuts
nothing documented, and the fix for both is one implementation rather than
seven.

They are drawn with `frontend/app-shared.css`, which names only the
seven-token chrome contract (`--chrome-bg`, `--chrome-border`, `--chrome-text`,
`--chrome-muted`, `--chrome-accent`, `--chrome-action-bg`,
`--chrome-action-hover`) that all seven apps already publish. That is what lets
one stylesheet sit on seven different palettes, the arcade's included, without
naming a single app-specific token. `app-chrome.css` could not carry them:
only three of the seven apps link it.

The build treats the six standalone-app entries as one esbuild `splitting`
group, so `app-switcher.js` and `app-shortcuts.js` are emitted once and shared
rather than inlined into each app's bundle.

### `app-switcher.js` (126 lines)

Turns each app's Back control into a popover listing all seven apps plus
Portfolio home and the shelf, with the current one marked `aria-current="page"`
rather than removed - a menu whose contents change per page has to be re-read
on every page. Back keeps its place and its press, so nothing that was one
press away becomes two. `Esc` closes and returns focus to the trigger;
clicking outside dismisses. The `APPS` array is the single list of what the
shelf holds, and `app-shared.test.js` asserts it against `index.html` so the
two cannot drift.

### `app-shortcuts.js` (214 lines)

Binds `?` (the sheet), `/` (focus the primary input) and `1`-`9` (switch tab),
and builds the sheet **from the same table that does the binding** - a
hand-written sheet is a second source of truth that starts lying the first time
a shortcut is renamed. Per-app extras register through the same table, which is
how `/diff`'s `j`/`k` appear in its sheet and nowhere else. An entry with no
`run` is documentation only, for a key the app itself owns. `suppress` hands
the keyboard back entirely: `/arcade` passes one for the time a game is on
screen, because `Escape` belongs to the shell then. The "not while you are
typing" guard (text fields, `contenteditable`, any modifier) lives here once
rather than in each app.

### `predictor-chrome.js` (25 lines)

`/ucl` and `/worldcup` keep everything else inline, so they have no module
entry of their own to hang the two above on. This is it, and the only external
script either page loads. Which app it is comes from the URL rather than a
per-page parameter, so both pages load byte-identical script.

---

## Arcade (`/arcade`)

Its own page, its own entry point, its own esbuild pass. Nothing here is
imported by the SPA and nothing here imports from it, which is deliberate:
`scripts/build.mjs` derives the service worker's precache list from the SPA's
dependency graph, so a shared module would drag game code into the app shell.

The six games are interchangeable. Each exports a `meta` describing itself and
a `create({ mount, api })` that returns `{ destroy() }`; the shell supplies the
mount point and an `api` of `{ audio, setScore, gameOver }`, and owns
everything the games have in common — the launcher, the HUD, best scores,
restart, pause and exit. Restarting is `destroy()` then `create()`, never a
per-game reset path, because a reset that misses one field produces a second
run that behaves like a continuation of the first.

Pause is deliberately not part of that contract. `engine.js` keeps the set of
running loops and `input.js` holds one blocked flag, so the shell pauses the
page rather than the game — a game added tomorrow is pausable without knowing
pause exists, which is the property that matters for the pause nobody presses:
leaving the tab.

The rules of each game are pure exported functions, tested directly in
`arcade.test.js` without a canvas. Everything else in a game module is drawing.

### `shell.js` (510 lines)

The page's entry point. Builds the launcher from each game module's own `meta`,
so adding a game is an import and one array entry. Owns the game lifecycle, the
sound toggle, pause, and the game-over panel. Banks the running score on exit
and restart as well as on game over — recording only on game over threw away
every run a player walked away from.

Which game is on screen is the URL fragment rather than a variable: `route()`
is the only thing that mounts or tears down a game, and a typed
`/arcade#tetris`, the browser's back button and a click on a card all reach it.
That is what makes the back button leave a game instead of the site, and a game
a link somebody can send.

`Escape` steps back out of wherever the player is rather than doing one fixed
thing — a live game pauses, a paused game resumes, and only a finished one
leaves — so it is never the key that throws a run away. The same pause runs on
`visibilitychange`, because a backgrounded tab throttles its animation frames
and a run left for a minute used to be a run spent. It does not resume by
itself: arriving back mid-fall is the same lost run by another route.

It also owns the switch between the page's two layouts: starting a game puts
`is-playing` on `<body>` (the stylesheet collapses the page to one viewport with
the board taking everything that is not the play bar), stamps the game's id on
the stage so the chrome takes that game's accent colour, and moves the one sound
button into the play bar — the masthead it normally lives in is not on screen
during a run, and two buttons kept in step is the version of this that goes
wrong.

### `engine.js` (123 lines)

The fixed-timestep loop and a display-density-aware canvas fit.

- `createLoop` calls `update` a whole number of times per frame at a constant
  step. Variable-timestep physics would make Flapper's jump height and Tetris's
  gravity depend on the visitor's refresh rate, and let collision tunnel
  through a column on a long frame. The accumulator is clamped, so returning to
  a backgrounded tab slows the simulation rather than fast-forwarding it
  through its own game over.
- `fitCanvas` sets the backing store to the CSS box times DPR (capped at 2) and
  scales the context, so one context unit stays one CSS pixel. Returns the
  CSS-pixel box; game logic reasons in that.
- `suspendLoops` stops every running loop and hands back the function that
  starts those same ones again. A module-level set is defensible because the
  page runs one game at a time, and it is what keeps pause out of the games: a
  pause each game has to remember to implement is a pause that will eventually
  be missing from one of them.

### `input.js` (138 lines)

`bindKeys`, `bindSwipe` and `bindPointerTrack`, each returning its own teardown. That is the point:
the shell destroys and recreates a game on every restart, and a listener left
on `window` keeps driving a dead game. Handled keys have their default
suppressed so arrows and space do not scroll the board off a phone screen.

`bindPointerTrack` is the one that is not a gesture: `bindSwipe` resolves a
whole drag into a direction once it is over, which is right for a board that
moves in steps and wrong for Breaker's paddle, which has to follow the pointer
while it is still moving and, on a mouse, before any button is pressed.

`setInputBlocked` closes all three paths for a pause. Checking a paused flag inside
each game instead is the check one game forgets, and the symptom is a piece
that hard drops behind a pause panel.

### `storage.js` (110 lines)

Best scores and the sound preference, every access wrapped. `localStorage` does
not merely read empty in a private window — the accessor itself throws — and an
arcade that refused to boot over a high score would be a poor trade.

### `audio.js` (131 lines)

A Web Audio synth; the page ships no audio files. The context is created lazily
on the first sound, because one built at import time is born outside a user
gesture and stays suspended — present, accepting `start()`, silent. Perfect
Stack drops walk up a pentatonic scale, which is what turns a streak into an
audible chord progression.

### `game-2048.js` (337 lines)

`collapse` and `move` are the rules: a merged tile cannot merge again within
the same move, and a move that changes nothing must not spawn. `move` also
returns each tile's journey, which is what lets the renderer animate a slide
rather than teleport tiles.

### `game-tetris.js` (618 lines)

Ten by twenty, seven-bag randomiser, SRS rotation with wall kicks. The kick
tables are stored in the standard's own coordinates, where `+y` is up, and
`kickedRotation` flips the sign once at the point of use — easier to check
against a reference than a pre-negated table. Without kicks a piece simply
refuses to turn against a wall, which reads as an unresponsive game rather than
a rule. Seven-bag rather than uniform random because uniform produces droughts
long enough that players reasonably believe the game is cheating.

### `game-flapper.js` (283 lines)

A flappy-style game with its own name and its own canvas-drawn art. Simulated
in a fixed 400x600 space and scaled to the canvas, so it is not harder on a
tall phone than a short laptop window. The ceiling clamps rather than kills —
every column reaches down from it, so hugging the roof is still paid for at the
next gap.

### `game-snake.js` (384 lines)

The hazard is the trail the player left, which is the one shape the other four
do not have. `step` is where the game lives: the tail vacates its cell on the
same tick the head enters it, so chasing your own tail is legal — resolving the
collision before the tail moves ends runs on a move that was never fatal.
`spawnFood` picks from the list of free cells rather than guessing at cells
until one is free, because rejection sampling is fine at the start and
pathological at the end, where the last free cell of 289 takes hundreds of
guesses. Turns are queued two deep and a reversal is refused, so rounding a
corner with two fast presses cannot resolve as right-then-left.

Alone among the games it paints nothing past its own world. The other three
bleed their sky to the canvas corners so a tall phone does not letterbox them;
here the edge of the board *is* the hazard, and a field carried on past the
last row would be painting open ground over a wall that kills.

### `game-stack.js` (320 lines)

Flat 2D side view: blocks slide, a drop trims the overhang, and the trimmed
width is what the next block inherits. `place()` holds that geometry. A drop
within a few units of flush snaps perfect, because without the tolerance
"perfect" is unreachable on a touchscreen and the width reward that keeps long
runs alive would be dead code.

### `game-breaker.js` (533 lines)

The only one of the six the player *aims*: `paddleBounce` takes the outgoing
angle from where on the paddle the ball struck, not from the angle it arrived
at. Reflecting the ball's own `vy` — the obvious implementation — leaves the
paddle a wall and the game with no decision in it. The deflection is capped
short of horizontal, because the tip of an uncapped paddle returns the ball
flat, and a flat ball inside a gap in the wall bounces side to side without
ever coming back down: a run that can be neither won nor lost.

`contactAxis` picks the axis a hit reflects on by which axis the ball is less
deep on, which is the one it came in through. Deciding from position instead
reads a ball that clipped a brick's underside from the left exactly backwards,
and reflecting both axes sends it back the way it came off a corner. An exact
corner resolves vertically: the bricks are three times wider than they are
tall, so the horizontal reading is the one that fires the ball off along the
row it just hit.

`sliceCount` is why the ball cannot leave through the wall. Collision here is a
test at a position rather than a swept volume, so a ball that travels further
than its own radius between two tests can cross a brick without ever being
inside it — and at the speed cap a whole 1/60 frame already does. The frame is
resolved in as many slices as that takes.

---

## Logic Inspector (`/cron` and `/regex`)

A standalone visual developer utility for back-end engineers and technical visitors. Like the Arcade, it lives on its own page (`frontend/cron.html`) with its own entry point (`js/cron/cron-main.js`), zero third-party assets (ADR-016), and pure vanilla ES modules (ADR-001).

### `cron-main.js` (298 lines)

The application controller. Binds the tab switcher between Cron and Regex views, synchronizes state to the URL hash and query string (`#cron?expr=...` and `#regex?pattern=...&flags=...`), handles clipboard sharing with visual toast feedback, and persists user inputs in `localStorage`.

### `cron-parser.js` (633 lines)

Pure mathematical parser and validator for standard 5-part POSIX cron schedules (`minute hour day-of-month month day-of-week`). Evaluates step expressions, lists, ranges, and month/weekday names. Provides natural language translation (`translateCron`) and calculates the next sequential trigger timestamps (`getNextRuns`) with leap year and calendar edge awareness.

### `cron-ui.js` (486 lines)

DOM controller for the Cron Visualizer view. Renders quick-select preset chips, an interactive 5-part picker with synchronized dropdowns, real-time error banner, human translation card, and next-10 scheduled triggers timeline with relative countdown badges.

### `regex-parser.js` (437 lines)

Browser RegExp tokenizer and safe execution engine. Breaks regular expressions into semantic tokens (character classes, quantifiers, capturing groups, anchors, alternations, escapes, literals) for syntax highlighting. Evaluates matches with boundary indices and extracts numbered and named capture groups with zero-length match guards to prevent infinite loops and ReDoS.

### `regex-ui.js` (407 lines)

DOM controller for the Regex Visualizer view. Binds pattern input and flag toggles (`gimsuy`), renders a color-coded syntax token breakdown bar, manages mirrored backdrop match highlighting in the sample textarea, and displays match summary cards and capture group tables.

---

## Crypto & Encoders (`/crypto` and `/encode`)

A standalone client-side cryptographic and data transformation workbench for software engineers and technical visitors. Like the Logic Inspector and Arcade, it lives on its own page (`frontend/crypto.html`) with its own entry point (`js/crypto/crypto-main.js`), zero third-party assets (ADR-016), and pure vanilla ES modules (ADR-001).

### `crypto-main.js` (211 lines)

The application controller. Manages tab switching across `#encoders`, `#hasher`, `#generators`, and `#time`, synchronizes state with the URL hash, handles dark/light theme toggling, provides shareable link copying, and initializes workbench UI handlers.

### `crypto-ui.js` (692 lines)

DOM controller for the Crypto & Encoders workbench. Manages live text encoding/decoding, file drag-and-drop for Base64 Data URIs (enforcing the 5 MB limit), real-time cryptographic hash updates, generator controls with customizable character sets, live ticking clock, and the "Clear All" privacy wipe action.

### `encoders.js` (216 lines)

Bidirectional transformation utilities for UTF-8 Base64, URL encoding, byte-level Hexadecimal, HTML entity escaping/restoration, and 8-bit Binary representation. Includes FileReader integration for local file conversion to Base64 Data URIs.

### `hasher.js` (150 lines)

Cryptographic hash computation module leveraging native `window.crypto.subtle.digest`. Supports real-time asynchronous computation of SHA-256, SHA-512, and SHA-1 with character and UTF-8 byte metric calculations.

### `jwt.js` (122 lines)

JSON Web Token decoder. Splits on `.`, Base64URL-decodes the header and
payload, annotates the registered claims and renders `exp`, `iat` and `nbf` -
NumericDate values, so seconds rather than milliseconds - through
`time-workbench.js`'s relative formatter. Decode only, and deliberately so: the
panel states that it does not verify the signature, because verification needs
the signing key and a page that checks a key pasted in beside the token has
told you nothing. Never throws - a malformed token returns
`{ valid: false, error }`, because pasting something truncated is the normal
way to arrive here.

### `share-state.js` (85 lines)

The Share button's URL. Encodes the workbench's *shape* - which tab, which
encoder format, which generator and how much of it - into `searchParams`, the
way `/cron` does, and restores it on load. What deliberately does not travel is
anything typed: plaintext waiting to be hashed, an HMAC key, a token, a
generated secret. The allowlist is closed-set controls only (`<select>` and a
range), and a value the page does not actually offer is dropped rather than
assigned, since a `<select>` accepts an unknown value by going blank.

### `generators.js` (256 lines)

Cryptographically secure random generators using `window.crypto.getRandomValues()` and `crypto.randomUUID()`. Generates RFC 4122 UUID v4, RFC 9562 time-ordered UUID v7 with millisecond precision, secure hex and Base64URL tokens, and customizable passwords with guaranteed character sets.

### `time-workbench.js` (159 lines)

Unix timestamp inspection and conversion module. Provides a live reference clock (UTC & Local seconds and milliseconds), bidirectional conversions between Unix Epoch and ISO 8601 / Local dates, and relative time calculations.

---

## JSON Workbench (`/json`, `/yaml` and `/jsonpath`)

A standalone client-side JSON toolkit: format, validate and repair; query with JSONPath or dot-notation; explore as a collapsible tree; convert to YAML, CSV and TypeScript. Like the Logic Inspector and the Crypto workbench it lives on its own page (`frontend/json.html`) with its own entry point (`js/json/json-main.js`), zero third-party assets (ADR-016) and pure vanilla ES modules (ADR-001).

The structural difference from `/crypto` is that its tabs are **not** independent tools. One source document is parsed once per edit, debounced, and all four panels read that single result — which is why parsing lives in its own module rather than inside the UI controller.

Two invariants hold across the whole directory. **No `eval` or `new Function`**: query filters are tokenised, parsed into an AST and walked by a `switch`, because the page ships `script-src 'self'` with no `'unsafe-eval'` and almost every JSONPath library implements filters with an evaluator. **No `innerHTML`**: every document-derived string reaches the DOM through `textContent`, so no sanitiser is needed — no HTML string is ever built.

### `json-main.js` (208 lines)

The application controller. Resolves the theme from the shared `theme` key before the panels render, manages the four deep-linkable tabs (`#format`, `#query`, `#tree`, `#convert`) with arrow-key roving tabindex and `hashchange` sync, persists preferences, and wraps startup in an error boundary. Document text is persisted **only** while the "Remember my document" switch is on, and that switch defaults to off.

### `json-ui.js` (850 lines)

DOM controller for the workbench. Owns the source pane, the debounced parse, drag-and-drop with the 5 MB cap, the repair log, copy-and-download on every output, and the four panel renderers. Holds no parsing logic of its own. Its `writeJson()` colouriser appends `<span>` elements it creates itself, so JSON containing markup is coloured without ever becoming nodes.

### `json-compare.js` (136 lines)

Structural JSON comparison, which closes the limitation `/diff`'s own About tab
states about itself: "two JSON documents that differ just in key order are
reported as different." Canonicalises both sides - keys sorted at every depth,
one fixed indent, array order untouched because in JSON it means something -
and runs `js/diff/diff-engine.js` over the two rendered strings.

That import across app folders is the one structural decision this workbench
takes deliberately: `diffLines` is a pure function over two strings with no DOM
and no diff-page state, so the alternative was a second copy of Myers in this
folder. `compareRows` flattens the hunks for painting and caps the row count
**per line**, not per change - a single `replace` can carry hundreds of lines.

### `json-parser.js` (578 lines)

Strict parsing, error location and repair. `JSON.parse` decides validity so the module never disagrees with the platform about what JSON is; when it throws, a hand-written scanner re-reads the text to produce a stable `{ line, column, offset, message, excerpt }` that engine-specific `SyntaxError` messages cannot. A tolerant mode of the same scanner accepts trailing commas, unquoted and single-quoted keys, comments, smart quotes, Python literals, hex and leading-zero numbers, missing commas and trailing garbage — logging every accommodation. Repairs that change a value rather than syntax (`NaN`, `Infinity` and `undefined`, which JSON cannot represent, become `null`) are flagged `lossy` so the UI can mark them differently.

### `json-query.js` (665 lines)

The query engine, in three stages: a path parser, a precedence-climbing expression parser for filters, and an evaluator. Supports `$`, `.name`, `['name']`, `[n]`, `[-n]`, `[start:end:step]`, `[*]`, `..name`, `..*` and `[?(expr)]`, plus bare dot-notation and `filter(...)` sugar that also chains (`items.filter(price > 50)`). Filter operators are `||`, `&&`, `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `startsWith` and `endsWith`. Member access goes through a helper that reads own enumerable properties only, so `@.constructor` and `@.__proto__` resolve to Nothing rather than JavaScript internals. `formatPath()` renders a path as JSONPath, dot or bracket notation and is the single source of truth for path syntax on the page.

### `json-tree.js` (252 lines)

The collapsible tree. Children are built on first expand and cached, collapsing hides rather than destroys, and a node renders at most `CHILD_PAGE_SIZE` (200) children before offering a "show more" control — without which a 5 MB document expanded whole would lock the tab. `expandAll()` refuses past 5,000 nodes and returns an explanation instead of hanging.

### `json-yaml.js` (531 lines)

`toYaml()` and `fromYaml()`. The emitter's real work is quoting: YAML 1.1 re-reads `no`, `off`, `~`, `0755` and `1:30` as non-strings, so any scalar that would change type is quoted — the "Norway problem". The parser covers block mappings and sequences, flow collections, the three scalar styles, `|` and `>` block scalars with chomping, comments and a leading `---`. Anchors, aliases, merge keys, tags, multi-document streams and complex `? ` keys are **refused by name with a line number** rather than guessed at.

### `json-csv.js` (279 lines)

`toCsv()` and `fromCsv()`, to RFC 4180. The header is the union of every row's keys in first-seen order, so a ragged array does not shift columns; nested objects flatten to dotted paths and are rebuilt on the way back. An API envelope — `{ "data": [ ... ] }`, the shape most responses arrive in — is tabulated from its one array-of-objects property when there is exactly one, and the returned `sourceKey` names it so the panel can say so rather than unwrapping silently; two such properties is ambiguous and is refused. Type inference is opt-in and only converts a value that round-trips exactly, leaving `00123` and `+15551234567` as strings. CSV cannot distinguish `null` from `""` — both are an empty cell — and that asymmetry is stated in the panel rather than hidden.

### `json-typescript.js` (173 lines)

`toTypeScript()`. Two passes: the first unifies every value reaching a position into one schema node, which is what turns a key missing from some array elements into `name?: string` rather than a second interface; the second emits, de-duplicating structurally identical shapes so repeated objects share one named interface. Array element types unify into unions, invalid identifiers are quoted, and recursion is depth-bounded. One-way by design.

---

## Code Difference Checker (`/diff` and `/patch`)

A standalone client-side diff: compare two documents with character-level
highlighting, or paste a unified patch and read it back as a side-by-side view.
Like the Logic Inspector, the Crypto workbench and the JSON workbench it lives
on its own page (`frontend/diff.html`) with its own entry point
(`js/diff/diff-main.js`), zero third-party assets (ADR-016) and pure vanilla ES
modules (ADR-001). The page ships `connect-src 'none'`: people compare
production configs and proprietary source here, and nothing they paste can
leave the tab.

The structural decision is that **a computed diff and a parsed patch converge on
one hunk structure**. `diff-engine.js` produces it from two documents;
`diff-patch.js` produces the same thing from `git diff` text; `diff-render.js`
draws either without knowing which it has. Reading a patch therefore costs a
parser and no view code, and because the writer and the parser speak the same
structure, `applyPatch(a, writePatch(diff(a, b))) === b` is a property test that
holds all three honest.

Two invariants hold across the whole directory. **No `eval` or `new Function`**:
the syntax lexer is a character-stream scanner, and the page carries no
`'unsafe-eval'`. **No `innerHTML`**: both panes are attacker-controlled text
that the visitor has asked to see rendered, which is the exact shape of a
stored-XSS bug, so every segment is a `createElement` plus `textContent` and no
sanitiser is needed — no HTML string is ever built.

### `diff-main.js` (178 lines)

The application controller. Resolves the theme from the shared `theme` key,
manages the three deep-linkable tabs (`#compare`, `#patch`, `#about`) with
arrow-key roving tabindex and `hashchange` sync, and wraps startup in an error
boundary.

### `diff-ui.js` (602 lines)

DOM controller. Owns both panes, the debounced recompute, drag-and-drop with the
5 MB cap, the normalisation toggles, the split/unified switch, change navigation
(`j`/`k` and the Prev/Next buttons), patch parsing and the copy/download of the
emitted patch. Pane contents are persisted **only** while "Remember my panes" is
on, that switch defaults to off, and switching it off deletes what was already
stored rather than merely stopping future writes.

### `diff-engine.js` (615 lines)

Myers' O(ND) algorithm in its linear-space divide-and-conquer form, plus hunk
assembly. Three layers keep a large paste from freezing the tab: the shared
prefix and suffix are stripped before the algorithm runs, the k-loop is metered,
and when the meter trips a histogram diff takes over — anchoring on the rarest
line the two sides share — and the result reports which algorithm produced it, so
a diff that stopped being minimal says so. Comparison runs on a derived key per
line rather than the line itself, which is what lets `ignoreWhitespace` change
what counts as equal while changing nothing about what is drawn. A final line
with no newline after it carries a marker in its key, so it never compares equal
to a terminated one — git agrees, and without it the emitted patch cannot
round-trip.

### `diff-patch.js` (413 lines)

The unified patch writer and parser. The writer matches `git diff` byte for byte
on hunk headers, single-line ranges written bare, zero-count ranges anchored on
the preceding line, and `\ No newline at end of file`. The parser accepts a full
multi-file `git diff` with `diff --git` preambles, a bare paste of hunks with no
file headers, and context lines whose leading space a mail client has stripped;
a malformed header or a hunk whose declared counts disagree with its body is
refused with a `line`, `column` and an excerpt rather than half-rendered.
`applyPatch()` exists for the round-trip property test and is dropped from the
bundle by tree-shaking.

### `diff-refine.js` (160 lines)

Intra-line refinement. Each paired line is tokenised and run through
`diffSequences` — the same engine, one scale down — so `timeout = 30` against
`timeout = 300` highlights `30` and `300` rather than both whole lines. Two
guards stop it making things worse: lines past `MAX_REFINE_LENGTH` are left
whole, and a pair sharing less than `MIN_SIMILARITY` of its **non-whitespace**
tokens is left as a plain red/green pair, because a confetti of alternating
spans reads worse than a clean one.

### `diff-tokenize.js` (186 lines)

One generic syntax lexer, not a grammar per language. It handles the shapes
rather than the languages — four comment dialects, three quote styles plus
template literals, numeric literals including hex and exponents, and a keyword
set pooled across the C family, JavaScript, Python, Go, Java and SQL — which
reads well everywhere and is knowingly wrong about `#` where that is not a
comment. Block-comment state is threaded between lines; an unterminated string
stops at its own line end rather than repainting the rest of the document.

### `diff-render.js` (383 lines)

Hunks to DOM, in split or unified layout. Syntax spans and refinement spans both
want to wrap parts of the same line, so the two lists are merged into one set of
boundaries with a linear sweep and each segment carries whichever classes apply
— the DOM stays flat and "diff colour wins over token colour" becomes a question
of CSS rather than nesting order. Only hunks are drawn; the unchanged stretches
between them collapse to an expander that renders on demand, so a one-line change
in a ten-thousand-line file costs a handful of rows. `MAX_RENDER_ROWS` caps a
pathological pair and says what was left out.

---

## Browser storage keys

| Key | Store | Written by | Holds |
| :--- | :--- | :--- | :--- |
| `theme` | localStorage | `theme.js`, inline bootstrap | `"dark"` / `"light"` |
| `rj_theme_palette` | localStorage | `theme-customizer.js` | Custom accent palette |
| `rj_access_token` | localStorage | `auth.js` | JWT access token |
| `rj_refresh_token` | localStorage | `auth.js` | JWT refresh token |
| `rj_chat_sessions` | localStorage | `chat.js` | Up to 50 conversations |
| `rj_chat_active_session` | localStorage | `chat.js` | Active conversation id |
| `rj_sidebar_hidden` | localStorage | `chat.js` | AI page sidebar state |
| `rj_terminal_history_v2` | localStorage | `terminal/history.js` | Last 100 commands |
| `rj_terminal_history` | localStorage | *(v1, read-only)* | Superseded by the `_v2` key. `history.js` migrates it once on load and never writes it again |
| `rj_terminal_matrix` | localStorage | `terminal/index.js` | Matrix effect toggle |
| `rj_event_queue:<session_id>` | localStorage | `analytics.js` | Pending analytics events |
| `rj_session_id` | **sessionStorage** | `analytics.js` | Analytics session id (per tab) |
| `rj_session_started_at` | **sessionStorage** | `analytics.js` | Session start timestamp, so a reloaded tab keeps one session rather than starting another |
| `rj_session_token` | **sessionStorage** | `analytics.js` | Capability token (per tab) |
| `rj-arcade:best:<game>` | localStorage | `arcade/storage.js` | Best score per arcade game |
| `rj-arcade:muted` | localStorage | `arcade/storage.js` | Arcade sound preference |
| `rj-inspector:state` | localStorage | `cron/cron-main.js` | Active tab, last expressions and test text |
| `rj-crypto:preferences` | localStorage | `crypto/crypto-main.js` | Last active tab and workbench preferences |
| `rj-json:preferences` | localStorage | `json/json-main.js` | Active tab, indent, path dialect, convert format. The **document itself** is written here only while "Remember my document" is on, which defaults to off — people paste tokens into JSON tools |
| `rj-diff:preferences` | localStorage | `diff/diff-ui.js`, `diff/diff-main.js` | Active tab, split/unified view, the four normalisation toggles, wrap and context |
| `rj-diff:left`, `rj-diff:right` | localStorage | `diff/diff-ui.js` | The two panes, written **only** while "Remember my panes" is on. It defaults to off, and switching it off deletes both keys rather than just stopping the writes |
| `rj_session_token` | **cookie** | the API | Same token, `HttpOnly; SameSite=Strict` — what `EventSource` sends |

A session stored before capability tokens existed is discarded on load, so a
fresh one is created rather than issuing calls that will be refused.

---

## Conventions

**One initialiser per module.** Modules export `initX()` and keep their state in
the closure. There is no global store.

**Delegate, don't bind per element.** Ripples, code-copy buttons, click tracking
and the lazy-load triggers are all single delegated listeners.

**Abort what you attach.** Lazy-load listeners use `AbortController`; the
particle layer returns a teardown; modals register `onClose` callbacks.

**Escape at the boundary.** Prefer building DOM nodes with `textContent`. Where
an HTML string is unavoidable, `escapeHTML()` first — it escapes both quote
forms because the results land inside double-quoted attributes.

**Respect the user's preferences.** `prefers-reduced-motion` is checked at init
**and** on change; every animated surface can be torn down mid-session.

**Fail quietly on the network.** Analytics, chat and activity all treat an
unreachable API as a no-op with a console warning, never a broken page.

**Keep the client and server limits in sync.** `FREE_MESSAGE_LIMIT` in `chat.js`
must match `CHAT_FREE_MESSAGE_LIMIT`; the client-side summarisation threshold
must stay under `MAX_TOTAL_CONTENT_CHARS`.

**Linting** — ESLint (`.eslintrc.json`) covers `frontend/*.js`,
`frontend/js/*.js` and `frontend/js/terminal/*.js` with `no-undef: error`,
`DOMPurify` and `marked` declared as read-only globals, and a service-worker
environment override for `sw.js`. `dist/**` is ignored.
