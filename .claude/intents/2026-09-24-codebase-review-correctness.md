# Intent: Whole-Codebase Review §1 — Correctness Remediation

**Source report**: `docs/review/codebase_review_20260924.md`, §1 "Correctness",
findings **C1–C18** (6 × P2, 12 × P3). The report's line numbers refer to
`f33d629`. HEAD at the time of writing, `4aa4792`, only adds the report, so the
line numbers still apply.
**Companion spec**: `.claude/specs/2026-09-24-codebase-review-correctness.md`
**Status**: planning only. This document and its spec are the whole of this
change. No source file is edited until the spec is approved.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter: C6 breaks URLs a recruiter already has. That
        is `/rjasti_resume.pdf`, `/favicon.ico` and all eight sitemap image
        URLs, which ship only under hashed names. C5, C11 and C12 hit the AI
        chat, the most-demoed surface: a spinner that never resolves,
        transcripts evicted, and two replies interleaved into one transcript.
  - [x] 2. Portfolio as a Work Sample: C1 and C4 are failures that the code's
        own comments describe as fixed. C1 is at `auth.js:339-345`. C4 undoes
        the design written up at `auth.js:348-360`. A reviewer notices first
        when code contradicts its own comments.
  - [x] 3. Owner: he is the one signed-in user. C1, C3 and C4 sign him out, or
        leave a signed-out session live for 30 days. C13 and C14 are bugs in
        his dashboard. C8, C9 and C10 lose his analytics data. C7 is his
        deploy.

- **Problem Statement**:
  Every finding was re-checked against the working tree before this was
  written, and **all 18 still reproduce**. The spec corrects three of the
  report's proposed fixes and widens one finding:

  1. **C11(c)**: "never cap away rows without a `conversationId`" would protect
     nothing. `backfillConversationIds()` (`chat.js:484`) gives every row a
     `conversationId` on load. The row that is safe to evict is the
     **unhydrated server stub** (`remote && !hydrated`), because the server
     lists it again on the next sync.
  2. **C10**: "chunk `keepalive` bodies under ~60 KiB" does not work. The Fetch
     spec applies its 64 KiB limit to the **sum** of in-flight keepalive
     bodies, so a second chunk sent during the same unload is rejected too.
     Send one bounded body, and leave the rest persisted for the next visit.
  3. **C6**: the fix conflicts with an existing gate.
     `scripts/tests/build.test.js:150` asserts that *every* shipped image and
     PDF is hashed. That test is changed to allow an explicit alias allowlist.
     It is not deleted.
  4. **C5 is wider than reported.** Fixing the persisted `hydrating` flag is
     not enough. Init (`chat.js:2276`) repaints the active session with
     `restoreActiveSession()` and never hydrates it. After a reload, an active
     stub whose load failed, or the stub that a 404 promotes to active, still
     paints "Loading this conversation…" with no request in flight.

  The 18 findings fall into five groups, and the spec delivers each group as
  one PR:

  | Phase | Group | Findings |
  | :--- | :--- | :--- |
  | A | Auth session integrity: a valid session is destroyed, or an ended one survives | C1, C2, C3, C4, C14(b) |
  | B | Chat state | C5, C11, C12, C17 |
  | C | Client lifecycle: dashboard, service worker, analytics queue, highlighter | C10, C13, C14(a), C15, C16 |
  | D | Ingest durability | C8, C9 |
  | E | Build, CI, dependencies | C6, C7, C18 |

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001: vanilla ES modules. No new module is needed. Cross-module
    signals use a `window` `CustomEvent`, which avoids a new import edge.
  - ADR-016: no new origin. The C6 aliases are same-origin files in `dist/`.
  - ADR-023: C17 *enforces* a server-side ceiling on a second route. Nothing
    here adds a client-controlled knob.
  - ADR-014: **no schema change is required.** C3 uses existing
    `refresh_tokens` columns (`token_jti`, `user_id`, `is_revoked`). If one
    turns out to be needed, it goes through Alembic.
  - ADR-021: C18 regenerates both locks with `uv pip compile`. The locks are
    never edited by hand.
  - `POST /chat` and `POST /sessions` stay anonymous.

