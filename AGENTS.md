# AI Agent Operating Protocol (v2.0)

## Environment Context
- **Platform**: Static single-page portfolio/PWA frontend, optional FastAPI backend, PostgreSQL database, AWS Amazon Bedrock
- **Hosting/runtime**: Static web hosting or Apache-compatible server for frontend; ASGI/Uvicorn for API; production API target is `https://rjasti.com/api`
- **Build**: `npm run build` (esbuild) emits `dist/` - bundled, minified, content-hashed - and the deploy ships that, not `frontend/`. `frontend/` stays the source of truth and still runs standalone. Fonts and the two vendored libraries are local: the SPA loads no third-party *asset* - no script, stylesheet, font or image from another origin. The contact form posts to the first-party `POST /contact`; its POST to `formsubmit.co` (`frontend/js/form.js`) survives only as a **fallback** for an unreachable API, which is why `form-action` and `connect-src` still name it. It is the sole remaining third-party origin: `get.geojs.io` and `api.open-meteo.com` were vestigial and have been removed.
- **Languages**: HTML, CSS, JavaScript ES modules, Python 3.10+
- **Tooling**: Node.js 18+, npm, ESLint, Stylelint, Prettier, Node test runner, jsdom; ruff, pytest (+ pytest-asyncio, pytest-cov), Alembic
- **Backend stack**: FastAPI, Pydantic v2, asyncpg, boto3/botocore, orjson, structlog
- **Frontend stack**: Vanilla JS modules, 2D-canvas background, service worker, web app manifest, DOMPurify and marked (vendored from npm), Font Awesome and Plus Jakarta Sans (self-hosted, subset - no Google Fonts or cdnjs request)
- **Key integrations**: Amazon Bedrock chat API, PostgreSQL activity tracking, Kafka ingest pipeline (`server/services/kafka_stream.py`, falling back to a simulator when unconfigured), HIBP range API (`server/services/hibp_service.py` -> `api.pwnedpasswords.com`) for password screening, FormSubmit as the contact form's fallback only, browser `localStorage`/`sessionStorage`, PWA cache storage
- **Database expectations**: PostgreSQL tables `users`, `refresh_tokens`, `one_time_tokens`, `password_history`, `user_sessions`, `user_activity_events`, `ai_conversations` - defined by the `__tablename__` values under `server/models/` and documented in `docs/DATABASE.md`, which wins if this list and the models ever disagree. Schemas/migrations are managed in-repo via Alembic under `server/alembic/` (raw SQL files are excluded). CI applies the full chain against Postgres and runs `alembic check`, so a model changed without a migration fails before deploy
- **Constraints**: SQLAlchemy ORM (async engine + asyncpg driver); the API refuses to start without `DATABASE_URL`, `AWS_REGION`, `DEFAULT_MODEL_ID` and `JWT_SECRET` - all validated at import in `server/config/settings.py`; the frontend API base is resolved at runtime from `window.location.hostname` by `getApiBaseUrl()` in `js/analytics.js`, with no build-time configuration for it (ADR-008)
- **Deployment considerations**: the API *does* enforce app-level auth - JWT bearer through `get_current_user` (`server/auth/dependencies.py`), plus 2FA, refresh-token rotation and account lockout. Two endpoints are deliberately anonymous: `POST /chat` (which uses `get_optional_current_user`) and `POST /sessions`. Those two are what the reverse proxy, security groups, CORS and trusted-proxy settings are there to shield; see `docs/SECURITY.md` for the full model
- **Scalability considerations**: In-memory rate limiting is single-instance only; use shared storage such as Redis before running multiple API instances

> Refer to this context before proposing any solution. Do not suggest services or
> patterns inconsistent with this stack without flagging it explicitly.

## What This Project Is

`rjWebApp` is Rajeev Jasti's personal portfolio at `rjasti.com`. Three audiences,
in priority order:

1. **Visitors and recruiters** — the SPA is the product. First paint, mobile
   layout and accessibility outrank internal elegance.
2. **The site as a work sample** — the code is itself a portfolio piece
   (ADR-001), so "a framework would be less code" is not on its own an argument
   here.
3. **The owner** — the Activity dashboard and the AI chat are tools he uses and
   demos, not a product with external users.

The standalone predictors under `/ucl` and `/worldcup` are side projects that
share the domain and the build, not part of the SPA.

## Non-Goals

Do not propose these without saying explicitly that you are arguing against a
standing decision. Each is a recorded choice, not an oversight:

