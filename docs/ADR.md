# Architecture Decision Records

Numbered decisions, their status today, and — where a decision has been
superseded — what replaced it and why.

**Status legend:** `Accepted` (in force) · `Superseded` (replaced; the record is
kept for history) · `Amended` (in force, with the correction noted) ·
`Proposed` (not implemented).

**Adding one:** take the next free number from the table below — currently
**026** — append the record at the end of the file and add its row above. The
shape is `## ADR-0NN: Title`, `**Status**:`, then `### Context` (the forces in
play), `### Decision` (what was chosen, in the present tense), `### Rationale`
(why — ideally with the measurement that settled it) and `### Consequences`
(what this costs, including what it makes harder). Superseding a record does not
delete it: set its status to `Superseded by ADR-0NN`, add a `### Why it was
superseded` section, and cut the body back to a summary.

| # | Decision | Status |
| ---: | :--- | :--- |
| 001 | Vanilla JavaScript over a framework | Accepted |
| 002 | Service worker for PWA | Superseded by ADR-018 |
| 003 | FastAPI for the backend | Amended |
| 004 | No ORM, raw SQL | Superseded by ADR-014 |
| 005 | Incremental DOM updates | Accepted |
| 006 | SRI verification in the service worker | Superseded by ADR-016 |
| 007 | URL-based pagination state | Superseded by ADR-020 |
| 008 | Environment-aware API configuration | Amended |
| 009 | Toast notifications for async operations | Accepted |
| 010 | Lazy loading with IntersectionObserver | Amended |
| 011 | Virtual scrolling | Proposed |
| 012 | Redis caching for multi-instance rate limiting | Proposed |
| 013 | WebSocket for real-time updates | Superseded by ADR-019 |
| 014 | SQLAlchemy ORM + Alembic migrations | Accepted |
| 015 | Capability tokens for anonymous analytics sessions | Accepted |
| 016 | Self-host and vendor every third-party asset | Accepted |
| 017 | esbuild build step with content hashing | Accepted |
| 018 | Network-first documents, stale-while-revalidate assets | Accepted |
| 019 | Server-sent events over WebSocket | Accepted |
| 020 | Fetch the session once, filter locally | Accepted |
| 021 | Hash-pinned, universally-resolved dependency locks | Accepted |
| 022 | Commands as data | Accepted |
| 023 | Server owns the chat persona and its cost ceilings | Accepted |
| 024 | Design tokens are the styling contract | Accepted |
| 025 | One motion scale, shared by CSS and JS | Accepted |

---

## ADR-001: Vanilla JavaScript over a framework

**Status**: Accepted

### Context
Choose between vanilla JavaScript and a framework (React, Vue) for the frontend.

### Decision
Vanilla JavaScript with ES modules.

### Rationale
- **Performance** — no framework overhead; faster initial load.
- **Simplicity** — a single-page portfolio does not need a virtual DOM.
- **Demonstration** — the site is itself a portfolio piece.
- **Bundle size** — two runtime dependencies (DOMPurify, marked), both vendored.
- **Control** — full control over DOM manipulation and optimisation.

### Consequences
- More manual DOM code; state lives in module closures.
- No component model, so large surfaces (`chat.js`, `auth-ui.js`) became long
  single initialisers.
- Easier to optimise for specific cases, and no framework upgrade treadmill.

---

## ADR-002: Service worker for PWA

**Status**: Superseded by ADR-018 (caching strategies) and ADR-016 (no CDN)

### Context
Offline support and better performance for returning visitors.

### Decision (original)
A service worker with cache-first for CDN resources and stale-while-revalidate
for the app shell.

### Why it was superseded
Both halves changed. There are no CDN resources any more (ADR-016), so
`ALLOWED_ORIGINS` is empty. And stale-while-revalidate for documents served the
previous deploy's HTML against the current deploy's assets — a mismatch that
only resolved on the *second* reload (ADR-018).

The core decision — ship a service worker — stands.

---

## ADR-003: FastAPI for the backend

**Status**: Amended

### Decision
FastAPI with async SQLAlchemy over asyncpg for PostgreSQL, and boto3 for Amazon
Bedrock.

