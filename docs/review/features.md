# Feature Proposals

> **Status: all six implemented, and both defects fixed.** Delivered across
> five commits on `claude/codebase-feature-proposals-u4vdgy`, one per
> proposal. This document is kept as the record of *why* each was built — the
> line numbers in each entry point at the code **as it was**, before the
> change. The reference docs describe the code as it is now.
>
> Two things surfaced during implementation and are worth recording here,
> because both were caught by existing guards rather than by review:
>
> - The contact form's first-party endpoint was written to fall back to
>   FormSubmit on *any* failure. `contact-form.test.js` already asserted that a
>   timed-out request is never retried — aborting cancels the browser's wait,
>   not the POST in flight — so the fallback was narrowed to the two outcomes
>   that prove nothing was sent: an unreachable API, and the route's own 502.
> - `Reply-To` was built with an f-string. A display name containing an angle
>   bracket produced a header parsing as a different address entirely, so it is
>   built with `formataddr` now.

Grounded feature review of `rjWebApp`. Every proposal below points at code that
exists today — a half-built surface, a duplicated fact, or an unread table.
Nothing here is a generic "portfolios should have X" suggestion.

Ranked by **value-to-effort**, not by value alone. Effort is S (a sitting),
M (a weekend), L (more than that).

## Assumed context

The brief that produced this document left its context block unfilled, so the
audience and roadmap below are read out of the repo rather than supplied.
Correct any of these and the ranking moves:

| Assumption | Read from |
| :--- | :--- |
| Priority order is visitors/recruiters → the code as a work sample → the owner's own tools | `AGENTS.md`, "What This Project Is" |
| The Activity dashboard and AI chat are the owner's tools and demos, not a product | same |
| The standing roadmap is ADR-011 and ADR-012 (both `Proposed`) plus the ten rows in `docs/SECURITY.md` "Known limitations" | `docs/ADR.md`, `docs/SECURITY.md` |
| The 28 UI/UX findings are closed, not pending | `docs/review/uiux.md` header |
| No open complaint stream was available; "the user problem" below is inferred from code behaviour | — |

---

## Already half-built

Three surfaces have a finished tier underneath and no tier on top. They are the
first three proposals for that reason.

| Surface | Built | Missing |
| :--- | :--- | :--- |
| Server-side chat history | `ai_conversations` model, its migration, `chat_history_service.py`, three routed endpoints, six integration tests | Any UI caller. `docs/API.md`'s endpoint matrix says so outright: "server-side history is API-only today" |
| Aggregate analytics | Nine event types landing in `user_activity_events`, a GIN index on `event_data`, a funnel algorithm, reusable pure-function chart renderers | Any query that is not scoped to one `session_id` |
| Email verification | `one_time_tokens` with a purpose-checked redemption path, two link-email templates to copy, `users.is_active` already enforced at login | The fourth purpose and one route |

---

## 1. Wire the chat UI to the conversation history that already ships

**Effort: S–M** — the backend is done.

### The problem

A signed-in visitor's conversations live only in `localStorage`. Three ways
they are lost:

- `saveSessions()` truncates to `MAX_SESSIONS = 50` and drops the remainder
  with no notice (`frontend/js/chat.js:441-444`).
- A quota error or blocked storage is caught and warned about, and the
  conversation is gone on reload (`frontend/js/chat.js:445-449`).
- Nothing syncs between the owner's phone and laptop, which is exactly how a
  demo tool gets used.

### There is a live data bug underneath it

`chat.js` sends `body: JSON.stringify({ messages, stream: true })`
(`frontend/js/chat.js:1528`). No `conversation_id` — even though
`ChatStreamRequest` accepts one (`server/schemas/chat.py`) and the streaming
route reads it (`server/routes/chat_routes.py:137-141`).

With `conversation_id=None`, `save_or_update_conversation` skips the update
branch entirely and mints a fresh row: `id=conversation_id or uuid.uuid4()`
(`server/services/chat_history_service.py:75-89`).

So for a signed-in user, **every assistant turn writes a new
`ai_conversations` row carrying the entire transcript up to that point.** A
ten-turn conversation is ten rows, not one, and the payloads grow with each.
`GET /chat/history` would today return ten near-identical entries for one
conversation. The table is being written and never read, so this has been
invisible.

### Why this codebase is positioned for it

Everything server-side is finished and tested: compression
(`compress_messages`, zlib level 6), title derivation from the first user
message, ownership scoping on read and delete, and
`tests/backend/integration/test_chat_history.py` covering cross-user access and
the anonymous no-write case. The sidebar the transcripts would render into
already has search, date-bucketed grouping (`historyBucket()`), and — since
uiux.md finding 13 — a delete confirmation.

### Implementation shape

1. `createNewSession()` builds its id as `Date.now().toString()`
   (`chat.js:455-462`). Switch to `crypto.randomUUID()` and send it as
   `conversation_id` on every turn. This alone collapses the row-per-turn
   growth.