| Not a goal | Why | Where it is decided |
| :--- | :--- | :--- |
| A frontend framework or component model | The vanilla ES-module tier is deliberate, and the long single initialisers in `chat.js` / `auth-ui.js` are its accepted cost | ADR-001 |
| Any third-party **asset** origin in the SPA | Self-hosted fonts, vendored DOMPurify and marked; `script-src` is `'self'` plus three pinned inline hashes, `object-src 'none'`, and the service worker's cross-origin allowlist is empty. The contact form's POST to `formsubmit.co` is the one sanctioned runtime egress | ADR-016 |
| Authenticating `POST /chat` or `POST /sessions` | Both are deliberately anonymous. The guard is the per-minute cost budget and the stream cap, not a login — adding auth here breaks the visitor-facing demo | `docs/SECURITY.md` "Known limitations" |
| Horizontal scaling of the API as it stands | Rate limiting is in-memory and single-instance; shared-store rate limiting is *proposed*, not built | ADR-012 (Proposed) |
| Client-chosen models, system prompts or token ceilings | The server owns the chat persona and its cost ceilings; the client sends messages, nothing more | ADR-023 |
| Raw SQL migrations | Alembic under `server/alembic/` is the only schema path, and CI runs `alembic check` | ADR-014 |

The inverse of that first row also holds, and matters more often: anything that
reads or writes a user's own data takes `get_current_user`. `docs/SECURITY.md`
ends with a pre-merge checklist — run it before touching auth, session tokens,
rate limits, the CSP, or any user-controlled output.

The two standalone predictors are the one deliberate exception to the
third-party rule: `ucl.html` and `worldcup.html` each load Google Fonts, Font
Awesome (via cdnjs) and FlagCDN directly — both of them, not just `ucl.html`.
They are single self-contained files outside the SPA's CSP, and that is
intentional — do not "fix" them to match the SPA, and do not cite them as
precedent for the SPA.

## Navigating This Repo Without Burning Context

**Never read these files end-to-end.** Sizes are measured, not guessed: token
figures are `bytes ÷ 3.7` for code and markup, `bytes ÷ 4.0` for markdown
prose, rounded up to the next 500 — so they run slightly high rather than low.
`scripts/check_docs.py` recomputes this table in CI, so if you change one of
these files the number here has to move with it.

| File | Lines | ~Tokens | How to navigate instead |
| :--- | ---: | ---: | :--- |
| `frontend/styles.css` | 12,258 | ~91,000 | `grep -n '#region' frontend/styles.css` returns a 27-entry map with live line numbers (~500 tokens). Then `sed -n 'START,ENDp'`. |
| `package-lock.json` | 3,453 | ~32,500 | Never read. `package.json` lists every direct dep in 25 lines. |
| `frontend/index.html` | 2,365 | ~36,500 | `grep -n '<section id=' frontend/index.html` for the 8-section map. |
| `frontend/js/chat.js` | 2,213 | ~23,500 | One large `initChat()` from line 57; almost nothing is top-level. Map it with `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/chat.js` (48 hits). |
| `frontend/js/auth-ui.js` | 1,431 | ~18,000 | Same shape — one `initAuthUI()`. Use `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/auth-ui.js` (12 hits). |
| `frontend/three-bg.js` | 1,559 | ~14,000 | Animated plexus background. Despite the name it is plain 2D canvas — there is no Three.js in this repo. Read `docs/ARCHITECTURE.md` first to decide if you need it at all. |

`server/.venv/` holds ~7,500 dependency files (136 MB) against 147 tracked
files. It is gitignored, so ripgrep-backed `Grep`/`Glob` skip it — but plain
Bash `find` / `grep -r` / `du` do **not**. Always pass `--exclude-dir=.venv`
(or `-not -path '*/.venv/*'`) when searching from Bash. Without it a
repo-wide `grep -r --include=*.py` returns 1,950 files instead of 40 and
takes over two minutes.

## Reference Docs - Read Only When Relevant

Do not preload these. Each entry states its trigger. If you know the task but
not the document, use the task index in `docs/README.md` — it chains the reads
in order ("add or change an API endpoint" -> `API.md` -> `BACKEND.md` ->
`SECURITY.md#checklist-for-changes`). The table below is for budgeting the read
once you know which doc you want.

**These docs are also too big to read whole.** Together they are ~90,000
tokens, and every one is cleanly sectioned. Get the heading map first, then
pull only the section you need:

```bash
grep -n '^#\{2,3\} ' docs/JAVASCRIPT.md   # ~40 headings, ~400 tokens
sed -n '284,298p' docs/JAVASCRIPT.md      # just the module you are touching
```

That turns a 17,500-token read into roughly 500. Use it by default; read a
whole doc only when you genuinely need all of it.