### Rationale
- Async/await throughout, which the streaming endpoints depend on.
- Pydantic v2 for validation at the boundary.
- Auto-generated OpenAPI docs.
- Rich AWS ecosystem.

### Amendments
Two consequences recorded originally are no longer true:

- ~~"Database migrations not included (external tool needed)"~~ — Alembic is
  in-repo with nine revisions and a CI drift check (ADR-014).
- ~~"No built-in authentication (intentional for demo)"~~ — the service now has
  a full authentication system: JWT access/refresh with rotation, TOTP 2FA,
  magic links, password reset, breach checking, password history, account
  lockout and soft deletion. See [`SECURITY.md`](SECURITY.md).

---

## ADR-004: No ORM, raw SQL

**Status**: Superseded by ADR-014

Raw `asyncpg` queries were chosen for directness. They became error-prone as the
authentication models arrived: manual parameter binding, fragmented query
strings, and no schema versioning at all.

---

## ADR-005: Incremental DOM updates

**Status**: Accepted

### Context
Rebuilding the activity list on every refresh caused flicker and lost expanded
row state and focus.

### Decision
Update incrementally, and explicitly restore focus across re-renders.

### Consequences
More complex rendering logic (`FOCUS_SCOPES`, `focusKey`, `restoreFocus` in
`activity.js`), in exchange for a list that does not fight the reader — and a
live SSE stream that appends rather than refetches.

---

## ADR-006: SRI verification in the service worker

**Status**: Superseded by ADR-016

### Context
CDN resources could be compromised, so the worker verified Subresource Integrity
hashes before caching them.

### Why it was superseded
The problem was removed rather than mitigated. With every asset self-hosted
(ADR-016) there is no cross-origin resource to verify: `ALLOWED_ORIGINS` in
`sw.js` is the empty set, and the CSP's `script-src` is `'self'` plus three
pinned inline hashes. Maintaining SRI hashes for resources that no longer exist would
be pure cost.

---

## ADR-007: URL-based pagination state

**Status**: Superseded by ADR-020

Pagination state in query parameters was proposed for shareability and refresh
survival. The dashboard now fetches the whole session once and filters in
memory, so "page" is a view over local state rather than a server request —
there is nothing meaningful to put in the URL, and a shared link would point at
another visitor's session anyway. Pagination state is held in the module.

---

## ADR-008: Environment-aware API configuration

**Status**: Amended

### Decision
Auto-detect the API base from `window.location.hostname`.

### Rationale
- Works out of the box locally, with no build-time configuration.
- No credentials or environment files in the frontend.

### Amendments
- The `window.APP_CONFIG` override described originally was never implemented
  and does not exist. Resolution is entirely by hostname.
- `getApiBaseUrl()` lives in `frontend/js/analytics.js`, **not** `config.js`.
- A localhost base additionally probes `/health` and falls back to the
  production API if the local backend is down.

### Consequences
Adding an API origin means touching two places: `getApiBaseUrl()` and the
`connect-src` directive of the CSP in `index.html`.

---

## ADR-009: Toast notifications for async operations

**Status**: Accepted

`showToast(message, type)` in `utils.js` — `role="status"` for screen readers,
icon per type, auto-dismissed after 3.2 s, appended to a `#toast-container`.
Used for copy confirmations, network errors and form feedback.

---

## ADR-010: Lazy loading with IntersectionObserver

**Status**: Amended

`IntersectionObserver` is used, but for **animation and visibility gating**, not
image loading:

- `animations.js` — scroll reveals and stat counters.
- `skills-carousel.js` — initialise when visible.
- `particles-config.js` — never animate off-screen.

Images use the browser's native `loading="lazy"` instead. The `data-src`
mechanism and the `lazyLoadImages()` helper described in the original record
were never implemented.

The related decision that *is* in force is lazy **module** loading:
`main.js` dynamically imports `chat.js`, `activity.js` and `three-bg.js` only
when needed, and the build's generated precache list deliberately excludes those
chunks so the service worker does not undo it.

---

## ADR-011: Virtual scrolling

**Status**: Proposed

For an activity list with thousands of rows, render only visible rows. Not
needed today — the API caps a page at 500 events, which is far beyond any real
browsing session, and the list is paginated at 20.

---

