# AI Agent Operating Protocol (v2.0)

## Environment Context
- **Platform**: Static single-page portfolio/PWA frontend, optional FastAPI backend, PostgreSQL database, AWS Amazon Bedrock
- **Hosting/runtime**: Static web hosting or Apache-compatible server for frontend; ASGI/Uvicorn for API; production API target is `https://rjasti.com/api`
- **Build**: `npm run build` (esbuild) emits `dist/` - bundled, minified, content-hashed - and the deploy ships that, not `frontend/`. `frontend/` stays the source of truth and still runs standalone. Fonts and the two vendored libraries are local: the page loads nothing from a third-party origin.
- **Languages**: HTML, CSS, JavaScript ES modules, Python 3.10+
- **Tooling**: Node.js 18+, npm, ESLint, Stylelint, Prettier, Node test runner, jsdom
- **Backend stack**: FastAPI, Pydantic v2, asyncpg, boto3/botocore, orjson, structlog
- **Frontend stack**: Vanilla JS modules, 2D-canvas background, service worker, web app manifest, DOMPurify and marked (vendored from npm), Font Awesome and Plus Jakarta Sans (self-hosted, subset - no Google Fonts or cdnjs request)
- **Key integrations**: Amazon Bedrock chat API, PostgreSQL activity tracking, FormSubmit contact form, browser `localStorage`/`sessionStorage`, PWA cache storage
- **Database expectations**: PostgreSQL tables `users`, `refresh_tokens`, `one_time_tokens`, `password_history`, `user_sessions`, `user_activity_events`, `ai_conversations`; schemas/migrations are managed in-repo via Alembic under `server/alembic/` (raw SQL files are excluded). CI applies the full chain against Postgres and runs `alembic check`, so a model changed without a migration fails before deploy
- **Constraints**: SQLAlchemy ORM (async engine + asyncpg driver); API requires `DATABASE_URL`, `AWS_REGION`, and `DEFAULT_MODEL_ID`; frontend API base is hardcoded in `js/analytics.js`
- **Deployment considerations**: API has no app-level authentication; protect with reverse proxy, firewall/security groups, CORS, and trusted proxy settings
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
| Any runtime third-party origin **in the SPA** | Self-hosted fonts, vendored DOMPurify and marked; `script-src` is `'self'` plus two pinned inline hashes, `object-src 'none'`, and the service worker's cross-origin allowlist is empty | ADR-016 |
| App-level auth on the API surface | Protection is the reverse proxy, security groups, CORS and trusted-proxy settings — do not design as if the API were internet-hardened | Environment Context above |
| Horizontal scaling of the API as it stands | Rate limiting is in-memory and single-instance; shared-store rate limiting is *proposed*, not built | ADR-012 (Proposed) |
| Client-chosen models, system prompts or token ceilings | The server owns the chat persona and its cost ceilings; the client sends messages, nothing more | ADR-023 |
| Raw SQL migrations | Alembic under `server/alembic/` is the only schema path, and CI runs `alembic check` | ADR-014 |
| Server-side chat history in the UI | The chat UI persists conversations in `localStorage`; `/chat/history*` exists but no shipped caller uses it | `docs/API.md` endpoint matrix |

The two standalone predictors are the one deliberate exception to the
third-party rule: `ucl.html` and `worldcup.html` each load Google Fonts, Font
Awesome and (for `ucl.html`) FlagCDN directly. They are single self-contained
files outside the SPA's CSP, and that is intentional — do not "fix" them to
match the SPA, and do not cite them as precedent for the SPA.

## Navigating This Repo Without Burning Context

**Never read these files end-to-end.** Sizes are measured, not guessed: token
figures are `bytes ÷ 3.7` for code and markup, `bytes ÷ 4.0` for markdown
prose, rounded up to the next 500 — so they run slightly high rather than low.
`scripts/check_docs.py` recomputes this table in CI, so if you change one of
these files the number here has to move with it.

| File | Lines | ~Tokens | How to navigate instead |
| :--- | ---: | ---: | :--- |
| `frontend/styles.css` | 10,299 | ~70,500 | `grep -n '#region' frontend/styles.css` returns a 26-entry map with live line numbers (~500 tokens). Then `sed -n 'START,ENDp'`. |
| `package-lock.json` | 3,453 | ~32,500 | Never read. `package.json` lists every direct dep in 25 lines. |
| `frontend/index.html` | 1,957 | ~30,000 | `grep -n '<section id=' frontend/index.html` for the 8-section map. |
| `frontend/js/chat.js` | 1,613 | ~16,000 | One large `initChat()` from line 57; almost nothing is top-level. Map it with `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/chat.js` (27 hits). |
| `frontend/js/auth-ui.js` | 1,189 | ~14,500 | Same shape — one `initAuthUI()`. Use `grep -nE '^\s{2,6}(async )?function \w+' frontend/js/auth-ui.js` (10 hits). |
| `frontend/three-bg.js` | 1,507 | ~13,500 | Animated plexus background. Despite the name it is plain 2D canvas — there is no Three.js in this repo. Read `docs/ARCHITECTURE.md` first to decide if you need it at all. |

`server/.venv/` holds ~7,500 dependency files (136 MB) against 147 tracked
files. It is gitignored, so ripgrep-backed `Grep`/`Glob` skip it — but plain
Bash `find` / `grep -r` / `du` do **not**. Always pass `--exclude-dir=.venv`
(or `-not -path '*/.venv/*'`) when searching from Bash. Without it a
repo-wide `grep -r --include=*.py` returns 1,950 files instead of 40 and
takes over two minutes.

## Reference Docs - Read Only When Relevant

Do not preload these. Each entry states its trigger.

