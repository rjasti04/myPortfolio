# Intent: Whole-Codebase Review §2 — Security Remediation

**Source report**: `docs/review/codebase_review_20260924.md`, §2 "Security",
findings **S1–S18** (1 × P1, 8 × P2, 9 × P3). The report's line numbers refer to
`f33d629`. HEAD at the time of writing is `537be41`, which carries the §1
implementation, and that moved lines in `auth_service.py`, `chat_routes.py`,
`chat.js`, `auth.js` and `deploy.yml`. The spec cites line numbers at `537be41`.
**Companion spec**: `.claude/specs/2026-09-24-codebase-review-security.md`
**Status**: planned. Nothing is implemented yet.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter: S9 shows one visitor's signed-in chat
        transcripts to the next person on the same browser. S15 lets a model
        reply make the page fetch an image from any HTTPS origin. S14 writes
        sign-in links into the server log and into Cache Storage.
  - [x] 2. Portfolio as a Work Sample: S1 contradicts a recorded decision
        (ADR-023: the server owns the model). S5 contradicts the
        account-enumeration table in `docs/SECURITY.md`. S6 contradicts the
        comment directly above it in `.env.example`. A security reviewer
        notices first when code contradicts its own documentation.
  - [x] 3. Owner: he pays for S1 (an anonymous caller picks the Bedrock model)
        and S13 (control-plane calls). He is the account S3 and S4 put at
        risk: guessing is unbounded for a parallel attacker, and anyone can
        lock him out. S7 and S17 protect his production host and deploy
        pipeline.

- **Problem Statement**:
  Every finding was re-checked against the working tree before this was
  written, and **all 18 still reproduce**. The spec corrects six of the
  report's proposed fixes:

  1. **S3**: an atomic increment is not enough. Parallel requests all pass
     `enforce_lockout` before any of them records a failure, so N parallel
     guesses are all *checked* even when all N are *counted*. The attempt has
     to be **reserved before the hash is checked**: increment, commit, then
     verify, and refuse without verifying once the reservation passes the
     threshold.
  2. **S4**: exempting a mailed link from the lock does not work while
     passwords and TOTP codes share one tally. `verify_2fa_login` cannot tell a
     lock caused by password guesses from one caused by code guesses. The
     tallies are split. That also closes a gap the report missed: a password
     reset clears the shared tally, so anyone with inbox access can reset,
     sign in, try five codes and repeat. TOTP guessing is then bounded by the
     rate limiter, not by the lock.
  3. **S9**: "drop every session with a `conversationId`" would drop
     anonymous conversations too, because `backfillConversationIds()`
     (`chat.js:489`) gives every row one. A hydrated stub also loses its
     `remote` flag (`chat.js:1082`). Rows are tagged with the owning account's
     id instead.
  4. **S10**: the report puts `expires_at > now()` in the `WHERE` clause. The
     refresh path keeps expiry out of the `WHERE` on purpose
     (`auth_service.py:401-407`), because SQLite and PostgreSQL handle stored
     time zones differently. The fix does the same thing: claim the token in
     the `UPDATE`, then check expiry in Python.
  5. **S14**: the SPA routes on the URL fragment. The inline pre-boot router
     (`index.html:309`), `navigation.js`, `analytics.js:371` and
     `error-handler.js:60` all read `location.hash`. A token in the fragment
     has to be stripped by that inline script, before any module runs. That
     edits a CSP-pinned script, so the hash is re-pinned.
  6. **S17**: `npm audit --omit=dev` would audit nothing, because every npm
     package is a devDependency. DOMPurify, marked and Font Awesome ship to
     visitors, so they move to `dependencies`. A new test proves that the
     vendored copies match `node_modules`, so auditing `node_modules` audits
     what ships. The report also offers Node 20, which reached end of life on
     2026-04-30. The target is Node 22.

  Two smaller corrections: S16's "re-pin the hashes" is not needed for the
  `connect-src` change, because a CSP hash covers an inline script's body and
  not the meta tag. And `docs/SECURITY.md` gives the general rate budget as
  60/min, but the code default is 1000 (`settings.py:86`). The S12 doc edit
  fixes that too.

  The 18 findings fall into five groups, and the spec delivers each group as
  one PR:

  | Phase | Group | Findings |
  | :--- | :--- | :--- |
  | A | The anonymous chat surface: cost and disclosure | S1, S2, S13 |
  | B | Credential guessing and account enumeration | S3, S4, S5, S10, S11, S12 |
  | C | Deleted and signed-out data | S8, S9 |
  | D | Secrets, CI and supply chain | S6, S7, S17, S18 |
  | E | Token URLs, CSP and headers | S14, S15, S16 |

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001: vanilla ES modules. No new frontend module. S9 adds one export to
    `auth.js`, and S14 hands the token over through a `window` property set
    by the inline pre-boot script. `window.AppLogic` already sets that
    precedent.
  - ADR-016: no new origin. S15 *narrows* `img-src` to `'self' data:`, and
    S16 removes the two loopback origins from the shipped `connect-src`.
  - ADR-023: S1 *enforces* it. The client can no longer name a model.
  - ADR-014: Phase B's schema change is one Alembic migration.
  - ADR-021: S17 and S18 regenerate the Python locks with the `uv pip compile`
    command in each file's header. `package-lock.json` is regenerated by npm.
    No lock is edited by hand.
  - `POST /chat` and `POST /sessions` stay anonymous.

