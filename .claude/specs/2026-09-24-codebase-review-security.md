# Technical Specification: Whole-Codebase Review §2 — Security Remediation

**Related Intent**: `.claude/intents/2026-09-24-codebase-review-security.md`
**Source report**: `docs/review/codebase_review_20260924.md` §2 (S1–S18)
**Target Audience**: Owner first, then Visitor / Recruiter and Work Sample
**Status**: planned. Nothing is implemented yet.
**Tree**: line numbers are at `537be41`, which is the report's `f33d629` plus
the §1 implementation. Where §1 moved a line, the number here differs from the
report's, and the number here is the one to use.

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA: `frontend/js/auth.js`, `auth-ui.js`, `chat.js`,
        `frontend/sw.js`, `frontend/index.html` (one inline script and the
        CSP meta), `frontend/.htaccess`
  - [x] Backend API: `server/schemas/chat.py`, `server/schemas/auth.py`,
        `server/routes/chat_routes.py`, `server/routes/auth_routes.py`,
        `server/routes/system_routes.py`,
        `server/controllers/system_controller.py`, `server/config/settings.py`,
        `server/config/bedrock.py`, `server/services/auth_service.py`,
        `server/services/notification_service.py`, `server/auth/security.py`,
        `server/middlewares/rate_limit.py`, `server/middlewares/server_timing.py`,
        `server/main.py`, `server/config/resume_context.py`,
        `scripts/clear_2fa.py`
  - [x] Database Schema: `server/models/user.py`, plus one new migration under
        `server/alembic/versions/` (§3)
  - [x] CI/CD & Deploy: all three `.github/workflows/*.yml`,
        `.github/dependabot.yml`, `scripts/build.mjs`,
        `scripts/tests/build.test.js`, `package.json`, `package-lock.json`,
        `server/requirements*.{in,txt}`, `.gitignore`, `.env.example`

- **No new frontend module and no new import edge.** S9 adds one export to
  `auth.js`, which `chat.js` already imports from. S14 hands the token from
  the inline pre-boot script to `auth-ui.js` through `window.__rjAuthLink`.
  `window.AppLogic` is the precedent for an inline or classic script handing
  state to a module.

- **Delivery**: five PRs, in phase order. Each PR runs the gates for the layers
  it touches (§6).

| Phase | Findings | Layers | Why grouped |
| :--- | :--- | :--- | :--- |
| **A** | S1, S2, S13 | BE | The anonymous Bedrock surface. The only P1 lands here, first |
| **B** | S3, S4, S5, S10, S11, S12 | BE + DB + FE copy | Everything that bounds credential guessing or leaks whether an account exists. It shares `auth_service.py`'s lockout helpers and one migration |
| **C** | S8, S9 | BE + FE | Data that outlives the account or the sign-in |
| **D** | S6, S7, S17, S18 | config, CI, deps | Nothing a visitor runs. Two P2s (S6, S7) |
| **E** | S14, S15, S16 | FE + build + mail | The CSP meta, one CSP-pinned inline script and `.htaccess`. All P3 |

---

## 2. API Contract & Schemas

### S1: `ChatStreamRequest` no longer carries `model_id`

```python
# server/schemas/chat.py
class ChatStreamRequest(BaseModel):
    # A supplied `model_id` is dropped, not rejected: see the note below.
    model_config = ConfigDict(extra="ignore")

    messages: List[ChatMessage] = Field(...)            # unchanged
    conversation_id: Optional[str] = Field(None, max_length=36)
    stream: Optional[bool] = Field(default=True)
```

- `model_id` is deleted (`chat.py:52`), and a comment joins the existing
  `system_prompt` note (`:55-62`): the same reasoning, ADR-023, applies to the
  model.
- `extra="ignore"` is Pydantic's default. It is stated explicitly so a later
  `extra="forbid"` is a deliberate choice. Why not 422: the SPA never sends the
  field, and 21 test payloads do. Rejecting it buys no security.
- **Route** (`chat_routes.py:74-76`): the `requested_model` lookup and the
  allowlist check are deleted. The stream (`:121`) and the history save
  (`:188`) both use `DEFAULT_MODEL_ID`.
- **Settings** (`settings.py:117-125`): `ALLOWED_MODEL_IDS` is deleted, along
  with both hard-coded `.add(...)` lines. Nothing else reads it: grepped
  across `server/`, `tests/` and `frontend/`. An operator's `.env` that still
  sets it is ignored harmlessly.
- `bedrock_service.stream_chat_response(model_id=...)` keeps its parameter.
  It is internal, and tests use it.

### S2: the SSE error frame is fixed text

```text
data: {"error": "The assistant is unavailable right now.", "request_id": "<uuid>"}
```

- `chat_routes.py:134-137`: the route logs `chunk["error"]` together with the
  request id (`request.scope["request_id"]`, set by `RequestIDMiddleware`) and
  streams the fixed frame above. `bedrock_service.py:316-318` is unchanged,
  because it is the internal contract. `/chat/summarize` already maps an error
  frame to a generic 502 (`:247-251`).
