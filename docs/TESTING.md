# Testing

Two independent suites: Node's built-in test runner with jsdom for the frontend,
and pytest for the backend. Both run in CI on every push and pull request to
`main`.

- [Running the suites](#running-the-suites)
- [Frontend tests](#frontend-tests)
- [Backend tests](#backend-tests)
- [The test harness](#the-test-harness)
- [Coverage](#coverage)
- [Linting](#linting)
- [What is not tested](#what-is-not-tested)
- [Writing new tests](#writing-new-tests)

---

## Running the suites

```bash
# Frontend
npm test                                     # frontend/tests/*.test.js + scripts/tests/*.test.js

# Backend
PYTHONPATH=. pytest                          # pytest.ini sets testpaths
PYTHONPATH=. pytest tests/backend/unit        # one directory
PYTHONPATH=. pytest -k "session_token"        # by name
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55

# Lint
npm run lint                                 # ESLint + Stylelint
ruff check server tests
npm run check:csp                            # inline-script CSP hashes
```

`PYTHONPATH` must include the repository root. Node and npm are not always on
the default system `PATH` in agent environments — resolve the install path
first, or skip the JS suites and say so.

---

## Frontend tests

`frontend/tests/*.test.js` — Node test runner, jsdom for a DOM. No browser, no
Jest, no bundler.

| File | Lines | Covers |
| :--- | ---: | :--- |
| `app-logic.test.js` | 62 | `setActiveSection` and `aria-current`; `getValidHashTarget` fallbacks; that `main.js` lazily imports the activity module |
| `preboot-router.test.js` | 196 | **Refresh-flash regression.** The inline pre-boot section router in `index.html`, driven against a document that arrives in pieces the way a streaming response does: it sits above `<main>` and not after it, `#home` is stood down the moment it is parsed rather than once the document is complete, the target activates whether it arrives in a later parse or the same one, `#main-content` and unknown or wrong-case fragments leave home exactly as the markup has it, home is restored if the fragment names a nav link with no section, every nav target has a section to match, and `navigation.js` validates a fragment the same way the inline router does |
| `utils.test.js` | 208 | `escapeHTML` — both quote forms, an injected event handler failing to escape an attribute, and a visitor-controlled `page_path` in attribute position — plus `estimateTokens`, `debounce`, `throttle`, and `openModal`/`closeModal` ARIA handling |
| `activity-charts.test.js` | 310 | `bucketSession`, `renderTimeline`, `moveTimelineFocus`, `percentile`, `latencyBand`, `renderPaths` |
| `terminal.test.js` | 282 | Output builders escaping by construction; history (repeat collapsing, navigation, oversized entries, unparseable storage, flush persistence); individual commands; completion (common prefix, arguments, ambiguity, hidden commands never completed); keymap intents |
| `owner-analytics.test.js` | 162 | The owner panel asks for nothing when signed out; a 403 leaves the section as a visitor sees it with no empty shell; all six cards render for the owner; mistyped terminal commands are flagged; a failed panel is a `role="alert"` card rather than zeroes; the window picker re-requests every panel; signing out takes the panel down |
| `email-verification.test.js` | 82 | A 403 login is tagged `needsEmailVerification` (not string-matched) so the UI can offer a resend; a 401 is not; no tokens are stored on a refused login; verify-email and resend-verification post the right payloads and surface a rejected link |
| `chat-history-sync.test.js` | 281 | Server-side conversation history in the chat UI: every session gets a v4 UUID the route will parse; pre-`conversationId` sessions are backfilled without moving their local key; no history call when signed out; server conversations merge into the rail; a stub fetches its transcript only when opened; a failed load renders an error with a retry rather than an empty conversation; a 404 stub is dropped; delete removes the server copy; an unreachable API leaves local conversations intact |
| `palette-search.test.js` | 124 | Ctrl+K palette content search: the generated index ships with resume content; content matching no command is still found; commands rank before content; every result stays a listbox `option`; content results are capped so commands cannot be crowded out; selecting one navigates and focuses the anchor without running a command |
| `analytics-queue.test.js` | 127 | **BUG-08 regression.** The queue key is namespaced per session; `initAnalytics` discards another session's persisted queue; a restored queue is filtered to the owning session's events |
| `auth-refresh.test.js` | 213 | **BUG-03 regression.** Concurrent 401s share one refresh instead of racing rotation; a later 401 starts a fresh refresh; a genuinely failed refresh signs the user out exactly once; a 429, 5xx or dropped connection during refresh keeps the session, while a 403 still ends it |
| `auth-register.test.js` | 120 | Registration returns the created user and attempts no login - the auto-login could never succeed against an unconfirmed address, so it reported a successful registration as a failure and spent a second strict-budget request doing it; no tokens are stored; a real 400 still throws the server's reason |
| `auth-reset-password.test.js` | 162 | **Dead-submit-button regression.** #195 moved the four auth forms from `submitBtn.disabled = !(...)` to `setSubmitReadiness`, which writes `data-ready`/`aria-disabled` and deliberately never touches `.disabled` — but `index.html` kept the literal `disabled` attribute, and nothing was left to clear it. A disabled `<button type="submit">` fires neither `click` nor `submit`, so a visitor could open the emailed reset link, watch every rule on the checklist go green, and get nothing from the greyed-out button; Register, Change Password and Delete Account were dead the same way. Drives the real `index.html` under jsdom: all four submit buttons come out of `initAuthUI` operable, `?reset_token=` lands in the hidden field and is scrubbed from the address bar, a matching valid pair marks the button ready, a mismatch is explained in the error slot without reaching the API, and a valid submit posts `{token, new_password}` to `/auth/reset-password` |
| `ucl-bracket.test.js` | 610 | The Champions League predictor end to end in jsdom: the 36-row table renders in its three qualification zones with each club's association, the play-off ties pair seeds 9–16 against 17–24, the round of 16 seeds the top eight against the reserved bands, a chalk bracket crowns the top seed, the `?s=` share code round-trips, reordering the table clears picks that no longer exist, a malformed share code falls back to the default table, quick-fill settles the remaining ties without overwriting existing picks, and the rank pill's jump field clamps out-of-range positions and cancels on Escape |
| `contact-form.test.js` | 395 | Accessible invalid-field feedback; the FormSubmit honeypot is excluded from validation but forwarded in the payload; offline submissions blocked; loading state set and reset; a timed-out request does **not** fall through to a native resubmission; first-party `POST /contact` is tried before FormSubmit, the fallback fires on an unreachable API and on 502 only, a 429 is not routed around, and a timed-out first-party POST is never retried |
| `pull-to-refresh.test.js` | 314 | The gesture that replaces the browser's own site-wide, which is all guards. Both modes. **Nested** (`#ai .ai-content-area`): a drag past the threshold reloads and a shorter one settles back; a gesture starting below the top of the scroller is ignored, so a flick back to the top is not a refresh; an upward drag is handed back uncancelled; a second finger drops the pull; the pull follows only the finger it started with; travel is capped; the scroller is marked `[data-ptr-scroller]` and unmarked on `destroy`; and the scroll-blocking `touchmove` is bound only while a pull is live — dropped on release and on cancel, kept when a stray finger ends. **Document**: the indicator is fixed to `body` rather than parented to `<html>`; a pull starting anywhere on the page refreshes; one starting inside the AI transcript is left to that scroller; one on a locked `body` (the AI shell, an open nav) is ignored; and `destroy` takes the listeners and the indicator with it |
| `theme-library.test.js` | 129 | `readThemeLibrary`, `saveTheme`, `deleteTheme` — the visitor's own named palettes in localStorage. Mostly the storage boundary, because that is where this breaks: a name overwrites case-insensitively instead of duplicating and keeps the original id, an empty name is refused and a long one truncated, the 12-entry cap blocks a new name but still allows updating an existing one, corrupt or hand-edited JSON reads as an empty library rather than throwing on panel open, entries without three usable hexes are dropped, and a `setItem` that throws (private browsing, blocked storage) is reported rather than reported as success |
| `theme-randomizer.test.js` | 122 | `randomPalette`, the theme customiser's **Randomize** button. Testing a random function is worth it precisely because it is constrained: over 400 rolls per case, every colour is a six-digit hex, saturation and lightness stay inside the bands `generateVariants` can derive usable light and dark variants from, the new primary always lands at least 35 degrees from the palette it replaced, and the three hues fall into the small closed set of gaps the fixed harmonies allow rather than spreading like three independent draws |
| `theme-library-update.test.js` | 236 | **Write-once-library regression.** Updating a saved theme, driven through the real panel because everything at stake is in the wiring rather than in the library functions. Overwriting by name always worked, but nothing said so: the Save field opened empty, no chip looked loaded, and Apply - the one button that reads like a commit - writes the active palette and leaves the named theme on its first colours, so editing a saved theme and applying it looked like a save that did nothing. Loading a chip marks it `aria-pressed`, an edit marks it as diverged and names that in the chip's `title`, the Save field opens prefilled with the loaded theme so Enter updates it in place under its original id, the confirm button reads Update rather than Save while the typed name is one already in the library, reopening the panel on a saved theme's colours finds it again (the state after a reload), a built-in preset or a delete drops the loaded theme so Save cannot overwrite it by accident, and Apply still writes only `rj_theme_palette` |
| `theme-panel-cancel.test.js` | 201 | **Palette-reset regression.** What closing the customiser panel undoes, driven through the real panel because the rollback hangs off a MutationObserver watching `is-open`: a roll from the landing view survives the panel being opened and closed untouched, the panel opens showing that roll rather than the shipped defaults, a preset clicked inside the panel is discarded back to the roll behind it instead of to the saved palette, Apply is not undone by the close it triggers itself, Reset leaves the defaults with no roll left to come back, and a cancel with nothing behind it still falls through to the saved palette |
| `theme-color-meta.test.js` | 239 | **Browser-bar regression.** The `theme-color` meta tag, which paints the mobile browser toolbar and the installed PWA's top bar. Randomising used to leave it on the previous colour until Apply, because only `applyTheme()` and Apply ever wrote it: a landing-view roll and an in-panel shuffle now move it without being saved, a cancel rolls it back with the palette, Apply's own close does not undo it, Reset returns it to the **dark** accent on a dark page (the tag is read off `<body>`, not the root, where the dark variant is not declared), and the fallback pair still applies when nothing resolves. Plus `theme-bootstrap.js` seeding the tag pre-paint from a saved palette, per theme |
| `resume-pdf.test.js` | 164 | The resume preview dialog: a hover-capable pointer opens it and mounts an iframe pointed at the link's `href`; closing tears the iframe back out of the DOM; a backdrop click closes but a click inside the panel does not; Escape closes; and both a touch pointer and an iOS user agent leave the plain link alone so the native viewer takes over |
| `arcade.test.js` | 524 | The six arcade games' rules, exercised as pure functions with no canvas. 2048: four equal tiles make two pairs, a tile produced by a merge cannot merge again in the same move, a move that changes nothing is not a move, and a full board with no equal neighbours is game over. Tetris: four quarter turns is the identity for every piece, the ceiling is open so a piece can spawn above the well, rotation against a wall kicks inwards instead of failing, O never kicks, rotation is refused when all five offsets collide, and cleared rows are replaced at the top with the rest keeping their order. Flapper: overlap is strict, so grazing an edge is not a collision, and a gap never opens flush against the ceiling or floor. Stack: a near-miss inside the tolerance snaps flush and loses nothing, an overhang is trimmed from the side it hangs over, the survivor plus the offcut is the block that was dropped, and touching edges count as no overlap. Snake: the tail vacates its cell on the same tick the head enters it so chasing your own tail is legal, the tail only stays put for the tick the food was taken, every wall is fatal, a turn back through the neck is refused, food never lands under the snake at either end of the random range, and a covered board has nowhere to put food — which is the win. Breaker: a hit reflects on the axis the ball came in through, contact is strict so grazing a brick is not a hit, a dead corner resolves vertically rather than along the row, the paddle sets the angle from where it was struck, and across every point on the paddle and past both ends the ball leaves upwards at the speed it arrived and never flatter than the cap — plus the one that guards the rest: no slice of a frame is longer than the ball is wide, which a full 1/60 frame at the speed cap is |
| `home-portrait.test.js` | 169 | The landing portrait's flip card, and specifically the three parts of it that are not CSS and would break silently: the button ships `disabled` and only `initHomePortrait()` enables it, so a no-JS page is never offered a control that cannot work; `aria-pressed` toggles both ways and is what the stylesheet rotates on, so the visual state and the announced state cannot drift apart; and the back face stays out of the LCP's way — not preloaded, `fetchpriority="low"`, raised to `high` once on the first hover. Also asserts the preload's `imagesrcset` still matches the front `<picture>` verbatim, since a preload that does not costs a round trip instead of saving one |
| `storage-blocked.test.js` | 123 | **Blank-page regression.** `localStorage` that *throws* rather than one that is empty — Safari with "Block All Cookies", strict privacy extensions — which is the case every read in the codebase used to miss: they handled a missing value, and several handled a failed `JSON.parse`, but a throwing accessor went straight up the stack. `initTheme` is the first call in `main.js`'s sequence and `.reveal` is invisible until `initAnimations` five calls later marks it active, so one throw left the contact form, both Apps tiles and the About cards as blank space with the router dead and nothing on screen saying why. Asserts `initTheme` and `reapplyCustomTheme` both survive it (the latter is the link that actually broke — `readSavedPalette` guarded its parse but not its `getItem`), that every `.reveal` still ends up active, and that the hiding rule in `styles.css` is scoped to `.js-enabled` so a no-JS visitor sees content too |

The two regression files exist because both bugs were silent and expensive: one
lost analytics batches to a 403 whenever a second tab was open, the other signed
users out mid-session whenever three authenticated requests 401'd together.

### Build tests

`scripts/tests/*.test.js` — same runner, but they exercise `scripts/build.mjs`
rather than the browser. `npm test` picks them up along with the frontend
suite.

| File | Lines | Covers |
| :--- | ---: | :--- |
| `build.test.js` | 213 | The caching contract, which is only observable after a build. Every service-worker precache URL resolves to a file that actually shipped; the precache lists the *hashed* LCP image and the width `index.html` preloads, not a bare filename; the `.htaccess` immutable rule matches only content-hashed names; every shipped image and PDF is hashed, so nothing gets a year of caching under a reusable name; no page or manifest points at an un-hashed asset; and `CACHE_NAME` is stable when nothing changes but moves when any precached input does |

A stale precache entry or an unhashed asset cannot be caught by linting or by
the frontend suite — both only appear once `dist/` exists, which is why these
run against a real build.

---

## Backend tests

`tests/backend/` — 12 files, 136 test functions (56 unit, 80 integration).

### `unit/`

| File | Tests | Guards |
| :--- | ---: | :--- |
| `test_security_wiring.py` | 25 | **Defences that existed in the tree but were not wired in.** Every middleware is registered; `RequestIDMiddleware` is outermost; CORS origins come from settings, not a hardcoded list; auth and chat routes are strict-limited under **both** mount prefixes; `_normalise_path` only strips a real `/api` prefix; the budgets are tracked separately; `_required_secret` rejects the placeholder, a short key and an unset key; `security.py` has no default signing key; Bedrock slot release is idempotent and an abandoned streaming response does not leak its slot; both mount prefixes route while only one copy is documented; the chat client carries the configured timeouts; stream queue settings are actually used; a session cannot hold unlimited SSE streams |
| `test_pipeline_simulation.py` | 10 | The modelled Kafka stage stays **coherent**: idle reports empty; offsets total the events actually processed; partition lag totals reported lag; arrivals build depth; depth drains monotonically to zero; **the drain curve is independent of poll rate**; throughput tracks the rolling minute; health escalates with depth; simulation can be disabled for the honest `bypass` state; real broker metrics are never overwritten |
| `test_ingest_buffer.py` | 4 | A recoverable failure returns events for a retry; the buffer never grows past its cap; an unrecoverable failure **counts** what it discards; the pipeline stops reporting healthy once events are dropped |
| `test_notifications.py` | 7 | A password change actually sends an email (it once only logged); the message tells the owner what to do; a failed send does not raise; remote relays get certificate validation; an authenticated relay uses STARTTLS; loopback is the only TLS exemption; no email leaks the raw token into the logs |
| `test_dependency_locks.py` | 6 | The lock exists; every direct dependency is pinned; nothing is left unpinned; every pin carries a hash; the dev lock agrees with the runtime lock on shared packages; the locks target the supported Python floor |
| `test_utils.py` | 4 | `ensure_alternating_roles`: consecutive user messages merged, a leading assistant message handled, empty messages filtered, Converse format preserved |

### `integration/`

| File | Tests | Guards |
| :--- | ---: | :--- |
| `test_auth.py` | 25 | **Every `auth_service` call in the router resolves** (this file was once empty, which is how five routes shipped calling functions that do not exist while pytest stayed green). Then: register, login, wrong password, a token signed with the wrong key, change password, reset round trip, garbage reset token, session listing, the `DELETE` confirmation phrase, refresh rotation burning the old token, 2FA setup refusing to rotate a live secret, logout revoking the refresh token, the routes the frontend actually uses, enumeration resistance on reset and magic link, pre-auth replay refusal, 2FA lockout, cross-purpose token refusal, a password change voiding a pending reset, and a spent reset token staying spent; an emailed link redeemed on the magic-link or password-reset path confirms the address, and confirming twice does not move the timestamp; an expired lockout restores a full set of attempts while a live one is still enforced and a fresh run still re-locks  |
| `test_activity_events.py` | 17 | Summary counting and zero-filling; empty sessions; type filtering and rejection; `event_id` in list and broadcast payloads; `contact_prompt`, `ai_llm_telemetry` and `client_error` accepted; **an unknown type does not discard the rest of the batch**; a batch of only unknown types reports rather than failing; a batch touching another session is still refused; structurally invalid rows still rejected; the session cookie is set, authorises a call on its own, and its absence is still refused |
| `test_session_access_control.py` | 11 | Creating a session returns a token; the token is not derivable from the id; scoped endpoints refuse a caller without it; one token does not unlock another session; the holder gets through; events cannot be written into someone else's session; a bulk batch cannot smuggle a foreign session; an unknown session is indistinguishable from a forbidden one; the stream accepts the query parameter; a cookie for one session does not unlock another; a forged cookie is refused |
| `test_chat_stream.py` | 13 | Streaming success and metrics; Converse for a non-Anthropic model; consecutive user messages merged; invalid model rejected; **streaming does not block the event loop**; the anonymous free-message cap and its non-application to signed-in callers; `system_prompt` override refused; oversized message, oversized conversation, too many messages and unknown role rejected; a normal conversation still fits |
| `test_chat_history.py` | 10 | Compression round trip and that it actually shrinks a realistic transcript; empty payload tolerated; title derivation and truncation; history requires authentication; streaming while signed in saves a conversation; another user cannot read it; delete removes it; anonymous streaming saves nothing |
| `test_frontend_api_contract.py` | 4 | The frontend actually calls the API; **every endpoint the frontend calls exists on the backend**; three previously missing routes are served; logout revokes tokens rather than only clearing the client |

`test_frontend_api_contract.py` exists because the frontend is a static bundle
talking to the API over a hardcoded base URL, so nothing but a running browser
ever checked that the two agree. Three routes had silently drifted apart:
`POST /auth/logout` had no route at all (and `auth.js` discards the failure, so
a "logged out" refresh token stayed valid for 30 days),
`POST /auth/sessions/revoke-others` had no route despite the service function
existing, and `POST /auth/delete-account` was only served as `DELETE
/auth/account`.

---

## The test harness

### `pytest.ini`

```ini
asyncio_mode = strict
testpaths = tests/backend
addopts = --strict-markers --strict-config
```

There was no pytest configuration at all, so every one of these was inherited
from whatever versions happened to be installed. `strict` asyncio mode is stated
rather than assumed — the suite marks async tests explicitly, and under the
pinned pytest an async test that loses its `@pytest.mark.asyncio` is a hard
failure rather than a silent skip. `--strict-markers` turns a typo'd marker into
an error; `--strict-config` does the same for an unknown key here.

`filterwarnings` promotes `PytestUnraisableExceptionWarning` and
`PytestReturnNotNoneWarning` to errors, and ignores passlib's deprecated `crypt`
import (not ours; it disappears when passlib is replaced).

### `tests/backend/conftest.py`

Sets, before any `server` import can run:

```
TESTING=true
DATABASE_URL=sqlite+aiosqlite:///:memory:
AWS_REGION=us-east-1
DEFAULT_MODEL_ID=dummy-model-id
JWT_SECRET=<throwaway value that clears the 32-character floor>
```

`TESTING=true` bypasses the rate-limiting middleware and stops the three
background pipeline tasks from starting. `settings.py` validates at import, so
these must exist first — which is why `conftest.py` has an `E402` per-file
ignore in `ruff.toml`.

It then builds a separate SQLite engine (`StaticPool`, `check_same_thread:
False`, shared cache) and overrides `get_db`. Two session-scoped fixtures:

- `setup_db` — `drop_all` / `create_all` around the session, teardown drops.
- `async_client` — `httpx.AsyncClient` over `ASGITransport(app=app)`, so requests
  go through the real middleware stack without a socket.

`TEST_DATABASE_URL` can point the suite at a different database.

---

## Coverage

CI enforces `--cov-fail-under=55` over `server/`. That is a floor, not a target:
it exists to stop coverage collapsing, and the meaningful signal is in *which*
paths are covered — the security wiring, the access-control boundaries, the
schema-drift behaviours and the two frontend regression files.

There is no coverage gate on the frontend suite.

---

## Linting

| Tool | Scope | Configuration |
| :--- | :--- | :--- |
| ESLint | `frontend/*.js`, `frontend/js/*.js`, `frontend/js/terminal/*.js` | `.eslintrc.json` — `no-undef: error`, `no-unused-vars: warn` (ignoring `^_`), `DOMPurify`/`marked` as read-only globals, service-worker env override for `sw.js`, `dist/**` ignored |
| Stylelint | `frontend/**/*.css` | `.stylelintrc.json` — `stylelint-config-standard` with cosmetic rules disabled; `frontend/vendor/**` ignored |
| Prettier | `**/*.{html,css,js,json,md,yml,yaml}` | `.prettierignore` excludes `frontend/index.html` (CSP-hashed inline scripts), `worldcup.html`, `ucl.html`, the generated locks, `fonts.css`/`fonts/`, and `vendor/` |
| ruff | `server`, `tests` | `ruff.toml` — `F`, `E`, `W`, `B`, `ASYNC`, `C4`; ignores `E501`, `B008` (FastAPI's dependency idiom is a call in a default argument) and `E712` (`Column == False` builds SQL, and ruff's fix would silently break the query) |

The backend had no linting at all while the frontend ran two linters. `F821`
alone would have caught the five auth routes that shipped calling service
functions that do not exist.

---

## What is not tested

Known gaps, stated so nobody assumes coverage that is not there:

| Gap | Consequence | Mitigation in place |
| :--- | :--- | :--- |
| Migrations are never executed by pytest | The suite builds its schema with `create_all` against SQLite | The separate `migration-check` CI job runs the chain against real PostgreSQL and runs `alembic check` |
| No browser-level end-to-end tests | Rendering, CSS and real service-worker behaviour are unverified | The deploy's smoke test checks `GET /`, the served `sw.js` version and `/api/health` |
| Real Bedrock is never called | Streaming is exercised against mocks | The mock shape follows the botocore event stream; both the invoke and Converse paths are covered |
| SQLite, not PostgreSQL, in the suite | `JSONB`, the GIN index and window functions behave differently | Dialect variants on the two affected columns; the migration job uses real PostgreSQL |
| Kafka is never exercised with a real broker | Only the simulated and bypass paths are tested | The consumer falls back automatically, and the broker path is thin |
| `three-bg.js`, `particles-config.js`, `animations.js` are untested | Canvas rendering and animation are not asserted | Manual review; they are self-contained and degrade to no-ops |
| `chat.js` has no direct unit tests, and `auth-ui.js` only its reset panel | Both are ~1,200-line single initialisers | `auth-reset-password.test.js` drives `initAuthUI` against the real `index.html`, so the reset panel's wiring - and the submit-readiness contract all four auth forms share - is asserted; `auth-refresh.test.js` and `auth-register.test.js` cover the riskiest shared paths in `auth.js`; the backend contract test covers the endpoints they call. The register panel's success painting is verified by reading only |
| No load or soak testing | Concurrency limits are reasoned about, not measured | The limits are conservative and observable via `/system/pipeline` |

---

## Writing new tests

**Backend.** Put endpoint behaviour in `integration/` using the `async_client`
fixture; put pure logic and wiring assertions in `unit/`. Mark async tests with
`@pytest.mark.asyncio` — strict mode means an unmarked async test fails rather
than silently skipping. Prefer a test that names the defect it prevents; every
file in this suite reads that way, and it is why the failures are legible years
later.

**Frontend.** Build the DOM fixture with jsdom inside the test, assign
`global.document`/`global.window`, then import the module under test. Assert on
observable DOM and on storage, not on internals.

**When adding an endpoint the frontend calls**, add it to
`test_frontend_api_contract.py` — that file is the only thing standing between a
renamed route and a silently broken deployed client.
