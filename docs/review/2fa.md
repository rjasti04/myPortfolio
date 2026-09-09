# Two-Factor Authentication Review

> **Status: eight of ten fixed.** Landed on `claude/2fa-review-bugs-o23lyp`.
> This document is the record of *why* each change was made — the line numbers
> in each entry point at the code **as it was**, before the fix. The reference
> docs describe the code as it is now.
>
> Two findings are deliberately left open, both marked *(open)* below: there
> are no recovery codes (finding 9) and `totp_secret` is stored in plaintext
> (finding 10). Each needs a schema migration, and the second needs a new
> required secret and a data migration, which put both outside this change
> rather than out of mind. Finding 9 now has a row in `SECURITY.md`
> "Known limitations" so it is on the record rather than in a review file
> nobody re-reads.
>
> One thing worth recording, because it changed what shipped: **the backend was
> not the problem the report described.** `POST /auth/2fa/disable` and
> `disable_2fa()` had existed since 2FA shipped and were correct. So had
> `disable2FA()` in `js/auth.js`. Nothing imported it. The feature was complete
> everywhere except the one layer a user can reach — which is also why
> `docs/API.md` documented an endpoint the site had never once called.

Read-only pass over the 2FA surface — enrolment, the login challenge, the
account controls and the storage behind them — prompted by two reports from the
site's owner: there is no way to turn 2FA off, and after enrolment the QR code
and secret key stop being displayed. Both reproduce, and both turn out to be the
same defect seen from two angles (findings 1 and 2).

**No P0.** Nothing here loses data or takes the site down. The login path
itself is in good shape: the pre-auth token is single-use and burned before the
code is checked, failed codes feed the shared lockout tally, and
`/auth/2fa/verify` sits on the strict 5/min budget. What follows is everything
around it.

## Scope

| Read | Not read |
| :--- | :--- |
| `services/auth_service.py` (2FA, lockout, session and one-time-token helpers), `routes/auth_routes.py`, `schemas/auth.py`, `auth/security.py`, `auth/dependencies.py`, `models/user.py`, `middlewares/rate_limit.py`, `services/notification_service.py` | The chat, analytics and Kafka surfaces |
| `js/auth.js`, the 2FA regions of `js/auth-ui.js`, the auth modal in `index.html`, `auth-modal.css` | `three-bg.js`, `js/arcade/*`, the standalone predictors |
| `tests/backend/integration/test_auth.py`, `tests/backend/unit/test_security_wiring.py`, `frontend/tests/*` | — |

Reachability was checked against the test suites and `docs/API.md`. Every entry
names an input and the wrong result it produces.

---

## P1

### 1. Disable 2FA is built at every layer except the one a user can reach

**`frontend/js/auth-ui.js:1`**

The import list reads `deleteAccount, setup2FA, enable2FA, verify2FA,
requestMagicLink` — no `disable2FA`. It is defined at `frontend/js/auth.js:88`,
exported, and called by nothing in the repository. `index.html` has an
`auth-tab-2fa-verify` panel and an `auth-tab-2fa-setup` panel and no third one.

The backend half is complete and correct: `POST /auth/2fa/disable`
(`server/routes/auth_routes.py:69`) → `disable_2fa()`
(`server/services/auth_service.py:889`), which requires the current password
**and** a live TOTP code before clearing `totp_secret`. `docs/API.md:196` has
documented it all along.

**Input:** any enrolled user who wants to move authenticators, or stop using
one. There is no path. The only way off a second factor was an edit to the
`users` table.

**Fix.** A `2fa-manage` panel holding the disable form, imported `disable2FA`,
and the nav item routed to it — see finding 2, which is the other half.

### 2. "2FA Enabled" is a label, not a state, and the button under it still asks to enrol

**`frontend/js/auth-ui.js:1305`** and **`frontend/js/auth-ui.js:1349`**

The nav item's caption switches on the flag:

```js
${user.is_totp_enabled ? '2FA Enabled' : 'Setup 2FA'}
```

but its click handler dispatches `request-2fa-setup-modal` unconditionally, and
that listener (`:177`) always calls `setup2FA()`. That ternary is the entire
frontend's 2FA state logic — there was no enabled-state view to route to.