- **Client**: no change. `chat.js:2101` only tests `parsed.error` for
  truthiness, and it shows its own message.

### S4 + S5: one login-failure answer

| Case at `POST /auth/login` | Today | After |
| :--- | :--- | :--- |
| Unknown address | 401, 1 bcrypt | 401 `LOGIN_FAILED`, **2** bcrypt |
| Soft-deleted more than 30 days ago | 401, **0** bcrypt | 401 `LOGIN_FAILED`, 2 bcrypt |
| Password tally locked | **400** "Account is temporarily locked…", 0 bcrypt | 401 `LOGIN_FAILED`, 2 bcrypt |
| Wrong password | 401, 2 bcrypt (prehash, then legacy) | 401 `LOGIN_FAILED`, 2 bcrypt |

```python
LOGIN_FAILED = (
    "Incorrect email or password. After 5 failed attempts, password sign-in "
    "pauses for 15 minutes; a sign-in link from your email still works."
)
```

- The same text in every case, so it is not an oracle. The second sentence
  tells a locked-out owner the way in without saying that they are locked out.
- The 2FA and re-authentication routes keep **400** "Account is temporarily
  locked…". Their caller already holds a pre-auth token or a bearer token for
  that account, so the message reveals nothing new.
- `WWW-Authenticate: Bearer` stays on the 401, as it is today.

### S5: `POST /auth/register` → **202** for every address

```python
class RegisterResponse(BaseModel):
    message: str = "Check your inbox to finish setting up your account."
```

| Address | Mail sent (background) | Response |
| :--- | :--- | :--- |
| New | Verification link, as today | 202 `RegisterResponse` |
| Active account, or soft-deleted within 30 days | **New** "you already have an account" mail: sign-in and reset links, and no token | 202 `RegisterResponse` |
| Soft-deleted more than 30 days ago | Purged, then treated as new, as today | 202 |
| `IntegrityError` race | none | 202 |

- **Equal cost**: the existing-address branch runs `get_password_hash()` on the
  supplied password and throws the result away, so both branches cost one
  bcrypt hash. Mail goes out through `BackgroundTasks` on both branches, off the
  response path.
- **Client**: `registerUser` (`auth.js:203-237`) checks only `response.ok`, and
  `auth-ui.js:920` ignores what it returns. Only the copy changes
  (`auth-ui.js:935`, `:943`): *"Check your inbox. A new address gets a
  confirmation link; one that already has an account gets a sign-in reminder
  instead."* Both cases show that same text.
- **`Server-Timing`** is left off every response whose path, after the `/api`
  prefix is stripped, starts with `/auth/` (`server_timing.py`). The Activity
  dashboard reads the header only from its own non-auth requests.

### S13: `GET /models` is removed

The route (`system_routes.py:19-24`), `list_models`
(`system_controller.py:47-66`) and the `bedrock_mgmt` client
(`config/bedrock.py:23`) are deleted. Nothing in `frontend/` or `tests/` calls
the route. `GET /models` then returns 404 under both mount prefixes.

---

## 3. Database Schema & Migration Plan

**Phase B only.** There is one migration, `l5a6b7c8d9e0`, with
`down_revision = "k4f5a6b7c8d9"`, which is the current single head.

| Column on `users` | Type | Null | Default | For |
| :--- | :--- | :--- | :--- | :--- |
| `totp_failed_attempts` | `INTEGER` | no | `server_default="0"` | S4: the code tally |
| `totp_locked_until` | `TIMESTAMPTZ` | yes | — | S4: the code tally |
| `totp_last_step` | `BIGINT` | yes | — | S11: the last accepted TOTP time step |

- **No backfill.** A lock that exists today stays on `locked_until`, now
  meaning the password tally, and it expires within 15 minutes whatever
  caused it.
- **Backward compatible**: all three columns are nullable or defaulted, so the
  previous release's code runs against the new schema. That matches the
  production rollback policy (code rolls back, the schema does not).
- **Checks**: the `alembic-guard` skill's steps locally. In CI,
  `migration-check` asserts a single head, applies the chain to PostgreSQL,
  runs `alembic check`, and runs upgrade → downgrade -1 → upgrade.
- `docs/DATABASE.md`: the `users` column table and the migration list.

---

## 4. Implementation & Acceptance

Each row names the signal a test asserts. File paths are relative to the repo
root. Backend tests live under `tests/backend/`, frontend tests under
`frontend/tests/`.

