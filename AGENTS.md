# AI Agent Operating Protocol (v2.0)

## Environment Context
- **Platform**: Static single-page portfolio/PWA frontend, optional FastAPI backend, PostgreSQL database, AWS Amazon Bedrock
- **Hosting/runtime**: Static web hosting or Apache-compatible server for frontend; ASGI/Uvicorn for API; production API target is `https://rjasti.com/api`
- **Build**: `npm run build` (esbuild) emits `dist/` - bundled, minified, content-hashed - and the deploy ships that, not `frontend/`. `frontend/` stays the source of truth and still runs standalone. Fonts and the two vendored libraries are local: the SPA loads no third-party *asset* - no script, stylesheet, font or image from another origin. The contact form posts to the first-party `POST /contact`; its POST to `formsubmit.co` (`frontend/js/form.js`) survives only as a **fallback** for an unreachable API, which is why `form-action` and `connect-src` still name it. It is the sole remaining third-party origin: `get.geojs.io` and `api.open-meteo.com` were vestigial and have been removed.
- **Languages**: HTML, CSS, JavaScript ES modules, Python 3.10+
- **Tooling**: Node.js 18+, npm, ESLint, Stylelint, Prettier, Node test runner, jsdom; ruff, pytest (+ pytest-asyncio, pytest-cov), Alembic
- **Backend stack**: FastAPI, Pydantic v2, asyncpg, boto3/botocore, orjson, structlog
- **Frontend stack**: Vanilla JS modules, a CSS-painted static backdrop (the animated 2D-canvas background has been removed), service worker, web app manifest, DOMPurify and marked (vendored from npm), Font Awesome and Plus Jakarta Sans (self-hosted, subset - no Google Fonts or cdnjs request)
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
| A broader ECC install | Three Everything Claude Code skills are vendored under `.claude/skills/`; its rules, agents, commands, hooks and memory are refused, and `check_agent_config.py` fails if a fourth skill or a foreign hook appears | `docs/ECC.md` |

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

Two rules files carry this, so they load only when you actually touch the code
or docs they describe rather than on every session:

- `.claude/rules/navigation.md` — the five files never to read end-to-end, the
  grep recipe that replaces each one, and the `server/.venv/` search trap.
- `.claude/rules/reference-docs.md` — per-doc token costs and the heading-map
  recipe that turns a whole-document read into a section read.

`scripts/check_docs.py` recomputes the figures in both, and both are still the
source of truth for them — do not restate a count here.

The three vendored ECC skills (`fastapi-patterns`, `accessibility`, `context-budget`)
load on demand like any other skill and are never hand-edited — `docs/ECC.md` explains
why each is here, what was refused, and how to upgrade or remove them.

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
*   **Intent & Spec Documents:** When preparing feature requirements or technical specifications, never overwrite `.claude/templates/intent.md` or `spec.md`. Always save to a distinct file: `.claude/intents/YYYY-MM-DD-<feature-slug>.md` and `.claude/specs/YYYY-MM-DD-<feature-slug>.md`.

## 3. Technical Collaboration & Constraints
*   **Environment Awareness:** Always prioritize best practices for modern static frontends and asynchronous Python backends.
*   **Ambiguity Halt:** If a request lacks context (UI component structure, schema
    details, target environment), look for it first — the reference table in
    `.claude/rules/reference-docs.md` usually answers it, and the repo is the
    cheaper source. Stop and ask only when two readings would produce materially
    different work *and* somebody is there to answer. Otherwise state the
    assumption you picked and keep going.
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
*   **Lightweight & Token-Efficient:** A minor edit — §2's list, including a CSS or markup fix
    that leaves JS, the API and the schema alone — gets a minor verification pass by default;
    the user should not have to ask for it. Going further needs an explicit request: if you
    think it is warranted, say so in the summary instead of doing it.
    *   **Gates:** the lint and test commands below for each layer you touched, run **once,
        after the last edit**; if one fails, fix it and re-run that gate alone. For `frontend/`
        that is `npm run lint` and `npm test` — `npm test` already builds `dist/` and enforces
        the size budget (`scripts/tests/build.test.js`), so a separate `npm run build` adds
        nothing. The `check_docs.py` repair below still applies.
    *   **Evidence:** at most one check that the bug is gone, at the width or state that showed
        it. No sweeps across widths or font sizes, no before/after diffs, no screenshots, no
        browser subagents.
    *   **Scope:** pick the smallest fix that fits the surrounding idiom; don't survey
        alternatives. Edit a doc only where the change made it wrong — no notes recording the fix.