## ADR-012: Redis caching for multi-instance rate limiting

**Status**: Proposed

The in-memory sliding-window limiter is per process, so N instances means N×
the intended budget. A shared store is required before running more than one
instance. The same constraint applied to SSE fan-out and was solved differently
— see ADR-019.

---

## ADR-013: WebSocket for real-time updates

**Status**: Superseded by ADR-019

---

## ADR-014: SQLAlchemy ORM + Alembic migrations

**Status**: Accepted (supersedes ADR-004)

### Context
Raw SQL, manual parameter binding and script-based schema setup became
error-prone as the authentication models arrived.

### Decision
SQLAlchemy ORM with the async `asyncpg` driver, and Alembic for versioned
migrations.

### Rationale
- Declarative models replace fragmented query strings.
- Automatic parameter binding removes a whole injection class.
- Structured, trackable, reversible schema changes.
- Better type hinting and alignment with the Pydantic models.

### Consequences
- Migrations must be run for local and production setup.
- An extra abstraction layer, and session lifecycles must be managed carefully
  (FastAPI dependency injection, `expire_on_commit=False`).
- CI runs `alembic check` against real PostgreSQL, so a model changed without a
  migration cannot reach the deploy.
- `server/models/__init__.py` must import every model, or autogenerate stops
  seeing that table and proposes dropping it.

---

## ADR-015: Capability tokens for anonymous analytics sessions

**Status**: Accepted

### Context
Activity endpoints identified a visitor solely by the `session_id` in the URL.
Anyone holding or guessing an id could read that visitor's full behavioural
trail and device metadata, or write events attributed to them — and `POST
/events` answered 404 for an unknown session and 201 for a real one, which made
the id space probeable.

### Decision
Issue an HMAC-SHA256 capability token at session creation and require it on every
session-scoped call. Deliver it in the response body, and also as an `HttpOnly;
SameSite=Strict` cookie.

### Rationale
- Requiring a login is impossible: these sessions exist precisely so an
  anonymous visitor can be tracked.
- An HMAC over the id needs no storage and cannot be derived from the id alone.
- The cookie covers `EventSource`, which cannot set headers — the alternative
  was a query parameter that landed in access logs, browser history and
  `Referer`.
- A 403 identical whether or not the session exists closes the probing oracle.

### Consequences
- Rotating `JWT_SECRET` invalidates every live session token (browsers create
  fresh sessions automatically).
- The client must store the token alongside the id; a pre-token session is
  discarded on load.
- The event queue must be namespaced per session, or a second tab flushes the
  first tab's events with its own token and loses the batch to a 403.

---

## ADR-016: Self-host and vendor every third-party asset

**Status**: Accepted (supersedes the CDN half of ADR-002 and all of ADR-006)

### Context
Two render-blocking third-party stylesheets (Google Fonts, cdnjs for Font
Awesome) sat in the critical path, plus CDN-loaded DOMPurify and marked. Each
was an independent single point of failure — a corporate proxy, an ad blocker or
a regional block was enough. Measured with the CDNs stalling, first contentful
paint was 3.2 s against ~250 ms for the site's own assets.

### Decision
Self-host and subset the fonts (`scripts/vendor_fonts.py`); vendor DOMPurify and
marked verbatim from the pinned npm packages.

### Consequences
- `script-src` is `'self'` plus three pinned inline hashes; `font-src` is `'self'`.
- The service worker's cross-origin allowlist is empty.
- SRI verification became unnecessary (ADR-006 superseded).
- Font and library updates are manual, committed steps rather than a version
  bump in a URL — `vendor_fonts.py` needs network access, so it is a maintenance
  script rather than part of the build.

---

## ADR-017: esbuild build step with content hashing

**Status**: Accepted

### Context
There was no build step: the deploy rsynced source verbatim, so the site shipped
unminified CSS and ~30 separate ES module requests. Because filenames were not
content-hashed, `.htaccess` had to hold CSS and JS at `max-age=3600,
must-revalidate` — every returning visitor revalidating every file, every hour.

### Decision
`scripts/build.mjs` emits `dist/` with esbuild: bundled, minified,
content-hashed, code-split, with a generated service-worker precache list.