### Phase A: the anonymous chat surface

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **S1** | §2 contract. | `server/schemas/chat.py`, `server/routes/chat_routes.py`, `server/config/settings.py`, `.env.example:78` | `test_chat_stream.py`: `test_chat_stream_invalid_model` (`:148`) is **replaced** by a test that sends `model_id: "anthropic.claude-3-5-sonnet-20241022-v2:0"` with `DEFAULT_MODEL_ID` patched to a gemma id, and asserts that Bedrock was called with the gemma id and the answer is 200. The two tests that picked the Anthropic invoke path through `model_id` (`:58`, `:499`) patch `server.routes.chat_routes.DEFAULT_MODEL_ID` instead. The same payload on `/chat/summarize` is also unaffected |
| **S2** | §2 contract. | `server/routes/chat_routes.py` | A mocked `ClientError` whose message contains `arn:aws:iam::123456789012:role/x`: the SSE body contains neither `arn:` nor `123456789012`, and does contain `"request_id"` and the fixed text |
| **S13** | §2. Remove the route, controller and client. | `server/routes/system_routes.py`, `server/controllers/system_controller.py`, `server/config/bedrock.py` | `GET /models` and `GET /api/models` return 404. `test_frontend_api_contract.py` still passes, because the route was never in it |

### Phase B: credential guessing and enumeration

**Invariant for the phase**: *no credential is checked unless an attempt has
first been reserved and committed, and every login failure looks the same from
outside.*

**Two tallies**, each counted by the same pair of helpers:

| Tally | Columns | Counts a wrong… | Cleared by |
| :--- | :--- | :--- | :--- |
| **Password** | `failed_login_attempts`, `locked_until` | password at login, change-password, delete-account, 2FA enable, 2FA disable | any correct password; a password reset; a completed 2FA sign-in |
| **Code** | `totp_failed_attempts`, `totp_locked_until` | TOTP code at `/2fa/verify`, 2FA enable, 2FA disable; a replayed code (S11) | a correct, unreplayed code |

```python
# server/services/auth_service.py (replaces enforce_lockout + register_failed_attempt)
async def reserve_attempt(db, user, tally, now) -> bool:
    """Count this attempt *before* the credential is checked, and commit.
    False means locked: refuse without checking the credential."""
    # 1. A lapsed lock resets the tally (today's enforce_lockout behaviour,
    #    kept on the Python side because of the SQLite/PostgreSQL tz difference).
    # 2. n = UPDATE users SET <count> = <count> + 1 WHERE id = :id RETURNING <count>
    #    Keep the in-session `user` at n, so a later flush cannot write back a
    #    stale value.
    # 3. Live lock, or n > LOCKOUT_THRESHOLD: set <until> if it is unset, commit,
    #    return False.
    # 4. Commit, so no row lock is held across the bcrypt check, and return True.

async def record_failure(db, user, tally, now) -> None: ...  # n >= threshold -> set <until>
async def clear_tally(db, user, tally) -> None: ...          # <count> = 0, <until> = NULL
```

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **S3** | (1) **Reserve before verify**: the helpers above replace `enforce_lockout` and `register_failed_attempt` (`auth_service.py:86-122`) at every call site. The report's atomic increment alone still let N parallel requests all pass the pre-check and all be *checked*. (2) **Rate-limit bucket**: a new `_rate_bucket(ip)` in `rate_limit.py` keys all four budgets. IPv4 is keyed by the address; an IPv4-mapped IPv6 address by its IPv4 form; any other IPv6 address by its `/64` network; anything unparseable (`"unknown"`) as it is. `_session_context` keeps logging the full address. | `server/services/auth_service.py`, `server/middlewares/rate_limit.py` | Ten `authenticate_user` calls started together with wrong passwords, against a `verify_password_scheme` spy: **at most `LOCKOUT_THRESHOLD`** reach the spy, and the rest answer `LOGIN_FAILED` unchecked. `_rate_bucket`: `2001:db8::1` and `2001:db8::ffff` share a bucket, `2001:db8:0:1::1` does not, `::ffff:192.0.2.1` equals `192.0.2.1`, and IPv4 is unchanged. One middleware test with `TESTING` unset shows two addresses in one /64 sharing the 5/min auth budget |
| **S4** | Split the tallies (§3 and the table above). `/auth/login` checks only the password tally, and while it is locked answers `LOGIN_FAILED` (§2). `verify_2fa_login` (`:1076`) checks **only the code tally**, so a password lock no longer blocks magic link → 2FA. That is the owner's way in during a lockout DoS. `authenticate_user` clears the password tally on a correct password even when 2FA is pending. The attacker that rule was protecting against already knows the password, and the code tally is untouched. `reset_password_with_token` (`:824-826`) clears the **password tally only**, which closes the reset → sign in → five codes → reset loop. `scripts/clear_2fa.py:124-125` clears both tallies. Magic-link verify for a non-2FA account stays outside the lock, as it is today. | `server/services/auth_service.py`, `server/models/user.py`, the migration, `scripts/clear_2fa.py` | `test_auth.py:863`, `:976` and `:1096` expect **401 `LOGIN_FAILED`** with the correct password while locked, instead of 400 "locked". That still proves the lock holds. **New**: five wrong passwords, then magic link → pre-auth → a correct code gives 200 with tokens. Five wrong codes after a password reset still leave the code tally locked, and a sixth correct code is refused. The unlock-script tests assert that both tallies are cleared |
| **S5** | (1) Register: §2 contract, a new `RegisterResponse`, and a new `send_existing_account_email` in `notification_service.py`. (2) `spend_verification_time(rounds: int = 1)` in `security.py`, and every login failure path that did not run the real check calls it with `rounds=2`: unknown address, purged, locked. (3) `Server-Timing` is left off `/auth/*` (§2). | `server/services/auth_service.py`, `server/routes/auth_routes.py`, `server/schemas/auth.py`, `server/services/notification_service.py`, `server/auth/security.py`, `server/middlewares/server_timing.py`, `frontend/js/auth-ui.js` | Registering an existing address answers 202 with a body byte-identical to a new registration's, and queues the existing-account mail, not a verification mail. A `security.pwd_context.verify` spy counts **2** calls on each of the four login failure paths. `/api/auth/login` responses carry no `server-timing` header, and `/api/health` still does. `auth-2fa.test.js` harness: the register success copy is the neutral text |
| **S10** | `consume_one_time_token` (`:166-184`): `UPDATE one_time_tokens SET used_at = :now WHERE jti = :jti AND purpose = :purpose AND used_at IS NULL`. `rowcount != 1` returns False. Then the row's `expires_at` is read and compared in Python. The report put expiry in the `WHERE` clause, but this mirrors `refresh_user_token:401-407`: tz handling differs between SQLite and PostgreSQL, and burning an expired token is harmless. The "caller commits" contract is unchanged. | `server/services/auth_service.py` | Consuming the same `jti` twice in one session, with no commit between, gives True and then False. The same for two sessions, where the second waits on the first's commit, using the concurrency pattern of the existing refresh-race test. An expired token gives False. A token for another purpose gives False and is **not** marked used |
| **S11** | `consume_totp(db, user, code, now) -> bool`: `step = int(now.timestamp()) // 30`, then `pyotp.TOTP(secret).verify(code, for_time=now)` (window 0, as today). On a match, `UPDATE users SET totp_last_step = :step WHERE id = :id AND (totp_last_step IS NULL OR totp_last_step < :step)`. `rowcount == 1` means accepted. A replay counts as a failed code on the code tally. It is used at the three sites: enable (`:965`), disable (`:1012`) and verify (`:1079`). Disable also sets `totp_last_step = NULL` alongside `totp_secret = None`. | `server/services/auth_service.py` | Log in with a code, then present the same code again on a fresh pre-auth token within the step: 400 "Invalid 2FA code", and `totp_failed_attempts` rises by 1. The next step's code is accepted. The code used to enable 2FA cannot be reused to sign in within its step |
| **S12** | `change_user_password` (`:564`) and `delete_user_account` (`:877`) reserve on the password tally before `verify_password`, and a lock answers 400 "Account is temporarily locked…". `AUTH_RATE_LIMITED_PATHS` (`rate_limit.py:17-42`) gains `/auth/change-password`, `/auth/delete-account` and `/auth/account`. `/auth/account` has only `DELETE`, so matching on the path alone is exact. C2 already made both routes answer 400 on a wrong password, which was the prerequisite the §1 spec recorded. | `server/services/auth_service.py`, `server/middlewares/rate_limit.py` | Five wrong current passwords on change-password, then a sixth with the **correct** one: 400 locked, and the password is unchanged. The same for delete-account, where the account is not deleted. `test_auth_routes_are_strict_limited_under_both_mount_prefixes` (`test_security_wiring.py:121`) is parametrised over the three new paths |

