# Security Reference

The controls actually implemented in this repository, where they live, and what
each one is defending against.

- [Threat model](#threat-model)
- [Account authentication](#account-authentication)
- [Password handling](#password-handling)
- [Account lockout](#account-lockout)
- [Two-factor authentication](#two-factor-authentication)
- [Account enumeration resistance](#account-enumeration-resistance)
- [Anonymous session capability tokens](#anonymous-session-capability-tokens)
- [Rate limiting and cost controls](#rate-limiting-and-cost-controls)
- [Input validation](#input-validation)
- [Output encoding and XSS](#output-encoding-and-xss)
- [Content Security Policy](#content-security-policy)
- [Transport and headers](#transport-and-headers)
- [Secrets handling](#secrets-handling)
- [Supply chain](#supply-chain)
- [Logging and privacy](#logging-and-privacy)
- [Known limitations](#known-limitations)
- [Checklist for changes](#checklist-for-changes)

---

## Threat model

This is a personal portfolio with a public API. The assets worth protecting, in
order:

1. **The AWS bill.** `/chat` spends money per call and takes no authentication.
2. **Visitor behavioural data.** An analytics session records paths, clicks,
   device metadata and IP.
3. **User accounts.** Small in number, but they hold email addresses, password
   hashes and saved conversations.
4. **Site integrity.** A compromised script or a stored injection reaches every
   visitor.

The realistic adversaries are automated: credential stuffers, scrapers, and
anyone who notices an unauthenticated LLM endpoint.

---

## Account authentication

JWT bearer tokens, HS256, signed with `JWT_SECRET`
(`server/auth/security.py`).

| Token | Lifetime | Revocable | Single-use |
| :--- | :--- | :--- | :--- |
| Access | 30 min | no (short-lived by design) | no |
| Refresh | 30 days | yes — `refresh_tokens.is_revoked` | effectively: rotation revokes on use |
| 2FA pre-auth | 5 min | yes — `one_time_tokens` | **yes** |
| Password reset | 15 min | yes — `one_time_tokens` | **yes** |
| Magic link | 10 min | yes — `one_time_tokens` | **yes** |

**Rotation.** `/auth/refresh` revokes the presented `jti` and issues a new one.
A reused, revoked or expired token is rejected. Clients must serialise
concurrent refreshes; `js/auth.js` does so with a single-flight guard inside a
tab and a Web Lock across tabs. Tabs share the stored pair, so without the lock
two tabs spent the same token, and the loser's sign-out deleted the pair the
winner had just stored.

**Purpose binding.** Every single-use token carries a `jti` recorded in
`one_time_tokens` with a `purpose`. `consume_one_time_token` checks the purpose,
so a token minted for a password reset cannot be redeemed as a magic link. It
also sets `used_at` (a timestamp, not a boolean) so the audit trail keeps *when*.

Before `one_time_tokens` existed these rows lived in `refresh_tokens`, which
conflated three unrelated things: nothing recorded what a row was for, and
`revoke_user_tokens` swept pending password resets away as if they were
sessions.

**Type binding.** `verify_token(token, expected_type)` enforces the `type` claim,
so a refresh token cannot be presented as an access token.

**A redeemed link confirms the address.** Redeeming a magic link or a
password-reset link is the same proof of inbox control that clicking the
verification link is, delivered the same way, so both now record it through
`confirm_address_if_unverified`. Neither did, and an account that registered but
never clicked the confirmation link was left in a dead end it could not
diagnose: the magic link signed them in while `authenticate_user` kept answering
403 to their password, and a password reset reported success and still left them
unable to log in — which reads as the new password not having taken. It is
recorded before the 2FA branch on the magic-link path: whether a second factor
is still owed does not change what the redemption has already proven.

**Blast radius of a revocation.** `revoke_user_tokens` revokes all refresh
tokens **and** voids unused one-time tokens — a pending reset link is a
credential too. It runs on password change, password reset and account deletion.

**Logout ends one device, authenticated by its refresh token.** `POST
/auth/logout` revokes the single `refresh_tokens` row named by the refresh token
in the body, scoped to that token's own `sub`, and leaves other devices and
pending links alone. This is a deliberate exception to the rule that a write to
a user's own data takes `get_current_user`: the credential being ended is the
proof, as it is on `/auth/refresh`. Requiring a live access token meant a
visitor whose token had expired got a 401, nothing was revoked, and the 30-day
refresh token outlived the sign-out. The signature and `type` are verified;
expiry is not, because revoking a dead token is harmless. A bearer without a
body still works (its `sid` names the session), and the response is identical
whether or not a row matched.

---

## Password handling

**bcrypt over a SHA-256 hex digest** (`get_password_hash`). The pre-hash
sidesteps bcrypt's 72-byte truncation, under which two long passwords sharing a
72-byte prefix are the same password.

`verify_password_scheme` returns `(matched, needs_rehash)`, so a legacy row
(bcrypt over the raw password) is transparently upgraded on the one occasion the
plaintext is available — a successful login. Without that flag the fallback
branch would be load-bearing forever and no row would ever migrate.

**Breach checking** — `hibp_service.check_password_breached` uses the Have I Been
Pwned range API with k-anonymity: only the first 5 characters of the SHA-1 hash
leave the process. 5-second timeout, and it **fails open** so an HIBP outage
does not block password changes. Applied on `/auth/change-password` and
`/auth/reset-password`; **not** on `/auth/register`.

**Reuse prevention** — a new password is checked against the current hash plus
the last `PASSWORD_HISTORY_LIMIT` (5) archived hashes, which are pruned after
each change.

**Minimum length** — 8 characters, enforced by the Pydantic schema. There is no
complexity rule; `auth-ui.js` shows a strength meter and checklist as guidance.

---

## Account lockout

Two tallies, each `LOCKOUT_THRESHOLD` (5) attempts before it locks for
`LOCKOUT_DURATION` (15 minutes):

| Tally | Columns | Counts a wrong… | Cleared by |
| :--- | :--- | :--- | :--- |
| **Password** | `failed_login_attempts`, `locked_until` | password at login, and on every route that re-checks one: change-password, delete-account, 2FA enable, 2FA disable | any correct password; a password reset; a completed 2FA sign-in |
| **Code** | `totp_failed_attempts`, `totp_locked_until` | TOTP code at `/2fa/verify`, 2FA enable and 2FA disable, including a replayed code | a correct, unreplayed code |

**Reserve before verify.** `reserve_attempt` numbers the attempt with an atomic
`UPDATE … RETURNING` and commits it *before* the credential is checked, and
refuses without checking once the number passes the threshold. The count used
to be taken after a wrong answer, as a read-modify-write on the row the request
loaded first: parallel guesses all read the same count, so N of them recorded
about one, and all N had passed the lock check before any was recorded, so
every one was checked. Guarded by `test_parallel_guesses_are_not_all_checked`.

**Why two tallies.** One tally used to hold both, which was itself the fix for a
real bug: the second factor was once outside the lockout entirely, so a
six-digit secret could be walked through at will. Separate tallies keep that
fix and close two holes the sharing opened:

- `verify_2fa_login` could not tell a lock from password guesses from one from
  code guesses, so five wrong passwords from anywhere locked the owner out of
  the magic-link route too. It now checks only the code tally: a pre-auth token
  already proves the password or the inbox.
- A password reset cleared the shared tally, so anyone holding the inbox could
  reset, sign in, try five codes and reset again. The reset clears the password
  tally only.

A correct password clears the password tally even when a code is still owed.
The old rule kept the tally until the code checked out, because clearing it let
an attacker who knew the password reset the code count by logging in again.
The code count is separate now, and a correct password does not touch it.

**An expired lock returns a full set of attempts.** A lapsed `until` resets its
tally, which is the half that used to be missing: the count only ever reset on a
*successful* sign-in, so someone who had been locked out came back fifteen
minutes later still carrying five, and one more mistyped password locked them
out again. The reset is keyed on the `until` the request saw, so when several
arrive together only one resets and the rest count on from it.

**A lock is invisible at login.** `/auth/login` answers a locked account with
the same 401 and body as a wrong password or an unknown address (see below).
The routes behind a bearer or pre-auth token still say "locked", because their
caller has already proven the account exists.

The cost is bounded and deliberate: a guessing attacker gets 5 attempts per
15-minute window per tally, however many requests run in parallel, under an
auth rate budget of 5 requests a minute per client.

---

## Two-factor authentication

TOTP via `pyotp`, enrolled with a QR code returned as a base64 data URI.

- `/auth/2fa/setup` **refuses** when 2FA is already enabled. Re-enrolling would
  overwrite the secret the authenticator already holds without clearing
  `is_totp_enabled`, locking the account behind a factor nobody can produce —
  and would let anyone holding a stolen access token swap the second factor for
  one of their own.
- `/auth/2fa/enable` and `/auth/2fa/disable` both require the current password
  **and** a valid code. Re-authentication is the point: an access token is not a
  password, so without it a stolen token could bind an attacker's authenticator
  to an account that had no second factor — locking the owner out rather than
  merely reading their data.
- Both run the same order — **password (on the password tally) → state → code
  (on the code tally) → mutate → revoke → notify**. A wrong password or a wrong
  code counts toward its tally; a *state* error ("2FA is not enabled") does not,
  because it refuses every caller equally and counting it would let a prober
  lock arbitrary accounts.
- A code is **single-use within its 30-second step** (RFC 6238 §5.2).
  `consume_totp` claims the step with a conditional `UPDATE` on
  `users.totp_last_step`, so a code seen over a shoulder or relayed by a
  phishing proxy cannot be used again, and two requests presenting the same
  code cannot both win. A replay counts as a wrong code.
- Turning the second factor on or off revokes every **other** session
  (`revoke_all_other_sessions`, so the caller keeps the session they are working
  in) and emails the account owner, matching what a password change already did.
- The pre-auth token issued between password and code is single-use, and is
  burned **before** the code is checked. Without that, capturing one bought
  unlimited attempts at a six-digit code for its full five-minute life. The
  consequence is that every failed challenge is terminal — the client starts the
  sign-in again rather than retrying on a spent token.
- `/auth/2fa/verify`, `/auth/2fa/enable` and `/auth/2fa/disable` are on the
  strict 5/min auth rate budget, alongside `/auth/magic-link/request`.
  `/auth/2fa/setup` is deliberately **not**: it guesses nothing, and the budget
  is shared across every path on it, so putting setup there would spend the
  allowance the enable step needs seconds later.
- Every TOTP code field is bounded to exactly six digits at the schema, so a
  malformed code is refused before it reaches `pyotp`.

---

## Account enumeration resistance

| Surface | Defence |
| :--- | :--- |
| `/auth/login` | One 401 and one body (`LOGIN_FAILED_DETAIL`) for an unknown address, a wrong password, a soft-deleted account past its window **and a locked account**, and **two** bcrypt verifications on every one of those paths - which is what a wrong password costs (the prehash check, then the legacy one). The locked and purged paths used to burn none and the unknown path one, so response time told them apart |
| `/auth/register` | One 202 and one body whether or not the address has an account, at the cost of one bcrypt hash either way. An existing address is mailed a "you already have an account" note instead of a link. "Email already registered" was a direct oracle |
| `/auth/forgot-password` | One generic 200 for every outcome: unknown address, inactive user, success |
| `/auth/magic-link/request` | Same generic 200 contract |
| Email delivery failures | Logged, never surfaced — "your mail server is down" through that channel would also leak which addresses are real |
| `Server-Timing` | Left off `/auth/*`. It is exposed cross-origin, and a millisecond-accurate handler time with the network jitter taken out is exactly what a timing attack wants |
| Session-scoped endpoints | 403 with an identical body whether or not the session exists |
| `/chat/history/{id}` | Ownership is part of the `WHERE` clause, so another user's conversation is indistinguishable from a missing one |

Guarded by `test_forgot_password_does_not_reveal_whether_an_account_exists`,
`test_magic_link_does_not_reveal_whether_an_account_exists`,
`test_registration_answers_the_same_whether_or_not_the_address_has_an_account`,
`test_every_login_refusal_costs_the_same_two_verifications` and
`test_an_unknown_session_is_indistinguishable_from_a_forbidden_one`.

---

## Anonymous session capability tokens

`server/auth/session_token.py`.

Activity endpoints identified a visitor only by the `session_id` in the URL and
checked nothing else. Anyone holding or guessing an id could read that visitor's
full behavioural trail and device metadata, or write events attributed to them —
and `POST /events` answered 404 for an unknown session and 201 for a real one,
which turns the id space into something you can probe.

Requiring a login is not an option: these sessions exist precisely so an
anonymous visitor can be tracked. So the session is handed a capability token at
creation and must present it afterwards:

```
token = hmac_sha256(JWT_SECRET, "analytics-session:" + session_id)
```

- **Domain separator** — the `analytics-session:` prefix means a value signed
  here can never be mistaken for one signed elsewhere under the same key.
- **Stateless** — an HMAC over the id needs no storage and cannot be derived
  from the id alone.
- **Constant-time comparison** — `hmac.compare_digest`; a plain `==` leaks the
  shared prefix length through timing.
- **Transport** — `X-Session-Token` header (preferred), an `HttpOnly;
  SameSite=Strict` cookie (automatic, and the only option for `EventSource`), or
  a deprecated `?session_token=` query parameter kept only for clients cached
  from before the cookie existed. The query form put a bearer credential into
  the web server's access log, browser history and any `Referer` the page
  emitted.
- **`HttpOnly`** keeps the cookie out of reach of any script on the page,
  including a compromised third-party bundle.
- **Batch integrity** — `create_events_bulk` asserts access for **every** row.
  One batch, one session: this stays a hard failure for the whole request,
  because it is an authorisation boundary rather than a vocabulary mismatch.

Rotating `JWT_SECRET` invalidates every live session token as well as every JWT.

---

## Rate limiting and cost controls

| Control | Value | Guards |
| :--- | :--- | :--- |
| Auth rate budget | 5/min per client | Credential stuffing on login, register, reset, 2FA verify, magic link, and the re-authentication routes (change-password, delete-account, 2FA enable/disable) |
| Chat rate budget | `CHAT_RATE_LIMIT_PER_MINUTE` (12/min) | The only endpoint that spends money per call and takes no authentication |
| General budget | `RATE_LIMIT_PER_MINUTE` (1000/min) per client | Everything else |
| Free-message cap | `CHAT_FREE_MESSAGE_LIMIT` (6) | Unlimited anonymous inference. The browser enforced this first; the server now does too, because calling the API directly bypassed it entirely |
| Bedrock concurrency | `CHAT_MAX_CONCURRENCY` (4) | Unbounded parallel inference. `/chat/summarize` takes a slot too — it once took none and could drive concurrency straight past the cap |
| SSE stream cap | `MAX_STREAMS_PER_SESSION` (2) | Worker-slot exhaustion. A session token costs one unauthenticated POST |
| Body size | `MAX_BODY_BYTES` (1 MiB) | Memory exhaustion and oversized payloads |
| Conversation size | 60 messages / 8,000 chars each / 24,000 total | Token-cost inflation |

`_normalise_path` strips the optional `/api` mount prefix **before** matching, so
the strict budgets cannot be sidestepped by adding four characters to the URL.
Guarded by `test_auth_routes_are_strict_limited_under_both_mount_prefixes`.

"Per client" means per IPv4 address, or per **/64** for IPv6 (`_rate_bucket`).
Keyed on the full address, one ordinary IPv6 allocation handed an attacker 2^64
separate 5/min auth budgets. An IPv4-mapped address counts as its IPv4.

`system_prompt` is not accepted from callers. It was once passed straight to
Bedrock, unauthenticated and unbounded, which both turned the site's AWS account
into a free general-purpose LLM and allowed up to `MAX_BODY_BYTES` of input
tokens per request — `CHAT_FREE_MESSAGE_LIMIT` counts *messages*, so one short
message carrying a megabyte of system prompt passed every check.

`model_id` is ignored for the same reason. The allowlist always carried a
Sonnet-class id whatever the environment said, so an anonymous caller could
upgrade every request to several times the default's price. Every turn runs on
`DEFAULT_MODEL_ID`, and there is no allowlist left to configure. A Bedrock
failure reaches the client as fixed text plus a request id; the raw message,
which carries the account id and role ARN, is only logged.

---

## Input validation

- **Pydantic v2 everywhere.** Types, lengths, literals and enum-style unions on
  every request body.
- **`role` is `Literal["user","assistant"]`.** It was a bare `str`, so any value
  round-tripped into the Bedrock payload.
- **`event_data` ≤ 4096 bytes serialised**, `page_path` ≤ 256 characters,
  enforced by a validator shared between the single and bulk schemas so the cap
  cannot drift.
- **UUID path parameters** are parsed by FastAPI; a malformed id is a 422 before
  any handler runs.
- **SQL** is entirely SQLAlchemy ORM/Core with bound parameters. There is no
  string-built SQL in the codebase.
- **Client IP** is resolved server-side and never accepted from a body.
  `X-Forwarded-For` is honoured only when the direct peer is in
  `TRUSTED_PROXY_IPS`, and the walk takes the rightmost non-proxy address.
  That setting defaults to loopback, so a directly-reachable API ignores the
  header entirely and a remote caller cannot choose its own rate-limit bucket
  or forge the `ip_address` recorded on a session. It was empty, which was not
  a spoofing risk but collapsed every rate-limit bucket into one for the whole
  site, since every proxied request resolved to the proxy's own address.

---

## Output encoding and XSS

- **`escapeHTML()`** escapes all five significant characters, including **both**
  quote forms, by regex rather than a `textContent → innerHTML` round-trip. The
  round-trip left `"` untouched, and six call sites interpolate into
  double-quoted attributes — where a quote closes the attribute early and
  anything after it parses as further attributes, `onmouseover` included. One of
  those sites is fed by `page_path`, which is visitor-controlled **and
  persisted**, so it was a stored injection.
- **Terminal output is structural.** Every builder in `js/terminal/output.js`
  writes through `textContent`, so a command handler cannot inject markup even
  if it forgets to sanitise.
- **Markdown is sanitised.** `renderBotHTML()` is
  `DOMPurify.sanitize(marked.parse(text))`, degrading to escaped plain text with
  `<br>` if either global is missing.
- **Code copy buttons** carry their payload URI-encoded in a `data-code`
  attribute and decode it in JavaScript, so no code content is ever interpolated
  as markup.

---

## Content Security Policy

Two policies apply.

**Page-level** (`<meta>` in `index.html`) — see
[`FRONTEND.md`](FRONTEND.md#content-security-policy) for the full text.
Highlights: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
`form-action https://formsubmit.co`, `script-src 'self'` plus three `sha256-`
pinned inline scripts, `font-src 'self'`.

**Server-level** (`.htaccess`) — `Content-Security-Policy: frame-ancestors
'self'`, which a `<meta>` CSP cannot express.

The pinned inline hashes are enforced in CI by `scripts/check_csp_hashes.py`,
which fails both on a script with no matching hash and on a declared hash that
matches no script. `frontend/index.html` is in `.prettierignore` so `npm run
format` cannot silently break them.

---

## Transport and headers

From `frontend/.htaccess`:

| Header | Value |
| :--- | :--- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `frame-ancestors 'self'` |

From the API: `X-Request-ID` and `Server-Timing` on every response, both
explicitly CORS-exposed. CORS allows credentials, so the origin list is the
control that matters — it is never `*`.

The session cookie is `Secure` only over HTTPS, so plain-HTTP local development
still works while production always gets it.

> HSTS is not set in `.htaccess`. If TLS termination is entirely under your
> control, adding `Strict-Transport-Security` is a cheap win.

---

## Secrets handling

- **No secret has a fallback.** `JWT_SECRET` is required, must be ≥ 32
  characters, and is rejected if it equals the placeholder that shipped in this
  repository — which is public in the git history, so any token signed with it
  must be treated as forgeable.
- **`.env` is gitignored** and the deploy's rsync **excludes `.env*`**, so a
  deploy can never overwrite host configuration or publish a local file.
- **AWS credentials** come from the instance profile in production; none are in
  the repository.
- **Reset and magic-link tokens are never logged in full** — only a 12-character
  SHA-256 prefix, enough to correlate log lines without putting a working
  account-takeover credential into the log stream.
- **JWT parse errors are raised `from None`**, so parser internals never reach
  an unauthenticated caller. The cause is logged instead.
- **CI's `JWT_SECRET`** is an explicit test-only value; production reads its own
  from the service environment.

---

## Supply chain

- **Hash-pinned Python locks.** `server/requirements*.txt` are `uv pip compile
  --generate-hashes` output installed with `--require-hashes` by both CI and the
  deploy, so an unpinned or substituted artifact is a hard failure rather than a
  silent upgrade. `test_dependency_locks.py` asserts every direct dependency is
  pinned and every pin carries a hash.
- **`npm ci`** in CI and the deploy, from the committed `package-lock.json`.
- **`npm run audit`** runs in CI at `--audit-level=high`, non-blocking
  (`continue-on-error`) because the current findings are transitive dev-tooling
  advisories via stylelint and jsdom — visible rather than silently unrun.
- **Vendored libraries** are copied verbatim from pinned npm packages, not
  fetched from a CDN. With them local, `script-src` is `'self'` alone and there
  is no third-party origin that could be compromised or blocked.
- **Fonts are self-hosted and subset** for the same reason.
- **`ruff`** lints the backend with the defect-finding rule families
  (`F`, `E`, `W`, `B`, `ASYNC`, `C4`). `F821` alone would have caught five auth
  routes that shipped calling service functions that do not exist.

---

## Logging and privacy

Structured JSON via structlog, with `request_id` on every line.

| Practice | Where |
| :--- | :--- |
| IP addresses truncated in log lines | `session_controller.create_session` |
| Tokens logged only as a 12-char digest | `notification_service._token_fingerprint` |
| Client error reports carry `pathname + hash`, never the query string | `error-handler.reportClientError` — the query string can carry a reset or magic-link token, and this payload is persisted |
| Client error reports capped and deduplicated | 10 per page load, deduplicated by `name:message` |
| API responses never cached by the service worker | `sw.js` skips `/api/` |
| Bedrock invocation logs get the analytics session id only — never its token, a user id or an IP | `bedrock_service.stream_chat_response` (`requestMetadata`) |
| Analytics click tracking records shape, not content | tag name, whether an id exists, link origin — not text or href |

The `robots.txt` disallows `/api/`.

---

## Owner analytics

`/admin/analytics/*` is the only surface that reads across every visitor's
session, so it takes `require_owner`: `get_current_user`, then an equality
check against the `OWNER_EMAIL` setting. `users` carries no role column and
this site has one real account, so the owner is named by configuration rather
than by a schema change made in service of a constant.

It **fails closed**. An unset `OWNER_EMAIL` denies everyone, including the
owner: a deploy that silently published every visitor's browsing to any
registered account is a worse failure than one that locks the dashboard.

The window is capped at 365 days. These are unindexed aggregates over a
growing table, and an unbounded range is the query that eventually times out.

---

## Known limitations

| Limitation | Impact | Path forward |
| :--- | :--- | :--- |
| In-memory rate limiting | Budgets are per process; N instances means N× the limit | Redis-backed limiter (ADR-012) |
| `POST /sessions` is unauthenticated | Session tokens are free to mint; each costs a row | Acceptable — the stream cap and chat budgets bound what a token is worth |
| No CAPTCHA anywhere | Automated registration is possible within the 5/min budget | Add one if abuse appears |
| No CSRF tokens | Mitigated: the API is JSON + bearer token, and the one cookie is `SameSite=Strict` | Revisit if cookie-authenticated state-changing routes are added |
| No HSTS header | A first plain-HTTP request is possible | Add `Strict-Transport-Security` to `.htaccess` |
| No account-level audit log | Security events are in application logs only | Add a table if accounts grow beyond personal use |
| Anyone can keep *password* sign-in locked | Five wrong passwords a quarter-hour, from anywhere, keep the password tally locked | Accepted: the lock is invisible at login, and the emailed sign-in link - with the code tally for a 2FA account - still gets the owner in |
| No 2FA recovery codes | A lost authenticator is unrecoverable *by the user*: disable needs a live code, password reset does not clear `is_totp_enabled`, and the magic-link path re-challenges. An operator with database access can clear the factor with `scripts/clear_2fa.py` (`docs/OPERATIONS.md`, "Clear a lost second factor") — which is a remedy, not a fix: it needs the host | Hashed single-use backup codes issued at enrolment, accepted at `/2fa/verify` and `/2fa/disable` — needs a migration (`docs/review/2fa.md`, finding 9) |
| `totp_secret` stored in plaintext | A database read discloses every enrolled account's second factor | Encrypt at rest under a new required secret, with a migration to re-wrap existing rows (`docs/review/2fa.md`, finding 10) |
| HIBP fails open | An HIBP outage lets a breached password through | Deliberate; failing closed would block all password changes |
| Deploy host key is TOFU without `EC2_HOST_KEY` | A first-run MITM on the deploy channel | Set the `EC2_HOST_KEY` secret |

---

## Checklist for changes

Before merging anything that touches these areas:

- [ ] **New endpoint?** Does it need `get_current_user` or
      `require_session_access`? Which rate budget does it land on — and is that
      the one you want?
- [ ] **New endpoint the frontend calls?** Add it to
      `test_frontend_api_contract.py`.
- [ ] **New request field?** Is it length-bounded? Could a caller make it
      expensive?
- [ ] **New event type?** Add it to `EventTypeName` in `schemas/event.py`, or the
      batch carrying it loses that event.
- [ ] **Rendering user-controlled text?** Build DOM nodes, or `escapeHTML()`
      first.
- [ ] **Touched `index.html`?** Run `npm run check:csp`.
- [ ] **New third-party origin?** It needs a CSP `connect-src`/`script-src`
      entry — and a reason it cannot be vendored.
- [ ] **New secret?** Required with no fallback, documented in
      `CONFIGURATION.md` and `.env.example`, never logged.
- [ ] **New dependency?** Edit the `.in` file and regenerate **both** locks with
      `uv pip compile --universal --generate-hashes`.
- [ ] **Model or schema change?** Ship the Alembic migration; `alembic check`
      gates the deploy.
- [ ] Run `ruff check server tests`, `PYTHONPATH=. pytest`, `npm run lint`,
      `npm test`.