- **Standing decisions deliberately changed** (each is recorded in the doc
  that states it, not left implicit):
  - `docs/SECURITY.md` "Account lockout" calls the **shared** password/TOTP
    tally deliberate. Phase B splits it. The sharing was there to fix one
    bug: TOTP codes used to sit outside the lockout. Separate tallies fix that
    bug too, and they are what make a mailed-link exemption safe.
  - `POST /auth/register` changes from **201 + `UserResponse`** to **202 + a
    message**, and gives that same answer for an address that already has an
    account. It is the only API contract change here that a client can see.
  - `GET /models` is removed. Nothing calls it.
  - The toolchain floor moves from Node 18 to Node 22 (`package.json`
    `engines`, the workflows, `AGENTS.md`).

- **Explicit Non-Goals**:
  - Sections 1 and 3–5 of the report. §1 is done. Three later findings touch
    the same code as this work, and the spec records how they are sequenced.
    They are not fixed here:
    - PF1: bcrypt runs on the event loop
    - PF2: a second migration, on the same head
    - CS2: `REVIEW.md`'s ADR-023 check looks at the wrong layer
  - No HSTS header. It is an accepted limitation, and the report does not
    score it.
  - No per-source lockout counting and no exponential delay (S4's
    alternatives). In-memory per-source state is per process and is lost on
    restart (ADR-012). IPv6 sources are cheap, even at /64.
  - No CAPTCHA, no 2FA recovery codes, and no encryption of `totp_secret` at
    rest. Those are listed limitations, or findings from earlier reviews.
  - No Redis-backed limiter (ADR-012 stays Proposed).
  - Phase D does not add an IAM or host-side change. Removing
    `bedrock:ListFoundationModels` from the instance role after S13, and
    checking the production `JWT_SECRET` before S6, are owner actions, and
    the spec lists them.

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend** (phases B, C, D, E): `npm run lint` && `npm test`.
      `npm test` already builds `dist/` and runs `scripts/tests/build.test.js`,
      so a separate `npm run build` adds nothing (`AGENTS.md` §6).
- [x] **Backend** (every phase): `ruff check server tests` &&
      `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`
- [x] **Database** (phase B): one migration on `users`. CI's
      `migration-check` job applies the full chain against PostgreSQL, runs
      `alembic check` and tests reversibility. Locally, the `alembic-guard`
      skill's steps apply.
- [x] **Docs / Hashes** (every phase): `python3 scripts/check_csp_hashes.py` &&
      `python3 scripts/check_docs.py --fix --show-tokens`. Phase E edits an
      inline script and **will** fail the CSP gate until the printed hash is
      pasted in. No other phase touches an inline script.
- [x] **CI** (phase D): the three workflows must still parse. There is no local
      Actions runner, so step conditions and artifact hand-off are checked by
      reading them, and the report says so.

## 4. Risks & Mitigations