### Phase C: deleted and signed-out data

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **S8** | (1) A shared constant, `ACCOUNT_REACTIVATION_WINDOW = timedelta(days=30)`, replaces the literal at register (`:199`), login (`:261`) and the purge, so the three cannot drift. (2) `purge_deleted_accounts(db, now) -> int` selects `id, deleted_at WHERE deleted_at IS NOT NULL`, filters `_as_utc(deleted_at) < now - window` in Python (the same tz precedent), then `DELETE FROM users WHERE id IN (...)`. The existing `ON DELETE CASCADE` foreign keys remove refresh tokens, one-time tokens, password history, conversations and `user_sessions` rows. Checked: every migration that creates one of those keys carries `ondelete='CASCADE'`. The purge logs a count and ids, never an email. (3) A lifespan task in `main.py:42-66` runs the purge at startup and then every 24 hours. Like the ingest tasks, it is skipped under `TESTING`. Every deploy restarts the service, so it also runs on each deploy. | `server/services/auth_service.py`, `server/main.py` | With the test connection running `PRAGMA foreign_keys=ON`: a user deleted 31 days ago who has a conversation and a refresh token is purged, along with both dependents. A user deleted 29 days ago is untouched. An active user is untouched. The return value is the count |
| **S9** | (1) `auth.js`: a new export `getTokenSubject()` decodes the access token's payload (base64url JSON) and returns `sub`, or `null`. It verifies nothing. It only labels local rows, and the server still authorises every read. (2) `chat.js` tags a session with `ownerId = getTokenSubject()` when `syncServerHistory` creates a stub (`:1028`), when it matches an existing local row (`:1020`), which is how rows created before the fix get tagged, and when a turn is sent while signed in. (3) `dropForeignSessions()` removes every row whose `ownerId` is set and differs from the current subject (`null` when signed out). When signed out, it also removes rows with `remote && !ownerId`: legacy unhydrated stubs, which only an account can own. If the active row goes, the newest remaining row becomes active, or a new one is created. Then it saves and repaints. (4) It is called at init after `loadSessions`, and first thing in the `auth-changed` handler (`:2405`), before its signed-out early return. (5) Anonymous rows, with no `ownerId`, are kept. | `frontend/js/auth.js`, `frontend/js/chat.js` | `chat-history-sync.test.js` harness: signing out removes owned rows and keeps anonymous ones. Signing in as a different subject removes the previous subject's rows. A legacy stub with no `ownerId` is removed on sign-out. Removing the active row activates the newest remaining one. The persisted `rj_chat_sessions` JSON no longer contains the removed rows. `getTokenSubject()` returns `null` for a missing or malformed token |