### Rationale
- Content hashing makes `immutable` caching safe, which is the whole point.
- Code splitting preserves the lazy loading `main.js` arranges.
- Generating the precache list removes a hand-maintained 40-entry list that both
  defeated lazy loading and could fail `cache.addAll` outright.

### Consequences
- `frontend/` must stay runnable standalone — the build only reads from it.
- Inline `<script>` bodies must never be touched, or the CSP hashes break.
  The build rewrites attributes only, and `check_csp_hashes.py` verifies the
  built page as well as the source.
- The build throws rather than silently no-opping if its rewrites do not match.

---

## ADR-018: Network-first documents, stale-while-revalidate assets

**Status**: Accepted (supersedes the caching half of ADR-002)

### Context
`index.html` names the hashed asset files. A stale cached copy points at a build
that no longer exists, so stale-while-revalidate for documents served the
previous deploy's HTML against the current deploy's assets — a mismatch that
only resolved on the second reload.

### Decision
Documents and navigations: network-first, cache as offline fallback.
Everything else same-origin: stale-while-revalidate. API responses: never cached.

### Rationale
Stale-while-revalidate is safe for content-hashed assets precisely because a
cached asset can never be the wrong version of itself. It is unsafe for the one
file that *names* them.

### Consequences
- A network round trip per navigation when online.
- `skipWaiting()` is not called on install; only the update banner's button
  requests it, so the asset set is never swapped under a running page.
- Precaching uses per-URL `cache.add` with `Promise.allSettled`, so one missing
  file cannot stop the worker installing and leave the visitor with no offline
  shell at all.

---

## ADR-019: Server-sent events over WebSocket

**Status**: Accepted (supersedes ADR-013)

### Context
The activity dashboard needs live event delivery.

### Decision
Server-sent events on a single connection carrying three named channels
(`hello`, `activity`, `pipeline`).

### Rationale
- The data flow is entirely server→client; a duplex channel buys nothing.
- `EventSource` gives automatic reconnection and `Last-Event-ID` resume for free.
- It is plain HTTP, so it passes through the existing proxy, CORS and middleware
  stack unchanged.
- Named channels avoid a second polling loop for pipeline health.

### Consequences
- `EventSource` cannot set headers, which is what drove the `HttpOnly` session
  cookie (ADR-015).
- Each listener queue must be bounded (`SSE_QUEUE_MAXSIZE`), dropping the oldest
  frame — a live tail beats a stale backlog.
- A per-session replay ring is needed to close the reconnect gap.
- Connections must be capped per session (`MAX_STREAMS_PER_SESSION`): an SSE
  request holds a worker slot indefinitely, and a session token is free.
- The registry is per process, so multi-instance deployments need
  `ENABLE_PG_FANOUT` (Postgres `LISTEN/NOTIFY`) — no extra infrastructure beyond
  the database already in the stack.

---

## ADR-020: Fetch the session once, filter locally

**Status**: Accepted (supersedes ADR-007)

### Context
The activity dashboard offers search, event-family, time-slice and path filters,
and draws a session-wide timeline strip.