- **Security / Authentication**: Phase B rewrites the lockout, which makes it
  the riskiest change here. Mitigations:
  - Every existing lockout test keeps passing, except three assertions that
    change on purpose. Those three log in with the *correct* password while
    locked and expect 400 "locked". They now expect the generic 401, which
    still proves the lock holds.
  - A new test fires parallel wrong guesses and asserts that at most
    `LOCKOUT_THRESHOLD` of them reach the password check.
  - The migration adds nullable or defaulted columns only. The old code
    ignores them, so a code-only rollback is safe.
- **What a client sees change**: register (201 → 202, and one message for
  every address), a locked login (400 → 401 with the generic message),
  `model_id` silently ignored, the SSE error text fixed, `/models` gone. The
  client is checked against each:
  - `registerUser` checks only `response.ok`, and `auth-ui.js:920` ignores its
    return value.
  - The login error shows `detail` as it is.
  - `chat.js:2101` only tests `parsed.error` for truthiness.
  - The SPA never sends `model_id` and never calls `/models`.
- **API Cost / Rate Limits**: net reduction. S1 pins the model, and S13 removes
  an anonymous control-plane call. S12 adds three routes to the strict 5/min
  auth budget. A visitor changing a password uses one request of it.
- **Performance**: S5 adds one extra bcrypt verification to the unknown-address,
  locked and purged login paths, to match the two a wrong password already
  costs. That is more event-loop CPU until PF1 lands, and the spec sequences
  PF1 right after Phase B. S14 adds about six lines to an inline script. No
  bundle grows.
- **Deploy-window compatibility**: a tab still running the previous
  `auth-ui.js` from the service-worker cache shows "Account created" for an
  address that already has one, until the worker updates. Mail links issued
  before Phase E still use the query string, and verify links live 24 hours,
  so `auth-ui.js` keeps reading the query as a fallback.
- **CI turning red at introduction (S17)**: blocking audits can fail on the PR
  that adds them. That is the point. A finding in a *shipped* package is
  fixed in the same PR. The full npm audit (dev tooling, currently 8 high)
  stays advisory.
- **Lost production login (S6)**: if the production `.env` still holds the
  example placeholder, the API will refuse to start once Phase D deploys. The
  deploy's health check then fails, and the automatic rollback runs. The owner
  checks the value first, and rotates it if it matches, which signs everyone
  out once.

## 5. Assumptions

This is a non-interactive session (Claude Code on the web), so the
intent-planner interview was skipped. These answers were inferred and chosen:

1. **Scope** is exactly S1–S18. Nothing from §3–§5 of the report is included.
2. **This task's deliverable** is the intent and the spec. "Before
   implementing" was read as a gate, the same way the §1 work read it.
   Implementation follows, phase by phase, once the spec is approved.
3. **Delivery** is five PRs, phases A–E, in that order: severity first, then
   by which files each phase touches. Each PR runs only the gates for the
   layers it touches.
4. **S1 ignores `model_id`** (Pydantic `extra="ignore"`) instead of rejecting
   it with 422. The SPA never sends it, and 21 request payloads in the
   backend tests do. A 422 would add churn and no security.
5. **S4 splits the tallies**, adding `totp_failed_attempts` and
   `totp_locked_until`, in the same migration as S11's `totp_last_step`.
   One migration on `users` is cheaper than two.
6. **S5 answers 202** for both a new and an existing address. An existing
   address gets a "you already have an account" mail instead of a
   verification mail. 201 was rejected because it promises a resource the
   server may not have created.
7. **S7 reuses the `dist/` that `frontend-check` already builds**, uploaded as
   an artifact that lives one day. A separate build job would build the same
   commit a second time.
8. **S16 keeps `https://staging-api.rjasti.com`** in the shipped
   `connect-src`. `getApiBaseUrl()` still sends any `staging` host there, and
   it is a first-party origin. Only the two loopback origins are stripped,
   because local development serves `frontend/`, not `dist/`
   (`docs/FRONTEND.md` "Local development").
9. **Node 22**, not 24. Claude Code web sessions already run v22.22.2, so a
   green local `npm test` is evidence for CI. 24 is a later, separate bump.
10. **The §1 stopgap stays.** The §1 spec said S9 would remove the C5
    "Sign in to load this conversation." notice. It stays, because a sign-out
    in *another* tab fires no `auth-changed` in this one, and the notice is
    what covers that case.