The server refuses correctly: `setup_2fa` 400s while `is_totp_enabled`
(`server/services/auth_service.py:844`), because reissuing would overwrite the
secret the authenticator already holds. Because `openAuthModal('2fa-setup')`
runs *before* the `await`, the panel is already on screen when the refusal
arrives, and the two assignment lines never execute.

**Input:** click the nav item while enrolled. What renders is the enrolment
panel with the "Scan the QR code…" subtitle, a white 180×180 frame holding
`<img src="">`, the literal text `Secret Key:` followed by nothing, and a red
error instructing the user to disable 2FA first — through the control finding 1
says does not exist. This is the reported "barcode and key are no longer
displayed": they were never populated.

`<img src="">` also resolves to the document URL, so the browser re-requests
`index.html` as an image on every occurrence.

**Fix.** Route on state: dispatch `request-2fa-manage-modal` when
`is_totp_enabled`, and name the label for the action rather than the status
("Manage 2FA"). Hide the QR block until `setup2FA()` resolves, and drop the
empty `src` attribute from the markup.

### 3. One wrong digit strands the sign-in with no way out

**`server/services/auth_service.py:933`** and **`frontend/js/auth-ui.js:578`**

`verify_2fa_login` burns the single-use pre-auth `jti` at `:933`, *before* it
checks the code at `:952`. That ordering is right — it is what stops a captured
token buying unlimited attempts — but it means the token in the form is spent
whatever the outcome.

The UI treats a failure as retryable: it writes the message into
`#2fa-verify-error` and leaves the user on the panel with the dead token still
in the hidden input. The panel has no back-to-login control, unlike the
magic-link panel (`index.html:2222`).

**Input:** mistype one digit. The first submit says "Invalid 2FA code". The
user corrects it and submits again, and the second returns *"This sign-in
attempt has expired. Please log in again."* — with no way to log in again short
of reloading the page.

**Fix.** Treat every verify failure as terminal, because it is: clear the spent
token, return to the login tab carrying the reason, and add a back-to-login
control for the user who simply wants out.

---

## P2

### 4. Enabling 2FA takes no password, so a stolen access token can bind an attacker's authenticator

**`server/services/auth_service.py:872`** and **`server/schemas/auth.py:45`**

`Enable2FARequest` is `{code}`. `enable_2fa` re-authenticates nothing; a valid
bearer token plus a code from the attacker's own authenticator is enough. The
two neighbouring credential changes both re-auth — `change_user_password:499`
and `delete_user_account:814` each take `current_password`.

**Input:** any XSS or token theft against an account that has *no* second
factor. The attacker enrols their own, and the owner is now locked out of their
own account behind a factor they cannot produce. That is takeover persistence,
not merely a read.

**Fix.** `current_password` on `Enable2FARequest`, verified with the existing
`verify_password` before the code is checked.

### 5. Neither enable nor disable counted a failed attempt

**`server/services/auth_service.py:872`** and **`server/services/auth_service.py:889`**

`verify_2fa_login` calls `enforce_lockout` (`:949`) and
`register_failed_attempt` (`:953`). Neither `enable_2fa` nor `disable_2fa`
called either. `disable_2fa` also compared the password with no tally, making it
an unmetered password oracle for anyone holding an access token.

**Input:** an access token and a script. Six digits is 10⁶, and nothing counted
or slowed the walk.

**Fix.** Both functions now run **lockout → password → state → code → mutate →
revoke → notify**, with a wrong password and a wrong code each calling
`register_failed_attempt`. A *state* error ("2FA is not enabled") deliberately
does not count — it refuses everyone equally, so counting it would let a prober
lock arbitrary accounts.

### 6. `/2fa/enable` and `/2fa/disable` were on the general 1000/min budget

**`server/middlewares/rate_limit.py:24`**

`AUTH_RATE_LIMITED_PATHS` held `/auth/2fa/verify` and not the other two, so both
routes that can turn a second factor on or off fell through to
`RATE_LIMIT_PER_MINUTE`. Sitting behind `get_current_user` is not the same
protection: an access token is not a password, and these two check both a
password and six digits.

**Fix.** Both added to the strict set. `/auth/2fa/setup` is deliberately left
off: it guesses nothing, and the budget is 5 requests per minute *shared across
every path in the set*, so adding setup would spend the allowance the enable
step needs seconds later.

### 7. Turning a second factor on or off was silent, and left every other session alive

**`server/services/auth_service.py:881`** and **`server/services/auth_service.py:900`**