2. On login, `GET /chat/history` and merge the server list into `sessions`,
   lazily fetching `GET /chat/history/{id}` when a conversation is opened.
   `renderSidebar()` needs no change if the merged objects keep their shape.
3. Point the existing delete confirmation at
   `DELETE /chat/history/{conversation_id}` for server-backed rows.
4. Decide on the existing duplicate rows: a one-off cleanup migration, or let
   them age out — the listing is `LIMIT 50` ordered by `updated_at`.

Anonymous visitors keep the pure-`localStorage` path unchanged; nothing about
the deliberately-anonymous `POST /chat` contract moves.

---

## 2. One structured résumé source, generated into the copies

**Effort: S for the first slice, M for the whole thing.**

### The problem

The AI assistant tells visitors this site is built with **Three.js**:

```
server/services/bedrock_service.py:109
- Frontend Stack: Vanilla JS ES Modules, Three.js, CSS Glassmorphism, ...
```

`README.md:47` and `AGENTS.md` both state the opposite in as many words —
there is no Three.js in the repo, and `three-bg.js` is a plain 2D canvas whose
filename is historical. A recruiter who asks the chat what the site is built
with gets an answer the repository itself documents as false. The same prompt
also predates the arcade, the two bracket predictors, the terminal, 2FA and
the whole auth surface.

That is one symptom. The same biography is hand-maintained in five places:

| Copy | Where |
| :--- | :--- |
| The rendered Experience section | `frontend/index.html:1031+` |
| The JSON-LD `@graph` served to search engines | `frontend/index.html:104+` |
| `SKILL_GROUPS` and `SKILL_TAGS` for the terminal | `frontend/js/terminal/registry.js:37-52` |
| The downloadable PDF | `frontend/rjasti_resume.pdf` |
| The chat persona's "Key Information" block | `server/services/bedrock_service.py:101-114` |

### Why this codebase is positioned for it

It already applies this exact principle one level down, and says why:

```js
// frontend/js/terminal/registry.js:105-106
// Read from the rendered stat cards rather than a second hardcoded copy,
// so the terminal can never disagree with the page above it.
```

`scripts/` is also an established generated-artifact tier — `fonts.css`,
`fonts/`, the profile cutouts, the social previews, the launch images and the
brush backdrop are all generated, and the README marks each "do not hand-edit".
`scripts/check_docs.py` already exists as the pattern for a CI drift check,
and `build.mjs` has a clean `main()` to hook.

### Implementation shape

**Slice A (S, do this regardless):** move the persona's "Key Information" block
into a `server/config/resume_context.py` constant and correct it. Fixes a
false public-facing claim today with no HTML rewriting, no build change, and
no CSP risk.

**Slice B (M):** `content/resume.json` as the source. A generator emits the
Experience section and the JSON-LD into `index.html` between marker comments,
the two `registry.js` constants, and the file from slice A. A `check_resume`
step alongside `check_docs` fails CI on drift.

**Constraint that shapes slice B:** `index.html` carries three `sha256-` CSP
hashes over its inline scripts and is in `.prettierignore` for that reason. The
generator must rewrite only marked regions and never touch those scripts, and
`npm run check:csp` has to stay green — that is the acceptance test, not an
afterthought.

---

## 3. Aggregate analytics for the owner

**Effort: M.**

### The problem

Every analytics read is scoped to one session. `activity.js` works from
`currentSessionId()` (`frontend/js/activity.js:346`), and every route it calls
is shaped `/sessions/{session_id}/…` (`server/routes/event_routes.py`).

Meanwhile Postgres has been accumulating nine event types — `page_view`,
`click`, `scroll_depth`, `terminal_command`, `theme_change`, `copy_email`,
`contact_submission`, `contact_prompt`, `client_error` — with no way to ask:

- How many visitors reached Contact this month, and where did the rest drop?
- Which terminal commands do people actually run? (That answer decides which
  commands are worth keeping.)
- Which contact prompt chips convert?

And the one nobody can see at all: `ai_llm_telemetry` events are written
server-side after every stream with `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_creation_tokens`, `cache_hit` and `latency_ms`
(`server/routes/chat_routes.py:105-120`). That is a complete Bedrock cost and
cache-efficiency record, in a table, unread. The chat UI shows per-conversation
totals (`renderUsageSummary()`); nothing shows the monthly bill.

### Why this codebase is positioned for it

- `get_session_path_funnel` already computes path transitions and edges — it
  needs a different `WHERE`, not a different algorithm.
- `activity-charts.js` is explicitly pure: "`activity.js` owns all state; every
  export here is a pure paint." `bucketSession`, `renderTimeline`,
  `renderPaths`, `percentile` and `latencyBand` all take data and a root node.
  They re-render a date range as readily as a session window.
- The events table is already indexed for this: `ix_events_session_created`
  for ordered scans and `ix_events_data_gin` for `event_data` containment.

### Implementation shape

`GET /admin/analytics/{overview,funnel,commands,llm-cost}` behind
`get_current_user`, each a SQL aggregate over a date range.