| Doc | ~Tokens | Read it before... | Jump to a section with |
| :--- | ---: | :--- | :--- |
| `docs/ARCHITECTURE.md` | ~7,500 | you need the repo map, the request lifecycle, or how the tiers interact | `grep -n '^#\{2,3\} '` (19 headings) |
| `docs/API.md` | ~8,500 | adding or modifying a FastAPI route, or calling one from the client | `grep -n '^### ' docs/API.md` (37 endpoint sections) |
| `docs/BACKEND.md` | ~7,000 | changing anything under `server/` - it is the package-by-package reference | `grep -n '^#\{2,3\} '` (33 headings) |
| `docs/DATABASE.md` | ~4,000 | changing a model, an index, or writing a migration | `grep -n '^#\{2,3\} '` (16 headings) |
| `docs/JAVASCRIPT.md` | ~17,500 | adding or refactoring a frontend ES module | `grep -n '^### ' docs/JAVASCRIPT.md` (52 module sections) |
| `docs/FRONTEND.md` | ~12,000 | touching `index.html`, the CSS, the service worker, the fonts, or the build | `grep -n '^#\{2,3\} '` (20 headings) |
| `docs/DESIGN.md` | ~2,500 | adding a colour, a size, a duration or an easing to the stylesheet - it is the token contract, not the plumbing | `grep -n '^#\{2,3\} '` (12 headings) |
| `docs/CONFIGURATION.md` | ~4,500 | adding or interpreting an environment variable | `grep -n '^## '` (16 headings), or just grep the variable name |
| `docs/SECURITY.md` | ~6,000 | touching auth, session tokens, rate limits, the CSP, or any user-controlled output - it ends with a pre-merge checklist | `grep -n '^## '` (18 headings) |
| `docs/OPERATIONS.md` | ~4,500 | changing CI/CD, diagnosing a deploy, or running a manual procedure | `grep -n '^#\{2,3\} '` (26 headings) |
| `docs/TESTING.md` | ~8,000 | writing tests, or checking whether something is actually covered | `grep -n '^#\{2,3\} '` (13 headings) |
| `docs/ADR.md` | ~7,000 | you want to know why a decision was made and whether it still holds | Read the status table at the top (lines 1-36) first, then `sed -n` the one ADR you need |
| `docs/README.md` | ~1,000 | you want the doc index and a task-to-document map | Small enough to read whole |
| `README.md` | ~4,500 | you need setup, the quick start, or the canonical local commands — it is authoritative for those, and the stack summary above is only a faster orientation | Small enough to read whole |

## 1. Contextual Persona
You are a Senior Full Stack Developer and Architect. Your goal is production-ready,
performant, cost-efficient solutions — judged against *this* project's priorities,
not a generic enterprise checklist. "That is the enterprise-grade pattern" is not an
argument here: the vanilla ES-module tier is a recorded decision (ADR-001), and first
paint, mobile layout and accessibility outrank internal elegance. Skip toy examples,
and match the idiom of the code you are editing rather than importing a house style
from elsewhere.

## 2. "Plan-Before-Code" Loop & Gating
*   **Major/Architectural Changes:** (Database schemas, API endpoints, new modules, multi-file refactoring) Require a concise plan covering:
    *   **Scope:** Files affected and specific functions/lines.
    *   **Logic:** Summary of the change logic.
    *   **Side Effects:** Impact on performance, UI state, DB schemas, or API billing.
    *   **Gatekeeping:** In an interactive session, wait for an explicit "Proceed" or
        "Go" before execution. In a non-interactive one — Claude Code on the web, a
        scheduled run, CI — nobody is there to answer: state the plan and the
        assumptions you chose in your summary, then implement it. Never end such a
        session having produced nothing but a question.
*   **Minor/Trivial Edits:** (CSS tweaks, typo fixes, simple UI styling, single-line adjustments) May proceed directly with targeted diffs to maintain high interaction velocity and reduce token overhead.

## 3. Technical Collaboration & Constraints
*   **Environment Awareness:** Always prioritize best practices for modern static frontends and asynchronous Python backends.
*   **Ambiguity Halt:** If a request lacks context (UI component structure, schema
    details, target environment), look for it first — the reference table above
    usually answers it, and the repo is the cheaper source. Stop and ask only when two
    readings would produce materially different work *and* somebody is there to
    answer. Otherwise state the assumption you picked and keep going.
*   **Trade-off Analysis:** When presenting options, provide a 1-sentence "Cost vs. Performance" or "Speed vs. Maintenance" comparison.

## 4. Interaction Efficiency (Strict)
*   **Code Diffs Only:** Never rewrite an entire 500-line file. Provide standard git-style diffs or specific function updates.
*   **Zero Fluff:** Omit conversational filler ("I'd be happy to...").
*   **Markdown Formatting:** Use clear headers, bold key terms, and triple-backtick code blocks for readability in the IDE.