Every other credential change notifies and revokes:
`change_user_password:563,569` and `reset_password_with_token:789,795` both call
`revoke_user_tokens` and schedule `send_security_notification_email`. The two
2FA mutations did neither, so a device that authenticated before the second
factor existed kept its session, and the owner was never told.

Reusing `send_security_notification_email` was not an option — its copy names
the password specifically (`notification_service.py:161`), and a mail reading
"your password was changed" when it was not sends the owner chasing the wrong
credential.

**Fix.** A sibling sender, `send_2fa_change_notification(email, user_id,
enabled)`, scheduled through `BackgroundTasks`; and
`revoke_all_other_sessions(db, user, current_jti)` rather than
`revoke_user_tokens`, so the caller keeps the session they are working in.

---

## P3

### 8. The TOTP code fields accepted any string

**`server/schemas/auth.py:45`**, **`:48`** and **`:52`**

`code: str` on all three of `Enable2FARequest`, `Disable2FARequest` and
`Verify2FARequest`, with no length or pattern bound; whatever arrived went
straight to `pyotp`. `pre_auth_token` was likewise unbounded. The checklist item
in `SECURITY.md` — "New request field? Is it length-bounded?" — was not applied
here.

**Fix.** `Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")` on each
code, and a length cap on `pre_auth_token`. This is safe on the client:
`getErrorMessage` (`js/auth.js:27`) already unwraps FastAPI's 422 `detail`
array.

### 9. There is no recovery path from a lost authenticator *(open)*

**`server/models/user.py:22`**

The `users` table carries `totp_secret` and `is_totp_enabled` and nothing else.
A repository-wide search for `backup_code|recovery_code|scratch code` returns
zero matches — no column, no endpoint, no UI.

The three ways out are all closed: `disable_2fa` requires a live TOTP code
(`auth_service.py:897`), `reset_password_with_token` never touches the 2FA
fields (`:688-799`), and the magic-link path re-challenges for 2FA (`:1048`).

**Input:** a lost or wiped phone. The account is permanently unreachable
without direct database access.

**Fix (not applied).** A `backup_codes` column of hashed single-use codes, a
generate-on-enable step that shows them once, and acceptance of one in place of
a TOTP code at `/2fa/verify` and `/2fa/disable`. Needs a migration, which put
it outside this change. Now recorded in `SECURITY.md` "Known limitations".

**Settled, for whoever builds it:** a recovery code signs the user in and
leaves 2FA *on*, rather than stripping the second factor as a side effect of
logging in. Moving to a new authenticator is then the ordinary two steps —
sign in with one code, disable with a second — and a single leaked code buys a
session rather than a session *and* the removal of the factor.

**Operator escape hatch (applied).** `scripts/clear_2fa.py` clears the factor
for one account from the host, mirroring `disable_2fa`'s own mutation including
the lockout counters, and revoking sessions by default. It does not close this
finding: it needs database access, so it is a remedy for the owner and not a
path for a user. Documented in `docs/OPERATIONS.md`, "Clear a lost second
factor"; covered by four cases in `tests/backend/integration/test_auth.py`.

### 10. `totp_secret` is stored in plaintext *(open)*

**`server/models/user.py:22`**

`Column(String(255), nullable=True)`, written raw at `auth_service.py:852`. A
grep of `server/` for `fernet|encrypt|ENCRYPTION_KEY` returns no application
hits, so there is no facility to reuse. Anyone who can read the table can mint
codes for every enrolled account.

Lower than it sounds only because the same reader also holds
`hashed_password`; the second factor's whole purpose is to survive that, and
here it does not.

**Fix (not applied).** Encrypt at rest under a new required secret, with a
migration to re-wrap existing rows. Both the new secret and the data migration
put it outside this change.

---

## Not findings

Three things that look wrong at a glance and are not:

| Looks like | Why it is right |
| :--- | :--- |
| `/2fa/setup` 400s once 2FA is on | Deliberate, and the reason is in the code (`auth_service.py:839`): reissuing overwrites the secret the authenticator holds. The bug was the UI walking into it, not the refusal. |
| The pre-auth `jti` is burned before the code check | That ordering is what makes the token single-use. Finding 3 is the UI not coping, not the ordering. |
| `valid_window` left at pyotp's default of 0 | No skew tolerance is a deliberate tightening, and 30 seconds is enough in practice. Revisit only if real users start failing. |