### Phase D: secrets, CI and supply chain

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **S6** | (1) `.env.example:25` becomes `JWT_SECRET=` (empty), so `required_env` fails with "JWT_SECRET must be set". The comment above it says why it is empty. (2) `_required_secret` (`settings.py:13-32`) also rejects a value containing `replace-me`, `change-me` or `changeme` (case-insensitive), and a value with fewer than `JWT_SECRET_MIN_DISTINCT = 10` distinct characters. The report's broader "change" substring was dropped, because it would reject a legitimate passphrase. | `.env.example`, `server/config/settings.py` | `test_security_wiring.py:300-301` currently asserts that `"a" * 32` is **accepted**. It is inverted to assert rejection, and the accepted case uses `secrets.token_hex(32)`. New tests: the placeholder is rejected, and parsing `.env.example` finds an empty `JWT_SECRET`. The three CI secrets (`deploy.yml:198`, `weekly-audit.yml:51`, `agent-evals.yml:48`) and the conftest value all pass, which the backend gate proves |
| **S7** | (1) `frontend-check`: after "Build Frontend" (`deploy.yml:95-96`), `actions/upload-artifact` uploads `dist/` (name `dist`, `retention-days: 1`, `if-no-files-found: error`) when `github.event_name == 'push' && github.ref == 'refs/heads/main'`. That is the only event the deploy runs on, and both jobs build `github.sha`. (2) `deploy`: "Setup Node.js" (`:329-333`) and "Build Frontend" (`:412-416`) are deleted. `actions/download-artifact` puts `dist/` in place (`timeout-minutes: 3`) **before** "Configure SSH Key". The job then runs no package code at all. "Verify Deploy Sources Are Not Empty" still guards `dist/`. (3) The budget comment (`:288-299`) becomes 5 + 3 + 3 + 3 + 8 + 3 + 5 + 3 = 33, with rollback 11, for 44 of the job's 50. | `.github/workflows/deploy.yml` | The YAML parses. The `deploy` job contains no `npm`, `node` or `setup-node`. `frontend-check` references no `secrets.`. The download step comes before the key-writing step. The arithmetic in the comment adds up |
| **S17** | (1) `permissions: contents: read` at the top of all three workflows. (2) Every `uses:` is pinned to a full commit SHA with a `# vX.Y.Z` comment, resolved with `git ls-remote` at implementation time. The Dependabot `github-actions` entry already exists and keeps them current; its comment ("pins by major tag") is corrected. (3) Secrets reach `run:` only through `env:`. "Configure SSH Key" (`:335-352`) writes `printf '%s\n' "$EC2_SSH_KEY"` and reads `$EC2_HOST_KEY`. (4) **Shipped-package audit**: `dompurify`, `marked` and `@fortawesome/fontawesome-free` move from `devDependencies` to `dependencies`, because their bytes ship to visitors. The lock is regenerated with `npm install --package-lock-only`. The report's `--omit=dev` audited nothing, because every package was a devDependency. A new blocking step in `frontend-check` runs `npm audit --omit=dev --audit-level=high --json` and fails on a finding. If npm's JSON carries an `error` object, meaning the advisory endpoint could not be reached, it only warns. That keeps the reason the existing audit is `continue-on-error` (`:125-137`). The full audit stays advisory. (5) A new build test asserts that `frontend/vendor/purify.min.js` and `marked.min.js` are byte-identical to the `node_modules` files named in `frontend/vendor/README.md`. Without it, auditing `node_modules` says nothing about what ships. (6) `pip-audit` is added to `server/requirements-dev.in`, and the dev lock is regenerated. `backend-check` runs `pip-audit -r server/requirements.txt --require-hashes --disable-pip --no-deps` on one matrix leg, as a blocking step. It reads PyPI, which the install step just before it already needs, so it adds no new availability dependency. (7) `weekly-audit.yml` gains both blocking audits and keeps the full npm audit advisory (`\|\| true`). (8) **Node 22** in every `node-version` (`deploy.yml:58`, `weekly-audit.yml:21`), and `engines.node: ">=22"`. Node 18 and 20 are both past end of life. | `.github/workflows/*.yml`, `.github/dependabot.yml`, `package.json`, `package-lock.json`, `server/requirements-dev.{in,txt}`, `scripts/tests/build.test.js` | All three YAML files parse. `grep -n 'uses:'` shows only 40-hex SHAs. `grep -n '\${{ secrets\.' ` matches no `run:` line. `npm audit --omit=dev --audit-level=high` exits 0 locally, or the finding is fixed in this PR. `pip-audit` exits 0 locally. The vendor-identity test passes. `npm test` passes on Node 22, which Claude Code web sessions already run |
| **S18** | (1) `.gitignore:13-14` becomes `.env*` plus `!.env.example`, and gains `*.pem`, `*.key` and `id_rsa*`. `git ls-files` currently matches none of them. (2) **passlib → bcrypt**: `security.py` calls `bcrypt.hashpw`, `bcrypt.checkpw` and `bcrypt.gensalt(rounds=12)` directly (12 is passlib's default). The current scheme hashes a 64-character hex digest, which is under bcrypt's 72-byte limit. The **legacy** branch passes `plain.encode()[:72]`. Those rows were hashed by bcrypt < 4, which truncated silently at 72 bytes, and bcrypt ≥ 5 raises `ValueError` instead. `requirements.in:41-42` drops `passlib[bcrypt]` and `bcrypt<4.0.0` and adds `bcrypt>=4.2`, and both locks are regenerated. **Expected lock diff**: passlib goes and bcrypt moves. If anything else moves, stop and report. (3) `resume_context.py:25`: the persona line "passlib + bcrypt" becomes "bcrypt". That path triggers `agent-evals.yml`. | `.gitignore`, `server/auth/security.py`, `server/requirements*.{in,txt}`, `server/config/resume_context.py` | **Compatibility fixtures**, generated with passlib 1.7.4 and bcrypt 3.2.2 *before* the swap and committed into the test: a current-scheme hash, and a legacy hash of an 80-byte raw password. Both verify after the swap, the legacy one with `needs_rehash=True`. `git check-ignore .env.production id_rsa x.pem` matches all three, and `.env.example` is not ignored |

### Phase E: token URLs, CSP and headers

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **S14** | (1) Mail links (`notification_service.py:232`, `:271`, `:305`) become `https://rjasti.com/#reset_token=…`, `/#verify_token=…` and `/#magic_token=…`. The fragment never reaches the server, the Apache log or the service worker. (2) The inline pre-boot router (`index.html:309`) runs **before any module**, because module scripts are deferred. It now starts with this check: if the fragment begins with one of those three keys, it sets `window.__rjAuthLink = { kind, token }`, calls `history.replaceState(null, "", location.pathname + location.search)`, and returns. So `analytics.js:371` and `error-handler.js:60` (`pathname + hash`) and `navigation.js` never see the token. **Re-pin** its sha256 in the CSP with the value `check_csp_hashes.py` prints. (3) `auth-ui.js:1365-1415` reads `window.__rjAuthLink` first and deletes it. The query string stays as a fallback: verify links issued before the deploy live 24 hours. That branch can be deleted any time after that. (4) `sw.js:176-186` caches navigations under `origin + pathname` and matches offline with `ignoreSearch`. That also stops each `?s=` share link adding another full HTML copy. `CACHE_NAME` (`sw.js:1`) moves from `rj-portfolio-v30` to `v31`, so the existing token-keyed entries are purged on activate. | `server/services/notification_service.py`, `frontend/index.html`, `frontend/js/auth-ui.js`, `frontend/sw.js` | Backend: all three mails contain `/#<kind>_token=` and no `?<kind>_token=`. Frontend: the inline script's text, read from `index.html` and run in jsdom at `/#magic_token=abc`, leaves `window.__rjAuthLink.token === "abc"` and an empty `location.hash`. The `auth-2fa.test.js` harness verifies a magic link from `__rjAuthLink`, and from `?magic_token=` as the fallback. A `sw.js` test: navigations to `/?s=x` and `/?magic_token=y` both put exactly one entry, keyed `/`. `check_csp_hashes.py` passes after the re-pin |
| **S15** | (1) `renderBotHTML` (`chat.js:17-28`) calls `DOMPurify.sanitize(html, { FORBID_TAGS: ['img'] })`, and a marked `image` renderer emits an escaped link, `<a href="…" rel="noopener noreferrer nofollow" target="_blank">alt or URL</a>`. The visitor sees the URL, and nothing is fetched. `FORBID_TAGS` also catches raw `<img>` HTML, which marked passes through. (2) The CSP (`index.html:7`) narrows `img-src 'self' data: https:` to `img-src 'self' data:`. Checked: the SPA loads no cross-origin image. The `https://rjasti.com/…` image URLs in `index.html` are Open Graph and JSON-LD metadata, which the page never fetches. | `frontend/js/chat.js`, `frontend/index.html` | A chat render test: `![x](https://evil.example/p.png)` produces no `<img>` and a link whose `href` is that URL. Raw `<img src="https://evil.example/p.png">` is stripped. `build.test.js`: the `img-src` in `dist/index.html` contains no `https:`. `check_csp_hashes.py` passes, because the meta edit changes no script body |
| **S16** | (1) `.htaccess:101-107`: every security header uses `Header always set`, `X-XSS-Protection` becomes `"0"`, and a new `Permissions-Policy "camera=(), geolocation=(), microphone=(self)"` is added. Voice input in `chat.js:103-115` needs the microphone. (2) `build.mjs` (the `index.html` branch at `:483`) removes `http://localhost:8000` and `http://127.0.0.1:8000` from `connect-src` in `dist/index.html` only. The source keeps them, because local development serves `frontend/`. `staging-api` stays (intent assumption 8). **No hash re-pin**, despite the report: a CSP hash covers an inline script's body, not the meta tag. | `frontend/.htaccess`, `scripts/build.mjs` | `build.test.js`: `connect-src` in `dist/index.html` contains no `localhost` or `127.0.0.1` and still contains `'self'` and `https://formsubmit.co`, and the source still contains both loopback origins. `.htaccess` is checked by reading it, because nothing in CI serves Apache |

### DOM sanitization

S15 narrows the one markdown sink. S9 removes rows and adds no sink. The S14
token flows into `verifyMagicLink` / `verifyEmail` / the reset form as data,
never into markup.

### Styling

No CSS change.

---

## 5. Security & Rate Limiting Review

Run the `docs/SECURITY.md` pre-merge checklist on phases A, B, C and E. Each
touches auth, rate limits, the CSP, or model output.

- [x] **Rate limits**: S12 adds three paths to the strict auth budget. S3 keys
      every budget on a /64 for IPv6. No budget value changes.
- [x] **No secrets logged or returned**: S2 stops returning AWS error text and
      logs it with a request id instead. S8's purge logs ids, never emails.
      S14 keeps tokens out of access logs, analytics and Cache Storage.
- [x] **Enumeration**: login (§2 table) and register answer the same whether
      or not the account exists, at the same bcrypt cost, with no
      `Server-Timing` on `/auth/*`. The 2FA and re-auth routes still say
      "locked", because their caller has already proven the account exists.
- [x] **Guessing bounds**: at most `LOCKOUT_THRESHOLD` checks per 15-minute
      window per tally, however many requests run in parallel (S3). TOTP codes
      are single-use per step (S11). The re-auth routes are on the lock and the
      budget (S12).
- [x] **Lockout DoS (S4)**: an attacker can still keep *password* sign-in
      locked. The owner's way in is the mailed link, which the password tally
      cannot block. This is recorded as a residual in "Known limitations".
- [x] **Cost ceiling (S1, S13)**: the model is the server's choice alone. The
      anonymous control-plane call is gone.
- [x] **CSP hashes**: Phase E edits one pinned inline script, and the gate
      will fail until it is re-pinned. No other phase touches an inline
      script.

---

## 6. Verification & Test Plan

Run each gate **once, after the last edit of that phase**. If one fails, fix
it and re-run that gate alone (`AGENTS.md` §6).

```bash
# Phases B, C, D, E (frontend + build)
npm run lint
npm test                      # also builds dist/ and runs scripts/tests/build.test.js

# Every phase (backend)
ruff check server tests
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55

# Phase D only
npm audit --omit=dev --audit-level=high
server/.venv/bin/pip-audit -r server/requirements.txt --require-hashes --disable-pip --no-deps
python3 -c 'import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]' .github/workflows/*.yml

# Every phase
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens
```

**Docs changed with the code**, in the same PR as the change they describe:

| Phase | Doc | Change |
| :--- | :--- | :--- |
| A | `docs/API.md:617-680` (`/chat`) | `model_id` removed from the request example (`:628`). The error list drops "400 unsupported model" (`:663`). The error frame text is fixed and carries `request_id` |
| A | `docs/API.md:168`, `:819`, `:826`, `:848` | The `/models` section is removed. "unsupported model" is dropped from the 400 row, and the `/models` example from the 500 row |
| A | `docs/CONFIGURATION.md:121`, `:129`, `:282` | `ALLOWED_MODEL_IDS` and the `bedrock:ListFoundationModels` IAM row are removed |
| A | `docs/BACKEND.md:114-118`, `:124` | Allowlist and `bedrock_mgmt` removed |
| A | `docs/SECURITY.md` "Rate limiting and cost controls" | `model_id` is ignored, next to the existing `system_prompt` paragraph |
| B | `docs/SECURITY.md` "Account lockout" (`:132-158`) | Two tallies. Reserve-before-verify. The "sharing is deliberate" paragraph is rewritten with the reason it changed |
| B | `docs/SECURITY.md` "Account enumeration resistance" (`:200-215`) | Register row added. The login row says two verifications, and that a lock looks like a wrong password. `Server-Timing` is off `/auth/*` |
| B | `docs/SECURITY.md` "Rate limiting" (`:259-262`), "Known limitations" (`:447`) | Re-auth routes added to the auth row. General budget **1000**/min, not 60 (drift). Lockout DoS residual added |
| B | `docs/SECURITY.md` "Two-factor authentication" (`:163`) | Codes are single-use per step |
| B | `docs/API.md:209-226`, `:227-259` (`:254`), `:366`, `:379` | Register 202 + `RegisterResponse`. Login lock is the generic 401. Re-auth routes can answer 400 locked |
| B | `docs/DATABASE.md` `users` table, migration list | The three columns and `l5a6b7c8d9e0` |
| B | `docs/OPERATIONS.md:318-370` | The unlock script clears both tallies |
| C | `docs/DATABASE.md:313-329` | A purge job exists: soft-deleted users are removed 30 days after deletion, with their dependents |
| C | `docs/API.md:379` | Delete-account: purged after 30 days |
| C | `docs/JAVASCRIPT.md` (`auth.js`, `chat.js` sections) | `getTokenSubject`. Sign-out drops account-owned rows |
| D | `AGENTS.md:8`, `docs/OPERATIONS.md:98` | Node 22 |
| D | `docs/OPERATIONS.md` (deploy job) | The deploy downloads `dist/` from `frontend-check` and runs no package code |
| D | `docs/SECURITY.md` "Supply chain" (`:391`), "Secrets handling" (`:371`) | Blocking audits. SHA-pinned actions. Secrets only via `env:`. `.env.example` ships an empty key |
| D | `docs/CONFIGURATION.md` (`JWT_SECRET`) | Placeholder and distinct-character rules |
| D | `frontend/vendor/README.md` | The copies are now checked against `node_modules` by a test |
| E | `docs/FRONTEND.md:135-195` (CSP, the three pinned scripts), `:392` (`sw.js`), `:888` (Apache) | `img-src`. The loopback strip at build. The token hand-off. The navigation cache key. The new headers |
| E | `docs/ADR.md` ADR-008 "Consequences" (`:196-198`) | The loopback origins exist only in the source CSP, and the build strips them |
| E | `docs/SECURITY.md` checklist (`:464`) | New item: *"Emailing a link? Put the token in the fragment."* |

`check_docs.py --fix` repairs the per-module counts in `docs/JAVASCRIPT.md` and
`docs/TESTING.md` that the new tests move.

**Report update.** `docs/review/codebase_review_20260924.md` is edited only
after a phase's gates pass. Each S-finding is marked with its real outcome.
Where the fix differs from the report's suggestion (S3, S4, S9, S10, S14, S16,
S17), it says so.