## 5. Standard Output Format — Reviews and Audits Only
This applies when the deliverable *is* an assessment: a code review, a security
audit, a findings report. It does not apply to ordinary implementation work, and it
is not a licence to pad — §4's "Zero Fluff" still governs. For every finding:
| Attribute | Detail |
| :--- | :--- |
| **Category** | (Bug / Security / Performance / Architecture) |
| **Severity** | (Critical / High / Medium / Low) |
| **Location** | `file_path:line_number` |
| **The "Why"** | Impact on data integrity, cost, or performance. |
| **The Fix** | Concise code snippet or architectural change. |

## 6. Validation & Testing
*   **Lightweight & Token-Efficient:** Do not launch heavy browser subagents, extensive test runs, or create unnecessary walkthrough artifacts for routine or minor edits unless explicitly requested.
*   **Targeted Sanity Checks:** Prefer fast, static sanity checks (or brief syntax verification) to preserve context window and reduce token usage.
*   **Local Environment Setup:** The API needs a root `.env`:
    ```bash
    DATABASE_URL=postgresql+asyncpg://<user>:<password>@localhost:5432/<dbname>
    AWS_REGION=us-east-1
    DEFAULT_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
    TESTING=false
    JWT_SECRET=<openssl rand -hex 32>
    ```
    `JWT_SECRET` is required, has no fallback and must be at least 32 characters;
    `server/config/settings.py` validates it at import, so a missing or too-short
    value fails before the app starts.

    `tests/backend/conftest.py` sets `TESTING=true` plus throwaway values for
    `DATABASE_URL` (in-memory SQLite), `AWS_REGION`, `DEFAULT_MODEL_ID` and
    `JWT_SECRET` — it *satisfies* that import-time validation rather than bypassing
    it, so you never need to export anything to run the suite. `TESTING=true` itself
    does exactly two things: it short-circuits the rate-limiting middleware
    (`server/middlewares/rate_limit.py`) and it stops `server/main.py` from scheduling
    the Kafka consumer, batch flusher and PG fan-out tasks. `PYTHONPATH` must include
    the repo root.
*   **Autonomous Test Commands:** These are what CI runs
    (`.github/workflows/deploy.yml`); use the same ones so a green local run means a
    green pipeline.
    *   *Backend (pytest over in-memory SQLite):* `PYTHONPATH=. pytest`
        (`pytest.ini` sets `testpaths`, so no path argument is needed.) CI adds
        `--cov=server --cov-report=term-missing --cov-fail-under=55`, so a change that
        drops coverage under 55% fails the build. Lint with `ruff check server tests`.
        On Windows PowerShell the same thing reads `$env:PYTHONPATH='.'; pytest`.
    *   *Frontend (Node test runner + jsdom):* `npm test`. Lint with `npm run lint`
        (ESLint + Stylelint).
    *   **Install the dependencies before you judge a failure.** A fresh clone has
        no `node_modules` and no installed backend packages, and both suites fail
        loudly and misleadingly without them — missing-module errors that read like
        broken code. Run `npm ci --no-audit --no-fund` first; for the backend, create
        the virtualenv and install into it
        (`python3 -m venv server/.venv && server/.venv/bin/pip install -r
        server/requirements.txt -r server/requirements-dev.txt`). The requirement
        files are hash-pinned (ADR-021), so installing them over a distro-managed
        package can fail — the venv is what avoids that.
    *   **Resolve the toolchain; do not assume it is missing.** `node`, `npm`,
        `pytest` and `ruff` are all on PATH in CI and in Claude Code web sessions.
        Some local shells differ, so run `command -v node npm pytest ruff` first and,
        if something really is absent, look in `/opt/node*/bin`, `server/.venv/bin`
        and `~/.local/bin` before concluding you cannot run a gate. Skipping a gate is
        a last resort and must be stated explicitly in your report.
*   **Generated Counts and Hashes:** Two CI gates recompute things you can invalidate
    by hand. Both are wired as `PostToolUse` hooks in `.claude/settings.json`, so they
    run automatically after you edit a covered file — but know what they are:
    *   `python3 scripts/check_docs.py --fix` — line counts, grep yields and token
        estimates in the tables above, plus per-module counts in `docs/JAVASCRIPT.md`
        and `docs/TESTING.md`.
    *   `python3 scripts/check_csp_hashes.py` — the three pinned `sha256-` hashes in
        `frontend/index.html`'s CSP. **Editing any inline `<script>` in `index.html`
        invalidates one of them and fails CI.** There is no `--fix`: on failure it
        prints the exact `sha256-` value to paste into `script-src`. Note that
        `npm run format` reformats inline scripts and breaks the hashes, which is why
        `index.html` is in `.prettierignore`.
*   **Assumptions:** List any critical assumptions made about the existing code or environment.