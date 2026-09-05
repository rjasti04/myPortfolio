# JavaScript Module Reference

Every ES module under `frontend/js/`, plus `frontend/three-bg.js`, with its real
exports and responsibilities. Modules are plain ES modules with no build-time
syntax; `frontend/` runs directly in a browser.

- [Module graph](#module-graph)
- [Entry points](#entry-points)
- [Core services](#core-services)
- [Feature modules](#feature-modules)
- [The command prompt](#the-command-prompt)
- [UI and interaction](#ui-and-interaction)
- [Visual effects](#visual-effects)
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
                                               ├─ dynamic ─► activity.js   (first Activity interaction)
                                               ├─ dynamic ─► three-bg.js   (capable devices, idle)
                                               └─ static  ─► particles-config.js (fallback layer)
```

`analytics.js` is the hub: it owns `API_BASE`, `apiFetch`, the session and its
capability token, and `trackEvent`. Anything talking to the API imports from it.

---

## Entry points

### `main.js` (310 lines)

Wires everything on `DOMContentLoaded` and owns the lazy-loading policy.

- Installs `window.onerror` and `unhandledrejection` handlers that forward to
  `reportClientError`. `preventDefault()` is called **only** for the network
  case it actually handles with a toast — calling it unconditionally suppressed
  every unhandled rejection from the console.
- Eager init: theme, navigation, contact form, hero title, animations, tilt,
  terminal, analytics, skills carousel, ripple, scroll-to-top, theme customizer.
- Lazy loaders for `chat.js` and `activity.js`, triggered by a click on the
  relevant nav target, by the section gaining `.active` (via `MutationObserver`),
  or by the matching location hash. Each delegated document listener is bound to
  an `AbortController` and removed once its module resolves — otherwise the
  listener runs on every click in the viewport forever.
- Background layer selection: exactly one animated layer mounts. The plexus
  (`three-bg.js`) if `hardwareConcurrency` and `deviceMemory` clear a threshold,
  otherwise the cheaper hero particle field. Neither under
  `prefers-reduced-motion`, and the fallback is torn down if the preference is
  enabled mid-session.
- Service-worker registration, an update check every 60 s, and the update
  banner whose button posts `SKIP_WAITING` and reloads on `controllerchange`.

### `auth-ui.js` (1,189 lines)

`export async function initAuthUI()` — one large function owning the entire
account surface: modal tabs (login / register / forgot), password strength
meter and requirement checklist, confirm-password matching, visibility toggles,
2FA enrolment with the QR code, active-session list with per-session and
"log out everywhere else" revocation, change password, delete account, magic-link
and reset-token handling from query parameters, and the injected profile
dropdown in the header (`setupNavUI`).

Loaded as its own esbuild entry so the account UI is available without waiting
for `main.js`.

### `app-logic.js` (42 lines)

A **classic script**, not a module. Assigns `window.AppLogic` and also exports
via `module.exports` so the Node test runner can `require` it.

| Export | Role |
| :--- | :--- |
| `setActiveSection(target, sections, navLinks)` | Toggle `.active` and manage `aria-current` |
| `getValidHashTarget(hash, getElementById, fallback = "about")` | Resolve a hash to a real section id |

### `theme-bootstrap.js` (19 lines)

Classic script. Replays a saved custom palette from
`localStorage.rj_theme_palette` onto `document.body` inline properties before
the modules run.

---

## Core services

### `config.js` (11 lines)

Media queries and the contact address. **Does not** hold `API_BASE`.

| Export | Value |
| :--- | :--- |
| `CONTACT_EMAIL` | `inboxtorj@gmail.com` — also hardcoded in `index.html` (mailto links, structured data, connect menu); keep them in sync |
| `prefersReducedMotion` | `(prefers-reduced-motion: reduce)` |
| `prefersDarkScheme` | `(prefers-color-scheme: dark)` |
| `compactViewport` | `(max-width: 1150px)` |
| `supportsHover` | `(hover: hover) and (pointer: fine)` |
| `mobileDevice` | `(pointer: coarse) and (max-width: 768px)` — phones only; iPads are 768px+ in portrait and laptops always have a fine pointer |

### `analytics.js` (585 lines)

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

### `auth.js` (364 lines)

Token storage and every authenticated call.

| Export | Role |
| :--- | :--- |
| `AUTH_TOKEN_KEY`, `REFRESH_TOKEN_KEY` | `rj_access_token`, `rj_refresh_token` |
| `getAuthToken()`, `setTokens(a, r)`, `clearTokens()` | `localStorage` accessors |
| `getErrorMessage(errorData, fallback)` | Normalises FastAPI's string / array `detail` shapes |
| `loginUser`, `registerUser`, `logoutUser` | Credential flows; register auto-logs-in |
| `setup2FA`, `enable2FA`, `disable2FA`, `verify2FA` | TOTP enrolment and challenge |
| `requestMagicLink`, `verifyMagicLink` | Passwordless sign-in |
| `requestPasswordReset`, `resetPassword`, `changePassword` | Password flows |
| `deleteAccount` | Soft delete |
| `fetchActiveSessions`, `revokeOtherSessions`, `revokeSpecificSession` | Session management |
| `authenticatedFetch(url, options)` | Bearer-attached fetch with a single-flight 401 refresh and retry |

`authenticatedFetch` is the important one. The server **rotates** refresh
tokens, so concurrent 401s each sending the same refresh token would have the
first win and the rest told the token was revoked — signing the user out
mid-session, with the last loser also overwriting the winner's new pair. A
module-level `refreshInFlight` promise makes every concurrent 401 share one
refresh, and it is cleared before awaiting callers resume so a later 401 starts
a fresh attempt. Guarded by `frontend/tests/auth-refresh.test.js`.

### `utils.js` (176 lines)

| Export | Role |
| :--- | :--- |
| `escapeHTML(value)` | Escapes `& < > " '` by regex, not by DOM round-trip — six call sites interpolate into double-quoted attributes, and `page_path` reaching `activity-charts.js` is visitor-controlled *and persisted*, so a missed quote was a stored injection |
| `copyText(text)` | Clipboard API with a hidden-textarea fallback |
| `showToast(message, type)` | `role="status"` toast, auto-dismissed after 3.2 s |
| `debounce(fn, delay)` / `throttle(fn, interval)` | Standard |
| `estimateTokens(text)` | Heuristic token count, weighted for words, punctuation, code fences and URLs |
| `onOnline(cb)` / `onOffline(cb)` / `isNetworkOnline()` | Connectivity observers |

### `error-handler.js` (198 lines)

| Export | Role |
| :--- | :--- |
| `AppError`, `NetworkError`, `APIError`, `ValidationError` | Typed error classes with `code`, `details`, `timestamp` |
| `handleError(error, options)` | Map an error to a user-facing message, log it, optionally toast it |
| `withErrorHandling(fn, options)` | Wrap an async function |
| `retryWithBackoff(fn, options)` | Exponential backoff with a `shouldRetry` predicate |
| `reportClientError(error, context)` | Forward one client error to the analytics pipeline as a `client_error` event |

`reportClientError` rides the existing analytics pipeline rather than a
dedicated endpoint — no new surface, no new auth, no new table. It caps at
**10 reports per page load** and deduplicates by `name:message` signature,
because an error inside a render loop would otherwise become the outage. The
reported path is `pathname + hash`, never the query string: that can carry a
reset or magic-link token, and this payload is persisted.

---

## Feature modules

### `chat.js` (1,596 lines, lazy)

`export function initChat()` — one large initialiser driving **two surfaces**
from the same state: the floating chat widget and the full-page `#ai` section.

Constants: `MAX_SESSIONS = 50`, `TOKEN_LIMIT = 2000` (warn at 1500, error at
1950), `SUMMARIZE_TOKEN_THRESHOLD = 6000`, `MARKDOWN_PARSE_THROTTLE_MS = 100`,
`FREE_MESSAGE_LIMIT = 6` (**must match `CHAT_FREE_MESSAGE_LIMIT` server-side**).

Internals worth knowing:

| Area | Behaviour |
| :--- | :--- |
| Rendering | `renderBotHTML` = `DOMPurify.sanitize(marked.parse(text))`, degrading to escaped text with `<br>` if either global is missing |
| Code blocks | A custom `marked` renderer injects a copy button carrying the source as a URI-encoded `data-code` attribute; a delegated document listener handles the copy |
| Highlighting | `syntax-highlighter.js`, not a library |
| Sessions | Up to 50 conversations in `localStorage` (`rj_chat_sessions`, `rj_chat_active_session`), with a sidebar for rename/delete/switch |
| Streaming | `authenticatedFetch` → `response.body.getReader()`, manual SSE line parsing, throttled markdown re-parse, `AbortController` for stop-generation |
| Metrics | The `{"type":"metrics"}` frame is kept **per turn** as well as on `window.lastStreamMetrics`, so a message's info drawer keeps reporting its own latency after later turns move the global on |
| Summarisation | At `SUMMARIZE_TOKEN_THRESHOLD` estimated tokens, everything before the current message is sent to `/chat/summarize` and replaced by the summary |
| Auth | A `401` while signed out dispatches `request-login-modal` rather than showing a raw error |
| Voice | Separate `SpeechRecognition` instances per input — a shared singleton had both mic buttons overwriting each other's `onresult` and routing transcripts to the wrong field. Buttons are hidden entirely when unsupported |
| Accessibility | `announceToScreenReader` for streamed replies |

### `activity.js` (1,181 lines, lazy)

`initActivity()`, `loadActivity()`, `loadActivitySummary()`,
`loadActivityFunnel()`.

The section answers one question for the reader: *what has this site recorded
about my visit?* The whole session is fetched once (`limit=500`, the API's own
page ceiling) and held in memory, so every filter — search, family, time slice,
path — is local and instant, and the session strip has the complete series it
needs.

**Four families over ten event types**, because four hues are learnable at a
glance and seven are a legend: `nav` (page_view, scroll_depth), `tap` (click,
terminal_command), `pref` (theme_change and other preferences), `reach`
(copy_email, contact_submission, contact_prompt). The grouping carries the
colour encoding across the strip, chips, dots and bars.

Also owns: the live SSE connection (`EventSource` with `withCredentials: true`
so the `HttpOnly` session cookie is sent even when the API is on another port),
frame normalisation between the compact and verbose shapes, the pipeline DAG
painted from `pipeline`/`hello` frames, a rolling 200-sample latency reservoir
fed by `onTelemetry`, focus restoration across re-renders, and paginated
grouped rows (`PAGE_SIZE = 20`).

### `activity-charts.js` (194 lines)

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

### `form.js` (323 lines)

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

### `resume-pdf.js` (75 lines)

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

### `registry.js` (297 lines)

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

### `output.js` (104 lines)

DOM-node builders — `line`, `text`, `err`, `pre`, `list`, `columns`, `tags`,
`frag`, `echoLine`. Every builder writes user-controlled strings through
`textContent`, **never `innerHTML`**, so escaping is structural: a command
handler cannot inject markup even if it forgets to sanitise.

### `history.js` (118 lines)

`createHistory({storage, key})` — bounded (100 entries), sanitised (non-strings
rejected, entries truncated at 500 characters individually so one oversized
entry never discards the list), debounced persistence (400 ms), and a one-time
migration from the v1 key. `export const STORAGE_KEY = "rj_terminal_history_v2"`.

### `keymap.js` (106 lines)

`Intent` (`SUBMIT`, `HIST_PREV`, `HIST_NEXT`, `COMPLETE`, `CLEAR`, `ABORT`,
`NONE`), `intentFor(event)`, `commonPrefix(candidates)`,
`completeInput(raw, registry, ctx)`. Kept away from the DOM so the binding table
is testable and the palette can reuse the same vocabulary.

### `palette.js` (177 lines)

`initPalette({registry, run, panel})` — the `Ctrl+K` overlay. A second renderer
over the same registry, which is the payoff for modelling commands as data:
every terminal command is reachable site-wide with no duplicated list.
`role="dialog"`, `aria-modal`, focus restoration on close.

### `index.js` (316 lines)

`initTerminal()` — owns all DOM wiring, the output log (capped at
`MAX_BLOCKS = 200`, because unbounded output left hundreds of nodes under a
`backdrop-filter` ancestor), rotating placeholders, the mobile chip row, the
matrix toggle (`rj_terminal_matrix`), and the `ctx` object handed to commands
(navigation via `navigateToSection`, theme via `toggleTheme`, analytics via
`trackEvent`).

---

## UI and interaction

### `navigation.js` (527 lines)

`initNavigation()`, `setActiveSection(target)`,
`navigateToSection(target, {updateHash})`, `syncSectionWithHash(hash)`,
`closeAllDropdowns()`.

Hash-based section routing, header state on scroll, the hamburger menu, dropdown
menus, the image modal, keyboard shortcuts, the mobile bottom nav, swipe
gestures between sections, and online/offline banners. `isModalOpen()` checks
**both** dialog implementations — `.image-modal.active` and
`#auth-modal:not(.hidden)` — or shortcuts would fire through an open dialog.

### `modal.js` (124 lines)

`openModal(modal, {initialFocus, onClose})`, `closeModal(modal, {restoreFocus})`,
`getFocusableElements(container)`, `handleFocusTrap(event, modal)`.

Focus trapping, focus return via a `WeakMap`, per-modal teardown callbacks, and
a **reference-counted** body scroll lock — nested opens must not each stash
their own scroll position, so only the outermost close restores the page.
Integrates `ModalSwipeDismiss` for touch.

### `swipe-handler.js` (249 lines)

`SwipeHandler`, `PullToRefresh`, `ModalSwipeDismiss`. `SwipeHandler` records
whether `touchstart` accepted the gesture, because `touchstart` and `touchend`
filtering independently on their own targets (which differ) produced phantom
swipes.

### `skills-carousel.js` (253 lines)

`initSkillsCarousel()` — a carousel below 640 px and a static grid above.
Autoplay at 4.5 s, 40 px swipe threshold, dot navigation, paused under
`prefers-reduced-motion`. Initialises after two `requestAnimationFrame` ticks so
measurements happen on a painted layout.

### `ripple.js` (31 lines)

`initRipple()` — **one** delegated `pointerdown` listener on `document` for
`.btn`, `.contact-copy-btn`, `.contact-prompt`. Binding per element was both
memory overhead and blind to dynamically created nodes.

### `scroll-to-top.js` (36 lines)

`initScrollToTop()` — injects the button, shows at 500 px and hides at 300 px
(hysteresis avoids flicker), and honours `prefers-reduced-motion` for the scroll
itself.

### `tilt.js` (97 lines)

`initTilt()` — pointer-tracked 3D tilt on `.tilt-card`, `requestAnimationFrame`
batched, and a complete no-op without hover support or with reduced motion.

### `theme.js` (73 lines)

`initTheme()`, `applyTheme(isDark)`, `toggleTheme()`. `toggleTheme` is exported
so callers (the command prompt) need not synthesise a click on `#theme-toggle`.
Updates the `theme-color` meta from the **computed** `--accent-fill`, so a
custom accent is reflected in the browser chrome.

### `theme-customizer.js` (540 lines)

`initThemeCustomizer()`, `reapplyCustomTheme(isDark)`. Derives a full palette
from one hex accent (`hexToHsl`, `generateVariants`), checks contrast
(`getLuminance`, `getContrast`) before applying, writes CSS custom properties
onto `document.body`, and persists to `localStorage.rj_theme_palette`.
`clearCustomPalette()` restores the defaults.

---

## Visual effects

### `three-bg.js` (1,507 lines, lazy)

`export function initThreeBackground()` — the full-viewport animated plexus:
drifting nodes joined by proximity lines, with glass facets between close
triples.

**The filename is historical.** It is a plain 2D-canvas renderer
(`getContext("2d")`) and there is no Three.js anywhere in this repository. A
1.3 MB unreferenced `three.module.js` was published to the web root on every
deploy until it was removed; nothing had ever imported it. Renaming the module
would churn `main.js` and the service-worker precache for no functional gain.

Notable internals: spatial-grid neighbour search rather than an O(n²) sweep,
sprite caching keyed by a palette signature so a theme change rebuilds sprites
once, device-profile-driven particle counts, zone-based seeding that keeps the
centre of the viewport clear (so the hero text stays readable), pointer
interaction, and a full teardown when reduced motion is enabled mid-session.
It mounts itself on import and manages its own listeners.

### `particles-config.js` (255 lines)

`initParticles(containerId)` → a teardown function. The **cheap fallback** for
the same idea, scoped to the hero. Mutually exclusive with the plexus:
`MAX_PARTICLES = 90`, one particle per 18,000 px², 120 px link distance.
Never animates off-screen or on a hidden tab, motion is time-based so it looks
identical at 60 Hz and 120 Hz, a resize rescales the field in place rather than
reseeding it, and everything it attaches is removable via the returned teardown.

### `animations.js` (296 lines)

`initAnimations()` — scroll reveals via `IntersectionObserver` (all revealed
immediately under reduced motion or without the API), animated stat counters,
the terminal intro sequence, a matrix-style text decode effect, spring-driven
hover states, and page transitions.

### `hero-title.js` (179 lines)

`initHeroTitle()` — tokenises the hero title into words and characters
(preserving wrapping), plays a staggered 3D roll-up entrance, and adds a
magnetic pointer tilt with a specular highlight. Fully reduced-motion aware.

### `physics.js` (75 lines)

`Spring` (stiffness / damping / mass / rest thresholds) and
`animateSpring({from, to, onUpdate, onComplete, config})` — a small spring
integrator that gives `animations.js` framework-quality motion without a
framework.

### `confetti.js` (144 lines)

`triggerConfetti(options)` and `confettiPresets`. Canvas-based, self-removing,
colours read from CSS custom properties so it matches the active accent.

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