**These docs are also too big to read whole.** Together they are ~62,500
tokens, and every one is cleanly sectioned. Get the heading map first, then
pull only the section you need:

```bash
grep -n '^#\{2,3\} ' docs/JAVASCRIPT.md   # ~40 headings, ~400 tokens
sed -n '284,298p' docs/JAVASCRIPT.md      # just the module you are touching
```

That turns a 8,000-token read into roughly 500. Use it by default; read a
whole doc only when you genuinely need all of it.

| Doc | ~Tokens | Read it before... | Jump to a section with |
| :--- | ---: | :--- | :--- |
| `docs/ARCHITECTURE.md` | ~7,000 | you need the repo map, the request lifecycle, or how the tiers interact | `grep -n '^#\{2,3\} '` (19 headings) |
| `docs/API.md` | ~6,500 | adding or modifying a FastAPI route, or calling one from the client | `grep -n '^### ' docs/API.md` (32 endpoint sections) |
| `docs/BACKEND.md` | ~7,000 | changing anything under `server/` - it is the package-by-package reference | `grep -n '^#\{2,3\} '` (33 headings) |
| `docs/DATABASE.md` | ~4,000 | changing a model, an index, or writing a migration | `grep -n '^#\{2,3\} '` (16 headings) |
| `docs/JAVASCRIPT.md` | ~8,000 | adding or refactoring a frontend ES module | `grep -n '^### ' docs/JAVASCRIPT.md` (37 module sections) |
| `docs/FRONTEND.md` | ~6,500 | touching `index.html`, the CSS, the service worker, the fonts, or the build | `grep -n '^#\{2,3\} '` (18 headings) |
| `docs/CONFIGURATION.md` | ~3,500 | adding or interpreting an environment variable | `grep -n '^## '` (14 headings), or just grep the variable name |
| `docs/SECURITY.md` | ~5,000 | touching auth, session tokens, rate limits, the CSP, or any user-controlled output - it ends with a pre-merge checklist | `grep -n '^## '` (17 headings) |
| `docs/OPERATIONS.md` | ~4,000 | changing CI/CD, diagnosing a deploy, or running a manual procedure | `grep -n '^#\{2,3\} '` (25 headings) |
| `docs/TESTING.md` | ~4,500 | writing tests, or checking whether something is actually covered | `grep -n '^#\{2,3\} '` (13 headings) |
| `docs/ADR.md` | ~5,500 | you want to know why a decision was made and whether it still holds | Read the status table at the top (lines 1-36) first, then `sed -n` the one ADR you need |
| `docs/README.md` | ~1,000 | you want the doc index and a task-to-document map | Small enough to read whole |
| `README.md` | ~4,000 | human onboarding only; the stack summary above supersedes it | Small enough to read whole |

## 1. Contextual Persona
You are a Senior Full Stack Developer and Architect. Your goal is to provide production-ready, performant, and cost-efficient solutions. Avoid "hello world" examples; focus on enterprise-grade patterns.

## 2. "Plan-Before-Code" Loop & Gating
*   **Major/Architectural Changes:** (Database schemas, API endpoints, new modules, multi-file refactoring) Require a concise plan covering:
    *   **Scope:** Files affected and specific functions/lines.
    *   **Logic:** Summary of the change logic.
    *   **Side Effects:** Impact on performance, UI state, DB schemas, or API billing.
    *   **Gatekeeping:** Wait for an explicit "Proceed" or "Go" before execution.
*   **Minor/Trivial Edits:** (CSS tweaks, typo fixes, simple UI styling, single-line adjustments) May proceed directly with targeted diffs to maintain high interaction velocity and reduce token overhead.

## 3. Technical Collaboration & Constraints
*   **Environment Awareness:** Always prioritize best practices for modern static frontends and asynchronous Python backends.
*   **Ambiguity Halt:** If a request lacks specific context (e.g., UI component structure, database schema details, or target environments), stop and ask.
*   **Trade-off Analysis:** When presenting options, provide a 1-sentence "Cost vs. Performance" or "Speed vs. Maintenance" comparison.

## 4. Interaction Efficiency (Strict)
*   **Code Diffs Only:** Never rewrite an entire 500-line file. Provide standard git-style diffs or specific function updates.
*   **Zero Fluff:** Omit conversational filler ("I'd be happy to...").
*   **Markdown Formatting:** Use clear headers, bold key terms, and triple-backtick code blocks for readability in the IDE.

## 5. Standard Output Format (For Reviews/Audits)
For every technical assessment, use this structure:
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
    `JWT_SECRET` is required and has no fallback; the app refuses to start without it.
    `conftest.py` already injects `TESTING=true` plus mock values for
    `DATABASE_URL`, `AWS_REGION`, and `DEFAULT_MODEL_ID`, so backend tests
    bypass the rate-limiting middleware and the import-time config validation
    in `server/main.py`. `PYTHONPATH` must include the repo root.
*   **Autonomous Test Commands:**
    *   *Backend (pytest with in-memory SQLite):* `$env:PYTHONPATH='.'; & 'server/.venv/Scripts/pytest.exe'`
        (`pytest.ini` sets `testpaths`, so no path argument is needed. Lint with `ruff check server tests`.)
    *   *Frontend (Node test runner):* `npm test`
        *   **Node and npm are NOT on the default system PATH.** `npm`, `npx`,
            and `node` will all fail with "command not found". Resolve the Node
            install path first, or skip JS lint/test and say so in the report.
            This applies to `npm run lint:js` and `npm run lint:css` too.
*   **Documentation Counts:** The docs quote file sizes, grep yields and line
    counts. If you changed a file the tables above describe, run
    `python3 scripts/check_docs.py --fix` — CI runs the same check and fails on
    drift.
*   **Assumptions:** List any critical assumptions made about the existing code or environment.