**Gap to close first:** `users` has no `role` column
(`server/models/user.py`), so there is no "owner" to authorise against today.
Two options — add one via Alembic (the chain is at 9 revisions, single head,
and CI runs `alembic check`), or gate on an `OWNER_EMAIL` setting, which
matches how this project already handles single-purpose config. The env-var
route is smaller and reversible; the column is right if accounts ever grow
past one.

Leave the visitor-facing "Session Activity" section exactly as it is. It is a
live demo of the ingest pipeline, not a report, and the two audiences want
different things.

---

## 4. Content search in the Ctrl+K palette

**Effort: S–M. Drops to S if proposal 2 lands first.**

### The problem

The palette matches command names and summaries only:

```js
// frontend/js/terminal/palette.js — matches()
.filter((command) => command.name.includes(word) || command.summary.toLowerCase().includes(word))
```

A visitor looking for "Redshift" or "Kafka" gets nothing. Browser Ctrl+F is not
a fallback either: the SPA is one 132 KB page whose router shows one section at
a time, so find-in-page only reaches the section currently rendered.

### Why this codebase is positioned for it

ADR-022 made commands data specifically so the palette could be a second
renderer over one registry, and the file says so in its opening comment:
"the palette is a second renderer over the same registry, so every command
written for the terminal is reachable site-wide." Adding a second *result kind*
is the next move along that same seam rather than a new mechanism. The
combobox/listbox semantics and focus restore are already correct there.

And it compounds with proposal 2: `content/resume.json` is the search index.

### Implementation shape

Extend `matches()` to merge command hits with content hits from a small
prebuilt index of `{ section, heading, snippet }`. Enter on a content hit calls
the same `ctx.navigate(section)` the `cd` command uses, then scrolls to an
anchor. Render content hits as a visually distinct group so the two kinds do
not read as one list.

---

## 5. First-party contact endpoint

**Effort: S.**

### The problem

The contact form — the conversion path — POSTs to a third party:

```js
// frontend/js/form.js:310
response = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
```

This is the single third-party runtime egress in an SPA whose entire ADR-016
posture is that no third-party origin belongs in it. It costs two CSP
allowances (`form-action` and `connect-src`), and delivery, spam filtering and
failure visibility all sit outside the owner's control.

### Why this codebase is positioned for it

`server/services/notification_service.py` is a hardened SMTP sender already:
shared connection settings with certificate validation for anything
non-loopback, an `EmailMessage` builder, an `_wrap_html` template, and a
documented "return False rather than raise" contract. `BackgroundTasks` email
dispatch is the established pattern in `auth_routes.py`. The honeypot field is
already in the markup and already read (`frontend/js/form.js:299`). Rate-limit
middleware already exists.

### Implementation shape

`POST /contact` with a length-bounded Pydantic schema, the honeypot check moved
server-side, its own rate budget, and a `send_contact_email` beside the three
senders already there. `form.js` tries the first-party endpoint and falls back
to FormSubmit when the API is unreachable — which preserves the standing rule
that the frontend runs standalone and every backend-dependent feature degrades
quietly.

Once it ships, three `connect-src` entries can go: `formsubmit.co`, plus
`get.geojs.io` and `api.open-meteo.com`, which `docs/SECURITY.md:374` already
flags as dead allowlist entries widening the policy for nothing.

---

## 6. Email verification on registration

**Effort: S. Value depends on a fact this review cannot see.**

`docs/SECURITY.md` lists it under "Known limitations" with the path forward
already written: "Add a verification one-time token, reusing the existing
table."

The table is ready for it. `one_time_tokens.purpose` carries a documented
three-value vocabulary, and `consume_one_time_token` rejects a token spent for
the wrong purpose. `issue_one_time_token` is generic over purpose.
`send_password_reset_email` and `send_magic_link_email` are near-identical
templates to copy. `users.is_active` exists and `authenticate_user` already
refuses inactive accounts.

So: a `PURPOSE_EMAIL_VERIFY` constant, an unverified state at registration, a
`POST /auth/verify-email` route, one email, one auth-ui state.

**Ranked last deliberately.** This is a personal site with one real account.
The limitation is only worth closing if junk registrations are actually
arriving — that is the fact the review cannot see from here. If they are, it
moves up to #3.

---

## Not proposed, and why

| Idea | Why not |
| :--- | :--- |
| A model picker in the chat UI | ADR-023 is explicit that the server owns the persona and its cost ceilings. `GET /models` is unused (`docs/API.md` matrix) — the move is to **delete** the route, not build a UI onto it |
| Virtual scrolling (ADR-011) | `activity.js` fetches 500 events and pages 20 at a time. Not a bottleneck at one session's volume. Revisit if proposal 3 lands and the aggregate views page over months |
| Redis-backed rate limiting (ADR-012) | Only pays off past one API instance, and nothing here needs a second one. It is correctly parked |
| A framework, a component model, any third-party asset origin | ADR-001 and ADR-016. Arguing against these is a separate conversation, not a feature |