**Owner actions outside the repo** (listed in each PR description, not done by
the agent):

- Before Phase D deploys: confirm that the production `JWT_SECRET` is not the
  old `.env.example` placeholder. If it is, rotate it, which signs everyone
  out once.
- After Phase A: remove `bedrock:ListFoundationModels` from the instance role.

### Sequencing with the report's other sections

| Later finding | Overlap | Rule |
| :--- | :--- | :--- |
| PF1 (bcrypt on the event loop) | S5 adds a second dummy verification on three login paths. S18 swaps the library under the same functions | PF1 lands right after Phase B. It wraps `security.py`'s public functions in `asyncio.to_thread`, which works the same whichever library is underneath |
| PF2 (drop the GIN index) | A second migration from the same head, `k4f5a6b7c8d9` | Whichever merges second re-points its `down_revision`. CI's single-head assertion catches a miss |
| CS2 (`REVIEW.md`'s ADR-023 check) | S1 deletes the field that check should look for | CS2 goes after Phase A and asserts that `ChatStreamRequest` has no model field |
| C5 stopgap (§1) | The §1 spec said S9 would remove it | It **stays** (intent assumption 10) |

### Unverified going in

- **S1**: the production `DEFAULT_MODEL_ID`. If it is already Sonnet-class,
  the cost exposure was smaller than the report estimates. The fix is the same
  either way. Also unverified: that the tests which name the gemma model rely
  on the converse path, which the test default `dummy-model-id` also takes.
- **S3**: `UPDATE … RETURNING` needs SQLite 3.35 or later on CI's Python 3.10
  leg. If it is older, the fallback is `UPDATE` then `SELECT` in the same
  transaction. On PostgreSQL the row lock taken by the `UPDATE` makes that
  exact too.
- **S8**: SQLite enforces `ON DELETE CASCADE` only with
  `PRAGMA foreign_keys=ON`, so the test sets it. PostgreSQL always enforces
  it.
- **S15**: that no SPA image uses `blob:`. Grep for `createObjectURL` feeding
  an `<img>` before narrowing `img-src`, and add `blob:` if one does.
- **S16**: that no page served under this `.htaccess` needs the camera or
  geolocation. Grep `getUserMedia` and `geolocation` across `frontend/*.html`
  and `frontend/js/` first.
- **S17**: that `upload-artifact` and `download-artifact` need no permission
  beyond `contents: read` within one run. Confirm on the first deploy after
  Phase D.
- **S5 / S18**: how many rows still use the legacy raw-password hash. A hash
  alone cannot tell the two schemes apart, so the legacy branch, and the
  second verification it forces, stay.