- **One standing rule is deliberately crossed**: `AGENTS.md` says anything that
  writes a user's own data takes `get_current_user`. After C3, `POST
  /auth/logout` authenticates primarily by **possession of the refresh token**
  in the body, the same credential `POST /auth/refresh` already accepts. This
  is what lets a visitor whose 30-minute access token has expired actually
  sign out. The bearer path stays as a fallback. The decision is recorded in
  `docs/SECURITY.md` and `docs/API.md`, not left implicit.

- **Explicit Non-Goals**:
  - Sections 2–5 of the report. Five of those findings touch the same files as
    this work, and the spec records how the two pieces of work are sequenced.
    They are not fixed here:
    - S1: `model_id` on `ChatStreamRequest`
    - S9: transcripts that survive sign-out
    - S12: lockout on the re-authentication routes
    - U1: the account menu cannot be reached by keyboard
    - U3: the Stop button's accessible name
  - No cross-tab sync layer (`BroadcastChannel`, `storage` listener) for C1.
    Re-reading storage before clearing is enough. The server does no
    refresh-family revocation on reuse (checked at `auth_service.py:394-398`),
    so the losing tab can safely adopt the winner's token pair.
  - No change to token lifetimes, the rotation scheme, lockout thresholds or
    rate budgets.
  - No dead-letter queue for C9. Rows that fail are counted, as they are now.
  - C7 does not split the deploy into a build job and a deploy job. That is
    S7's fix.
  - No retention or purge job (S8, and the accepted risks).

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend** (phases A, B, C, E): `npm run lint` && `npm test`. `npm test`
      already builds `dist/` and runs `scripts/tests/build.test.js`, so a
      separate `npm run build` adds nothing (`AGENTS.md` §6).
- [x] **Backend** (phases A, B, D, E): `ruff check server tests` &&
      `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`
- [ ] **Database**: not impacted, because no model changes. CI's
      `alembic check` must stay green, and that is the proof.
- [x] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` &&
      `python3 scripts/check_docs.py --fix --show-tokens`. No inline `<script>`
      in `index.html` is in scope, so the hashes should hold. The gate runs
      anyway, because the 2026-09-22 spec predicted the same thing and was
      wrong.
- [x] **CI** (phase E): `.github/workflows/deploy.yml` must still parse. There
      is no local Actions runner, so the step conditions are checked by
      reading them, and that is stated in the report.

## 4. Risks & Mitigations

- **Security / Authentication**: C3 is the highest-risk change here, because it
  changes how logout authenticates. Mitigations:
  - The refresh token's signature and `type` are verified.
  - The revocation is scoped by both `sub` and `jti`, so one user cannot
    revoke another's session.
  - The route is idempotent, and its response is the same whether or not a
    row matched, so it is not an oracle.
  - Cached old clients that send only a bearer token are still served, now for
    one session rather than all of them.

  The blast radius of a revocation narrows. Signing out of one device no longer
  voids pending one-time links. Those expire within 15 minutes, and password
  change, password reset and account deletion still void them.
  `SECURITY.md:85-88` is updated to say so.
- **Status-code contract (C2)**: four routes move from 401 to 400. The client
  is status-agnostic on all four: each wrapper throws with the server's
  `detail`, as checked in `auth.js:76-95` and `:283-319`. 400 is not in
  `isCredentialRejection`, so the change cannot sign anyone out. Three existing
  backend assertions change with it (`test_auth.py:263`, `:776` and `:862`).
  Delete-account has no wrong-password test today, and it gets one.
- **API Cost / Rate Limits**: net reduction. C17 closes a small anonymous
  inference path, and C12(1) stops a summarise-then-stream turn from running
  on after Stop. No budget changes.
- **Performance / Asset Size Impact**: C6 adds about 2.6 MB of unhashed copies
  to `dist/`, all on the deploy side. Pages keep pointing at the hashed names,
  so no visitor downloads more. The aliases get `max-age=3600,
  must-revalidate` from the existing rule at `.htaccess:112-114`. C9's
  row-by-row retry runs only after an `IntegrityError`, on batches of at most
  `KAFKA_BATCH_SIZE` (default 10).
- **Deploy-window compatibility**: a tab still running the previous
  `auth.js` from the service-worker cache sends a bearer-only logout. The
  server resolves that through the token's `sid` claim, which is better than
  today's behaviour. No schema change means a code-only rollback is safe.
- **Overlap with later sections**: U1 rewrites the same `setupNavUI` block as
  C4 and C14(b), and S9 edits the same `auth-changed` handler and
  `saveSessions` as C5. The spec sequences Phase A before U1 and Phase B before
  S9, so each later fix builds on this one instead of conflicting with it.

## 5. Assumptions

This is a non-interactive session (Claude Code on the web), so the
intent-planner interview was skipped. These answers were inferred and chosen:

1. **Scope** is exactly C1–C18. Nothing from §2–§5 of the report is included.
2. **This task's deliverable** is the intent and the spec. "Before
   implementing" was read as a gate. Implementation follows, phase by phase,
   once the spec is approved.
3. **Delivery** is five PRs, phases A–E, in that order: severity first, then
   by which files each phase touches. Each PR runs only the gates for the
   layers it touches.
4. **C2 uses 400.** 403 was rejected because `isCredentialRejection` signs the
   visitor out on it. 422 was rejected because it is FastAPI's code for a
   schema failure, and `docs/API.md:787` documents it that way.
5. **The C3 body is optional**, so cached clients that send no body keep
   working.
6. **C7**: step-level `timeout-minutes` is the primary fix, because a step
   timeout is a step *failure*, so `failure()` fires whichever way GitHub
   treats a job timeout. `cancelled()` is added as a second line of defence.
   The report lists that behaviour as unverified.
7. **C17 is a shared helper function, not a FastAPI dependency.** As a
   dependency it would have to declare the `ChatStreamRequest` body a second
   time next to the route's own.
8. **C15 uses a `window` event.** `activity.js` reports a failed chunk import
   by firing `rj:stale-build`, and `main.js` owns the banner. That avoids a
   static import of the entry module from a lazily loaded one.