*   **Targeted Sanity Checks:** Prefer fast, static sanity checks (or brief syntax verification) to preserve context window and reduce token usage.
*   **Local Environment Setup:** Running the API needs a root `.env`; the variables and
    `JWT_SECRET`'s 32-character floor are in `docs/CONFIGURATION.md`. The test suite needs
    none of it: `tests/backend/conftest.py` sets `TESTING=true` and throwaway values that
    satisfy the import-time validation (`docs/TESTING.md`), so you never export anything to
    run it. `PYTHONPATH` must include the repo root.
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
        broken code. On Claude Code web sessions the `SessionStart` hook
        (`.claude/hooks/session-start.sh`) has already done this before your first
        turn, so treat a missing-module error there as a real failure and read the
        hook's stderr before re-running anything. Anywhere else, install first: run
        `npm ci --no-audit --no-fund`, and for the backend create the virtualenv and
        install into it (`python3 -m venv server/.venv && server/.venv/bin/pip
        install -r server/requirements.txt -r server/requirements-dev.txt`). The
        requirement files are hash-pinned (ADR-021), so installing them over a
        distro-managed package can fail — the venv is what avoids that.
    *   **Resolve the toolchain; do not assume it is missing.** `node`, `npm`,
        `pytest` and `ruff` are all on PATH in CI and in Claude Code web sessions.
        Some local shells differ, so run `command -v node npm pytest ruff` first and,
        if something really is absent, look in `/opt/node*/bin`, `server/.venv/bin`
        and `~/.local/bin` before concluding you cannot run a gate. Skipping a gate is
        a last resort and must be stated explicitly in your report.
*   **Generated Counts and Hashes:** Two CI gates recompute things you can invalidate
    by hand. Both are wired as `PostToolUse` hooks in `.claude/settings.json` — for
    `Write`/`Edit` and for the `Bash` commands that write the same files — so they run
    automatically after you touch a covered file. The hooks run the *check*, not the
    repair, and they do not block: `PostToolUse` fires after the write has already
    landed, so the drifted file is on disk and the hook's job is only to put the
    drifted figures in front of you. Repairing them is yours.
    *   `python3 scripts/check_docs.py --fix` — line counts, grep yields and token
        estimates in `.claude/rules/navigation.md` and
        `.claude/rules/reference-docs.md`, plus per-module counts in
        `docs/JAVASCRIPT.md` and `docs/TESTING.md`. Pass `--show-tokens` to display the document token estimates table.
        **Rule:** The `PostToolUse` hooks above already run the *check* after every
        covered edit, so what is left to you is the repair and the report: after
        completing any task that modified `.md` files or tracked assets, run
        `python3 scripts/check_docs.py --fix --show-tokens` and display the token
        table in your final response.
    *   `python3 scripts/check_csp_hashes.py` — the three pinned `sha256-` hashes in
        `frontend/index.html`'s CSP. **Editing any inline `<script>` in `index.html`
        invalidates one of them and fails CI.** There is no `--fix`: on failure it
        prints the exact `sha256-` value to paste into `script-src`. Note that
        `npm run format` reformats inline scripts and breaks the hashes, which is why
        `index.html` is in `.prettierignore`.
*   **Assumptions:** List any critical assumptions made about the existing code or environment.