### Decision
Fetch the whole session in one request (`limit=500`, the API's own page ceiling)
and hold it in memory. Every filter is local.

### Rationale
- 500 events is far beyond any real browsing session.
- Filtering becomes instant, with no request per interaction.
- The timeline strip needs the complete series to draw a shape at all.
- Server-side aggregates (`/summary`, `/funnel`) are still used for the headline
  figures and the path list, where the database does the work better.

### Consequences
- A session that somehow exceeded 500 events would be truncated.
- Pagination is a view over local state, so there is nothing to put in the URL
  (ADR-007 superseded).
- Live SSE events append to the in-memory set rather than triggering a refetch.

---

## ADR-021: Hash-pinned, universally-resolved dependency locks

**Status**: Accepted

### Context
Every package was specified with `>=`, and CI additionally installed its test
tools unversioned, so a breaking upstream release could reach production through
the deploy's `pip install` without a single line of this repository changing.

### Decision
`server/requirements.in` and `requirements-dev.in` are human-edited; both `.txt`
locks are generated with `uv pip compile --universal --generate-hashes` and
installed with `--require-hashes`.

### Rationale
- `--require-hashes` makes an unpinned or substituted artifact a hard failure
  rather than a silent upgrade.
- `--universal` emits environment markers so one lock covers every interpreter
  from 3.10 up. A single-version resolve pins conditional packages
  unconditionally — a 3.10 resolve pins `backports-asyncio-runner`, which
  refuses to install on 3.11 — so it breaks the moment CI and the host disagree.
- The dev lock includes the runtime set, resolved in one pass, so CI can never
  test against a different version of a shared package than production installs.

### Consequences
- Adding a dependency means regenerating **both** locks.
- CI tests Python 3.10 *and* 3.12, which is what proves the universal resolve.
- `test_dependency_locks.py` asserts every direct dependency is pinned, every pin
  carries a hash, and the two locks agree.

---

## ADR-022: Commands as data

**Status**: Accepted

### Context
The command prompt, the mobile chip row and the `Ctrl+K` palette all need to
know what commands exist. Behaviour bolted onto a DOM closure meant `help`,
tab-completion and the palette drifted from what was implemented, and commands
reached the page through hardcoded selectors that silently broke on refactors.

### Decision
Each command is a descriptor (`name`, `summary`, `usage`, `hidden`, `chip`,
`complete`, `run`) in `terminal/registry.js`. `run` receives an injected `ctx`
and returns DOM nodes built by `terminal/output.js`; it never touches
`document` directly.

### Rationale
- One source of truth for three surfaces — the palette is simply a second
  renderer over the same registry.
- Side effects go through `ctx`, so a nav or theme refactor cannot silently
  break a command.
- Output builders write through `textContent`, making escaping **structural**
  rather than something each handler must remember.

### Consequences
- Adding a command is a descriptor, and it appears in `help`, completion, the
  chips and the palette automatically.
- Commands cannot render arbitrary HTML — by design.

---

## ADR-023: Server owns the chat persona and its cost ceilings

**Status**: Accepted

### Context
`/chat` spends money per call and takes no authentication. It once accepted a
caller-supplied `system_prompt` with no length limit, and enforced its
free-message cap only in the browser.

### Decision
The server owns the system prompt (`bedrock_service.DEFAULT_SYSTEM_PROMPT`), and
every ceiling is enforced server-side: message count, per-message and total
characters, the anonymous free-message limit, a dedicated per-IP rate budget,
and a concurrency semaphore that `/chat/summarize` must also take.

### Rationale
- A caller-supplied system prompt turned the site's AWS account into a free
  general-purpose LLM, and billed up to `MAX_BODY_BYTES` of input tokens per
  request — the free-message limit counts *messages*, so one short message
  carrying a megabyte of prompt passed every check.
- Any limit enforced only in the browser is not a limit.

### Consequences
- The client's `FREE_MESSAGE_LIMIT` and summarisation threshold must stay in
  sync with the server's values; drift shows up as premature login prompts or
  422s.
- Changing the assistant's persona is a backend deploy.
- The concurrency slot must be released idempotently from two paths, because a
  client that disconnects before the body is iterated would otherwise leak it
  permanently.

---

## ADR-024: Design tokens are the styling contract

**Status**: Accepted

### Context
`frontend/styles.css` carries roughly 200 custom properties in its first 470
lines, and the reasoning behind them was written down only as comments beside
them. None of it was reachable from `docs/ADR.md`, from the `docs/README.md`
task index, or from `scripts/check_docs.py`. An agent sent to "change styling"
is routed to `FRONTEND.md#styling`, which would not have told it that the
three-hue separation is a standing constraint rather than an aesthetic
preference — so the most-cited rule in the stylesheet was also the least
discoverable thing in the repo.

Spacing made the cost concrete. Blur went from nine radii to four, the sheen
edge from twenty alphas to two, and type, elevation and radius were each
laddered deliberately — but spacing was never given the same treatment, and had
drifted to 36 distinct literals, because nothing recorded that putting a visual
dimension on a scale was the house rule.

### Decision
The token layer is the contract every stylesheet rule is written against, and
`docs/DESIGN.md` is its specification. Four rules hold:

1. **Three-hue separation.** The palette is built from exactly three hues, no
   two closer than 60° on the wheel. Saturation travels with the hue.
2. **Contrast is measured, not estimated.** Every `-text` variant is chosen
   against a computed ratio and clears WCAG AA for normal text on `--bg`.
3. **Every visual dimension is a scale.** Type, spacing, radius, elevation,
   blur, sheen and motion are ramps. A new value joins a ramp or becomes a named
   token; it does not become the 37th literal.
4. **Both themes, always.** A colour or elevation token defined under `:root`
   with no counterpart under `body.dark-theme` is a bug in one of the themes.

### Rationale
- The palette two revisions back paired amber with Solarized's own green and
  yellow: two of three hues within 30° of each other, which is one colour twice.
  The separation rule is what stops that recurring.
- `#fff` on the accent fill failed WCAG AA sitewide before `--on-accent` existed.
  Dark ink measures 11.2:1 on citron and 4.9:1 on azure, against 1.7:1 and 3.9:1
  for white — the kind of judgement eyes get wrong and a contrast function gets
  right.
- A scale nothing is obliged to use is documentation, not a system. Making the
  ramp the contract is what turns 36 spacing literals into eight rungs.

### Consequences
- New CSS must reach for a token. Where none fits, the change is to add a rung
  and say why, not to write a literal.
- The runtime palette engine (`frontend/js/theme-customizer.js`) writes over this
  layer on `body`, so **renaming a colour token is a two-file change**: the
  `clearCustomPalette` list must move with it, or a custom palette will fail to
  clear and the old property stays on `body` permanently.
- Values tuned against a specific layout stay off the ramp on purpose. The 10px,
  14px, 18px and 22px spacings in the hero, activity and chat regions are
  recorded exceptions, not debt.
- `docs/DESIGN.md` is a file that can go stale. It is prose, so
  `scripts/check_docs.py` cannot verify it beyond its size and heading count.

---

## ADR-025: One motion scale, shared by CSS and JS

**Status**: Accepted

### Context
The stylesheet defines six durations and three easings, and then went around
them. Of 132 `transition` declarations, 21 carried a raw duration; nine UI-state
transitions ran at a 200ms that is not a rung on the general ramp; five
`cubic-bezier()` curves sat inline with no name; and `frontend/js/animations.js`
declared `TERMINAL_INTRO_START_MS = 180` and `TERMINAL_INTRO_STEP_MS = 180` —
`--motion-base` restated in a second language, free to drift the moment the
token moved.

### Decision
`--motion-*` and `--ease-*` are the whole vocabulary of motion. Every UI-state
transition names a rung. Every easing is a token, including the single-purpose
ones. JS that animates alongside CSS reads the scale through
`motionMs(name, fallback)` in `frontend/js/config.js` rather than restating it.

### Rationale
- The five signature curves were folded *into* the token layer rather than onto
  `--ease-press`, because they are not interchangeable: the portrait flip, the
  hero title's per-character roll-up and the press ripple each read wrong on
  another curve. Homogenising them would have cost the site its character to buy
  tidiness — the opposite of the trade this decision is making.
- Snapping 250ms, 200ms and 150ms onto `--motion-medium`, `--motion-base` and
  `--motion-fast` moves each by 10–30ms, under the threshold at which a duration
  change is perceptible, and buys 38 declaration lines onto the scale.
- `--motion-page` (200ms) and `--motion-reveal` (520ms) are named for one job
  each — the section router and the IntersectionObserver reveal — and are
  deliberately not general rungs. Reaching for `--motion-page` on a button hover
  because the number looked close is the mistake this distinction prevents.
- Long-running ambient animations stay off the ramp. The scale spans 120–320ms
  and describes UI state changes; a 10s scanline or a 1.4s typing indicator has
  nothing to do with it.

### Consequences
- `motionMs` caches per token, so a stylesheet whose motion tokens changed at
  runtime would not be observed. Nothing does that today — the customiser writes
  colour only.
- The fallback argument is load-bearing under jsdom and in the window before the
  stylesheet applies, where the property resolves empty.
- Three transitions keep a raw duration by design: the 0.35s hero panel lift,
  the 0.45s portrait bounce and the 760ms portrait flip.
- The blanket `prefers-reduced-motion` rule in the ACCESSIBILITY region still
  overrides all of this, and must keep doing so.
