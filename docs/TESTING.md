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
npm test                                     # node --test frontend/tests/*.test.js

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
| `utils.test.js` | 208 | `escapeHTML` — both quote forms, an injected event handler failing to escape an attribute, and a visitor-controlled `page_path` in attribute position — plus `estimateTokens`, `debounce`, `throttle`, and `openModal`/`closeModal` ARIA handling |
| `activity-charts.test.js` | 310 | `bucketSession`, `renderTimeline`, `moveTimelineFocus`, `percentile`, `latencyBand`, `renderPaths` |
| `terminal.test.js` | 271 | Output builders escaping by construction; history (repeat collapsing, navigation, oversized entries, unparseable storage, flush persistence); individual commands; completion (common prefix, arguments, ambiguity, hidden commands never completed); keymap intents |
| `analytics-queue.test.js` | 127 | **BUG-08 regression.** The queue key is namespaced per session; `initAnalytics` discards another session's persisted queue; a restored queue is filtered to the owning session's events |
| `auth-refresh.test.js` | 144 | **BUG-03 regression.** Concurrent 401s share one refresh instead of racing rotation; a later 401 starts a fresh refresh; a genuinely failed refresh signs the user out exactly once |
| `ucl-bracket.test.js` | 395 | The Champions League predictor end to end in jsdom: the 36-row table renders in its three qualification zones with each club's association, the play-off ties pair seeds 9–16 against 17–24, the round of 16 seeds the top eight against the reserved bands, a chalk bracket crowns the top seed, the `?s=` share code round-trips, reordering the table clears picks that no longer exist, a malformed share code falls back to the default table, quick-fill settles the remaining ties without overwriting existing picks, and the rank pill's jump field clamps out-of-range positions and cancels on Escape |
| `contact-form.test.js` | 246 | Accessible invalid-field feedback; the FormSubmit honeypot is excluded from validation but forwarded in the payload; offline submissions blocked; loading state set and reset; a timed-out request does **not** fall through to a native resubmission |

The two regression files exist because both bugs were silent and expensive: one
lost analytics batches to a 403 whenever a second tab was open, the other signed
users out mid-session whenever three authenticated requests 401'd together.

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
| `test_auth.py` | 25 | **Every `auth_service` call in the router resolves** (this file was once empty, which is how five routes shipped calling functions that do not exist while pytest stayed green). Then: register, login, wrong password, a token signed with the wrong key, change password, reset round trip, garbage reset token, session listing, the `DELETE` confirmation phrase, refresh rotation burning the old token, 2FA setup refusing to rotate a live secret, logout revoking the refresh token, the routes the frontend actually uses, enumeration resistance on reset and magic link, pre-auth replay refusal, 2FA lockout, cross-purpose token refusal, a password change voiding a pending reset, and a spent reset token staying spent |
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
| `chat.js` and `auth-ui.js` have no direct unit tests | Both are ~1,200-line single initialisers | `auth-refresh.test.js` covers the riskiest shared path; the backend contract test covers the endpoints they call |
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
