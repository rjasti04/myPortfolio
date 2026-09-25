# Intent: Admin Panel — Roles, Users and IP Activity

**Companion spec**: not written yet. It will go to
`.claude/specs/2026-09-25-admin-panel.md` once this intent is approved.
**Status**: proposed. Nothing is implemented yet. Line numbers refer to
`1506644`.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [ ] 1. Visitor / Recruiter: not served, and must not pay for it. The
        panel's script loads only after the API confirms a staff role. Its
        styles stay out of the render-blocking stylesheet (§6). The header nav,
        the mobile bottom bar and first paint do not change.
  - [x] 2. Portfolio as a Work Sample: access control is the first thing a
        security reviewer opens. This work shows the author can build it
        properly:
        - roles enforced on the server;
        - least privilege between two staff tiers;
        - an audit trail;
        - an auth-matrix test on every route.

        A role check that lived only in the UI would show the opposite.
  - [x] 3. Owner: the primary audience. With the panel, the owner can:
        - give trusted people read access to the site's traffic without
          sharing a password;
        - see who has an account;
        - see which addresses visit, when, and how often.

- **Problem Statement**:
  The request:

  | # | Requirement |
  | :--- | :--- |
  | R1 | An admin panel, visible only to admin and superuser accounts once they sign in |
  | R2 | `inboxtorj@gmail.com` is the only admin by default |
  | R3 | The admin can make other users superusers. Superusers cannot manage users |
  | R4 | An admin-only dashboard that lists registered users and can make any of them a superuser |
  | R5 | A dashboard for both roles showing activity per distinct IP: the IP, its first and last login, and its session count |
  | R6 | Recommendations for further dashboards and features (§5) |

  Each of these points was checked against the tree before writing:

  1. **There is one privileged identity and no roles.** `require_owner`
     (`server/auth/dependencies.py:103-124`) compares the caller's email with
     `OWNER_EMAIL` (`server/config/settings.py:122-126`). That setting is unset
     by default, so it denies everyone. It guards the four
     `/admin/analytics/*` routes (`analytics_routes.py:32`).

     `users` has no role column. The recorded reason is that "adding one for a
     site with a single real account would be a schema change in service of a
     constant". The review that proposed owner analytics said when to revisit
     that: "the column is right if accounts ever grow past one"
     (`docs/review/features.md:228-234`). R3 is that moment.
  2. **Distinct IPs are a single number.** `/admin/analytics/overview` returns
     `COUNT(DISTINCT ip_address)` (`analytics_routes.py:62`), and no route
     lists the addresses themselves. The data already exists. Every visit
     writes a `user_sessions` row with `ip_address`, `started_at` and
     `last_active_at` (`session_controller.py:36-43`). A visit is one browser
     tab, and reloading the tab continues it (`analytics.js:65-70`).
  3. **Sign-ins per IP cannot be counted today.**
     - `refresh_tokens` records an IP when a token is minted, but every
       rotation mints a new row (`auth_service.py:613-621`).
     - Access tokens live 30 minutes (`server/auth/security.py:14`), and no
       column tells a sign-in row from a rotation row.
     - `user_sessions.user_id` exists, but nothing writes it. That is the
       anonymous analytics table (`auth_service.py:631-640`, ADR-015).

     So "first and last login per IP" has two possible sources: visits, which
     are recorded today, and sign-ins, which need a new table.
  4. **There is no audit trail.** `docs/SECURITY.md:532` lists "No
     account-level audit log", with the path forward "Add a table if accounts
     grow beyond personal use". Granting privileges to other accounts is
     exactly that case. A role change is not reviewable if nothing records
     who made it, when, and from which address.
  5. **The panel has no obvious home.**
     - The owner's aggregate view is appended to the visitor-facing Activity
       section (`activity.js:1275-1298`, with `#act-owner` at
       `index.html:1767`).
     - The mobile bottom bar has "no headroom left: a ninth entry needs an
       overflow affordance" (`navigation.js:620-627`).
     - The account menu is the better entry point. `setupNavUI`
       (`auth-ui.js:1460`) rebuilds it on every `auth-changed`, and it already
       fetches `GET /auth/me`.

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001: vanilla ES modules only. The panel is a lazily imported group of
    modules under `frontend/js/admin/`, following the `json/`, `diff/` and
    `crypto/` precedent.
  - ADR-016: no new origin. There is no third-party IP geolocation or
    reputation lookup. `get.geojs.io` was removed, and nothing equivalent may
    come back. The panel adds no inline script. If it edits the pre-boot
    router, the CSP hash is re-pinned (§4).
  - ADR-014: Phase A's schema change is one Alembic migration, and
    `alembic check` stays clean.
  - ADR-015: `user_sessions` stays anonymous, and `user_sessions.user_id`
    stays unwritten. Sign-ins go in their own table. An account is never
    joined to its browsing.
  - ADR-024: styles use design tokens only, and reuse the `act-owner-*` card,
    stat and bar rules wherever they fit.
  - `POST /chat` and `POST /sessions` stay anonymous, and ADR-023 is
    untouched.
  - **The server is the boundary.** Every admin route checks the role on the
    server. Hiding a UI element is a convenience, never the control. The role
    is resolved from the `users` row that `get_current_user` already loads on
    every request (`dependencies.py:46`). It is **never a JWT claim**, because
    a claim would outlive a revocation by up to 30 minutes.

- **Standing decisions deliberately changed**. Each one is updated where it is
  stated, and recorded in a new **ADR-026, "Roles for the admin panel"**:
  - **`users` gains a column that carries a role.** This reverses the
    reasoning in these places:
    - `settings.py:122-125`
    - `dependencies.py:106-108`
    - the "Owner analytics" sections of `docs/SECURITY.md` and `docs/API.md`

    That reasoning rested on "one real account". Once superusers exist, it no
    longer holds.
  - **`OWNER_EMAIL` becomes `ADMIN_EMAIL`, and gains a default.** When unset,
    it now means `inboxtorj@gmail.com` (R2) instead of nobody. Two rules keep
    it failing closed:
    - An explicitly empty `ADMIN_EMAIL=` still means nobody. That is the kill
      switch.
    - The address must be verified to match, so registering it without access
      to its inbox gains nothing.

    `OWNER_EMAIL` is read as a fallback for one release, so a deployment that
    sets it keeps its admin.
  - **`require_owner` is replaced by two gates.** `require_admin` is the same
    check plus the verified-address rule. `require_superuser` admits a
    superuser or the admin, because roles are ordered. `/admin/analytics/*`
    moves to `require_admin`, so who can read it does not change.

- **Explicit Non-Goals**:
  - More than one admin, or changing the admin from the UI. Changing
    `ADMIN_EMAIL` is an action taken on the host, which is why the API can
    neither demote the admin nor lock the admin out.
  - Any user management by superusers (R3). Superusers get no user list, no
    account identities and no actions.
  - Impersonation, editing another account's email or password, and deleting
    accounts from the panel. The 30-day purge stays the only way an account
    is deleted.
  - A standalone `admin.html`. It would isolate the panel's code, but only by
    duplicating the shell, the theme, `auth.js` and the dialog and toast
    modules. The SPA already hosts one privileged view (`owner-analytics.js`),
    and a lazily loaded chunk costs visitors nothing.
  - Push updates. The panel fetches when it opens and on request. SSE
    (ADR-019) is scoped to one analytics session and its stream cap.
  - Anything in §5. Those are recommendations, and each needs the owner's
    go-ahead.

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend** (phases B and C): `npm run lint` && `npm test`. `npm test`
      builds `dist/` and enforces the size budget, so a separate
      `npm run build` adds nothing (`AGENTS.md` §6).
- [x] **Backend** (every phase): `ruff check server tests` &&
      `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`
- [x] **Database** (phase A): one migration. It adds a nullable column to
      `users` and creates `audit_events`. CI's `migration-check` job applies
      the full chain against PostgreSQL and runs `alembic check`. Locally,
      follow the `alembic-guard` skill.
- [x] **Docs / Hashes** (every phase): `python3 scripts/check_csp_hashes.py` &&
      `python3 scripts/check_docs.py --fix --show-tokens`. The docs that change:

      | Doc | Change |
      | :--- | :--- |
      | `API.md` | A new "Admin" section, and `role` on `/auth/me` |
      | `SECURITY.md` | "Owner analytics" becomes "Admin panel and roles". The audit-log limitation row is updated, and the checklist gains a question: which gate does a new admin route take, and is it in the matrix test? |
      | `DATABASE.md` | The new column, `audit_events`, and their lifecycle |
      | `CONFIGURATION.md`, `.env.example` | `ADMIN_EMAIL` |
      | `JAVASCRIPT.md`, `TESTING.md` | The new modules and test counts |
      | `ADR.md` | ADR-026 |
      | `AGENTS.md` | The table list under "Database expectations" |

## 4. Success Metrics & Verifiable Criteria

### Roles

| Role | Who | Stored as |
| :--- | :--- | :--- |
| `admin` | The account whose **verified** email equals `ADMIN_EMAIL` (default `inboxtorj@gmail.com`). The match is exact after lowercasing, so Gmail's dot and plus aliases deliberately do not match | Configuration, never the database |
| `superuser` | Any other account that holds a grant | `users.superuser_granted_at`. It is a timestamp rather than a boolean for the same reason `email_verified_at` is one: it records *when* |
| `user` | Everyone else | — |

- One resolver returns the highest role that applies, so the admin never also
  shows up as a superuser. `GET /auth/me` gains a `role` field.
- Deleting an account (`delete_user_account`, `auth_service.py:1035`) clears
  its grant. Reactivating the account within 30 days does not quietly restore
  its privileges.

### Access matrix

| Surface | Anonymous | User | Superuser | Admin |
| :--- | :---: | :---: | :---: | :---: |
| "Admin panel" entry in the account menu | — | hidden | shown | shown |
| IP activity list and detail | 401 | 403 | ✓ | ✓ |
| Account emails in the IP detail | — | — | **not sent** | ✓ |
| User list | 401 | 403 | 403 | ✓ |
| Grant or revoke superuser | 401 | 403 | 403 | ✓, except on the admin row |
| `/admin/analytics/*` (existing) | 401 | 403 | 403 (§5 #6 would open it) | ✓ |

### Users dashboard (admin only)

- Each account gets one row, with these fields:
  - email and display name
  - a role badge
  - status: active; unverified; locked, by the password or the code tally,
    with the time the lock ends; or deleted, with the date it will be purged
  - whether 2FA is on
  - joined date
  - last sign-in (`users.last_login`)
  - live sessions: unrevoked, unexpired `refresh_tokens`
  - superuser since
- Search by email or name, filter by role and status, 50 rows per page.
- **Make superuser** and **Remove superuser** go through `confirmAction()`
  (`confirm-dialog.js:86`). The dialog names the consequence: "They will see
  IP activity for every visitor".
- The actions are disabled, with the reason shown, for the admin's own row
  and for unverified, inactive or deleted accounts.
- A change applies on the target's next request, with no sign-out needed. It
  writes one audit row and shows a confirmation toast (ADR-009).

### IP activity dashboard (admin and superuser)

- A window picker offers 7, 30, 90 or 365 days, the same choices as the owner
  panel.
- There is one row for each IP that had a session in the window. The newest
  activity is listed first, and these columns are sortable:

  | Column | What it shows |
  | :--- | :--- |
  | **IP address** | The address as recorded |
  | **First seen** | The earliest `started_at` ever recorded, not just in the window, so a returning address never looks new. An address first seen inside the window gets a "new" badge |
  | **Last seen** | The latest `last_active_at` |
  | **Sessions** | How many sessions started in the window |
  | **Sign-ins**, **last sign-in** | Taken from `audit_events`. They read "—" until the table has rows |
  | **Devices** | The mix of device types |
  | **Live** | Whether a session from the address is active now |

- The list can be searched by IP prefix. It shows 50 rows per page, with a
  total.
- The detail view for one IP shows two lists:
  - its sessions: start, last active, duration, end reason, device, event
    count, and the user agent rendered as plain text;
  - its sign-ins: time and method. Account emails appear here for the admin
    only.
- Three caveats appear on screen, in the style of the existing "a floor on
  people, not a count":
  - one address is not one person;
  - only clients that run JavaScript open sessions;
  - sessions recorded before the trusted-proxy fix all carry the proxy's
    loopback address (`settings.py:134-148`), and are labelled as such.

### Where the panel lives

- **Entry.** An "Admin panel" item appears in the account menu when `role` is
  `admin` or `superuser`. `setupNavUI` runs on every `auth-changed`, so the
  item appears at sign-in. The panel does not open by itself.
- **View.** A `<section id="admin" hidden>` shell sits in `<main>` as a direct
  child, like the other eight sections, and holds no data in its markup.
  - The panel module is imported the first time the panel opens, following
    `activity.js:1281`, including its `rj:stale-build` handling.
  - It builds only the tabs the caller may see: Users for the admin, and IP
    activity for both roles.
  - When `auth-changed` leaves the caller without a staff role, the module
    empties the panel and routes home. This is the `hide()` rule from
    `owner-analytics.js:85-89`.
- **Deep link.** `#admin` has to survive a reload. The pre-boot router accepts
  a fragment only if a header `nav a[data-target]` names it
  (`index.html:367-383`). The spec picks one of two ways to allow it:
  - a `hidden` header link, which needs no CSP change;
  - teaching the router the route, which means re-pinning the hash.

  A caller without a staff role who lands on `#admin` is sent home. Nothing
  leaks: the shell is empty, and the API refuses. `#admin` is left out of the
  swipe order (`navigation.js:688`).

### MVP endpoints (the spec fixes the final names)

| Route | Gate | Notes |
| :--- | :--- | :--- |
| `GET /auth/me` | user | Adds `role` |
| `GET /admin/users` | admin | `q`, `role`, `status`, `limit` ≤ 100, `offset`. Returns `{total, items}` |
| `PUT /admin/users/{user_id}/role` | admin | Body `{"role": "superuser" \| "user"}`. Returns 404 for an unknown id, and 409 for the admin row or an ineligible target. A request that changes nothing writes no audit row |
| `GET /admin/ip-activity` | superuser | `days` 1–365, `q` (an IP prefix), `sort`, `limit` ≤ 100, `offset` |
| `GET /admin/ip-activity/detail` | superuser | Takes `ip` as a query parameter. IPv6 colons are legal in a path segment, but fragile through proxies |

### Schema (phase A, one migration)

- `users.superuser_granted_at TIMESTAMPTZ NULL`.
- `audit_events`, which is append-only. Its columns:

  | Column | Notes |
  | :--- | :--- |
  | `id` | `BIGINT`, with the same SQLite variant `user_activity_events` uses |
  | `created_at` | When the event happened |
  | `event_type` | `sign_in`, `superuser_granted` or `superuser_revoked` in the MVP |
  | `actor_user_id` | `ON DELETE SET NULL`, because an admin's action outlives the actor's account |
  | `subject_user_id` | `ON DELETE CASCADE`, so the purge still honours "a deleted account is deleted" (`SECURITY.md`, "Logging and privacy") |
  | `ip_address`, `user_agent` | The request's context |
  | `details` | JSON/JSONB, for example the sign-in method, or the old and new role |

- A `sign_in` row is written wherever a sign-in completes and mints a token
  pair:
  - `authenticate_user` (`auth_service.py:527`)
  - `verify_2fa_login` (`:1296`)
  - `verify_magic_link` (`:1387`)

  The IP comes from `_session_context` (`:99`). A refresh is not a sign-in and
  writes nothing. Old sign-ins cannot be backfilled, because `refresh_tokens`
  cannot tell a sign-in from a rotation.
- The spec chooses indexes from `EXPLAIN` output. There are two candidates:
  - `user_sessions (ip_address, started_at)`, for all-time first seen and for
    the detail view;
  - `audit_events (event_type, created_at)`.

### Acceptance checks

1. With neither `ADMIN_EMAIL` nor `OWNER_EMAIL` set, `/auth/me` returns
   `role: "admin"` for a verified `inboxtorj@gmail.com` and `user` for every
   other account.
2. The admin setting behaves as follows:
   - `ADMIN_EMAIL=a@example.com` moves the admin role to that account.
   - `ADMIN_EMAIL=` leaves no admin at all.
   - `OWNER_EMAIL` alone is honoured.
3. An unverified account at the admin address resolves to `user`. This is
   tested at the resolver, because login already refuses such an account.
4. An auth-matrix test is generated from the app's `/admin` routes, so a new
   route cannot skip it. It checks every cell of the access matrix, including
   that a superuser's detail response has **no** email field at all.
5. A grant, and then a revoke, each take effect on the target's very next
   request. Each change writes exactly one `audit_events` row, with the actor,
   the subject, the IP, and the old and new role. A repeated PUT writes
   nothing.
6. Requests that must change nothing:
   - A grant on the admin row returns 409.
   - A grant on an unverified, inactive or deleted account returns 409.
   - A superuser calling the grant route gets 403.
7. Deleting a superuser's account clears the grant. If the account is
   reactivated within 30 days, it signs in as `user`.
8. For fixture sessions across three IPs and two windows, the IP list returns
   exact values for:
   - first seen (all time) and last seen;
   - the in-window session and sign-in counts;
   - a `total` that counts every match, not just the rows on the page.

   The bounds on `days` and `limit` are enforced.
9. Signing in by password, by 2FA and by magic link each writes one `sign_in`
   row with the request's IP. `/auth/refresh` writes none.
10. In jsdom:
    - A plain user sees no menu entry, and the admin chunk is never requested.
    - A superuser sees only the IP tab.
    - The admin sees both tabs.
    - Signing out empties the panel and routes home.
    - Markup placed in the username, email or user-agent fixtures renders as
      text.
11. The 12 tests in `test_owner_analytics.py` pass against `require_admin`,
    and `test_frontend_api_contract.py` covers the new routes.

## 5. Recommended Dashboards & Features

None of these are committed. **P1** items are the next wave after the MVP,
**P2** items are worthwhile, and **P3** items are optional.

| # | Pri | Recommendation | Who | Why | Data today | Effort |
| ---: | :---: | :--- | :--- | :--- | :--- | :---: |
| 1 | P1 | **Security dashboard**: failed sign-ins by IP and by account; accounts locked now, by either tally, with when each lock ends; unverified sign-ups older than 7 days; staff without 2FA; recent password and 2FA changes | admin | An early warning for credential stuffing and sign-up abuse. The site has no CAPTCHA anywhere (`SECURITY.md`) | The `users` columns exist. Failures need `sign_in_failed` rows written without undoing the S5 timing fix | M |
| 2 | P1 | **Account actions**: force sign-out (`revoke_user_tokens`, `auth_service.py:631`), unlock both tallies, resend the verification link; later, deactivate and reactivate | admin | The first things an admin reaches for after a lockout or a lost device. Each goes through `confirmAction()` and is audited | Yes | S |
| 3 | P1 | **Require 2FA for staff**: the gates refuse a caller without `is_totp_enabled` and link to 2FA setup, and a grant refuses a target without 2FA | admin, superuser | Superusers see every visitor's IP, so a phished password alone should not be enough. It is left out of the MVP so that deploy day cannot lock the admin out | Yes | S |
| 4 | P1 | **Notify on role change**: email the affected account and the admin, following `send_2fa_change_notification` (`notification_service.py:191`) | — | An unexpected grant then shows up in two inboxes | Yes | S |
| 5 | P1 | **IP retention and minimisation**: a sweep on the purger's schedule that truncates old addresses (IPv4 to /24, IPv6 to /48) or deletes old sessions | — | IP addresses are personal data, and no retention sweep exists (`DATABASE.md`, "Retention and lifecycle"). Making them browsable raises the cost of keeping them forever | Yes | S |
| 6 | P1 | **Traffic tab**: move "Across every session" out of the Activity section into the panel, and open it to superusers | superuser+ | The Activity section goes back to what its intro promises: the visitor's own visit. Staff get one place to look | Yes: `/admin/analytics/overview`, `/funnel` and `/commands` | S |
| 7 | P1 | **Client errors**: `client_error` events grouped by name and message, showing the count, sessions affected, first and last seen, pages and browsers | superuser+ | Those rows are stored, but they only ever appear inside the visitor's own session (`activity.js:279`). A production failure still reaches nobody, as `ai_llm_telemetry` did before `/llm` | Yes | S |
| 8 | P2 | **AI usage and cost**: the `/llm` figures, plus a daily series, an estimated USD figure from per-token prices set on the server, and a daily-spend alert emailed to the admin | superuser+; per-account figures admin only | Bedrock is the site's only metered cost. The server owns cost (ADR-023), so prices belong in server config, never in client input | The telemetry exists. Prices do not | M |
| 9 | P2 | **Audit log tab**: `audit_events` as a read-only list with filters, and no delete route | admin | Makes the MVP's audit rows reviewable | Written by the MVP | S |
| 10 | P2 | **Access logging**: opening an IP view writes an `ip_activity_viewed` row | — | Records who looked at visitor data, and when | Uses the MVP's table | S |
| 11 | P2 | **System health**: `/health`; `/system/pipeline`, to show whether Kafka or the simulator is running; database round-trip time; the deployed commit; uptime; the purger's last run | admin | Answers "is it up, and is it running the build I think it is?" without SSH | Mostly. The purger's last run needs recording | S |
| 12 | P2 | **CSV export** of users and IP activity, built in the browser with `toCsv` (`json/json-csv.js:81`) and imported lazily | per tab | Gets the data into a spreadsheet with no new endpoint | Yes | S |
| 13 | P2 | **IP labels and "exclude staff traffic"**: the admin tags addresses ("home", "VPN", "bot"), and a toggle drops staff addresses from traffic figures | admin | Today the owner's own testing counts as visitor traffic | Needs an `ip_labels` table | M |
| 14 | P3 | **Live now**: sessions with a recent heartbeat, showing each one's current page and device, polled every 30 s | superuser+ | Useful during a demo or a launch | Yes | S |
| 15 | P3 | **IP block list**: refuse `POST /sessions`, `/chat` and `/contact` from listed addresses or CIDR ranges | admin | A lever against abuse. The cache is per process, like the rate limiter (ADR-012), and the admin could lock themselves out | Needs a new table | M |

**Considered and not recommended:**
- **Third-party geolocation or reputation APIs.** They would break ADR-016.
  An offline country database (GeoLite2) is possible later, but it brings a
  licence, a multi-megabyte file and an update job. That decision belongs to
  the owner.
- **Impersonation.** It is the riskiest admin feature there is, and nothing
  here needs it.
- **Storing contact-form messages for an inbox view.** The email already
  serves as the inbox. Storing the messages would put third-party personal
  data in the database without adding anything the owner can do today.
- **Tying `user_sessions` to accounts** to show what a user browsed. That
  would break ADR-015 and the anonymity visitors are given. The audit table
  answers the security questions without it.

## 6. Risks & Mitigations

- **Privilege escalation.** This is the risk that matters. The mitigations:
  - one resolver, reading roles from the database on every request;
  - two gates, with no role logic in route bodies;
  - the admin row cannot be changed through the API;
  - a generated auth-matrix test, so an ungated route fails CI instead of
    shipping;
  - superuser responses leave out identities on the server, not only in the
    UI.
- **Taking over the admin through the default address.** The match requires a
  verified address:
  - login already refuses an unverified one (`auth_service.py:488`);
  - there is no route to change an email;
  - emails are stored lowercase.

  Setting `ADMIN_EMAIL=` switches the admin role off entirely.
- **Enumeration timing (S5).** The MVP writes audit rows only on the success
  paths, so the equalised failure paths are untouched. Recommendation #1 must:
  - write failure rows for known and unknown addresses alike;
  - never store the address that was typed, because people type passwords
    into the email field.
- **Visitor performance and the size budget.** The budget counts every `.js`
  and `.css` file in `dist/`, lazy chunks included
  (`scripts/build.mjs:636-643`). A build of this commit measures:
  - JS at 391.2 of 392 KiB;
  - CSS at 297.5 of 298 KiB.

  Phases B and C will exceed both. Each phase raises `BUDGETS_KIB` by its
  measured cost and gives the reason in the commit, as that file asks. The JS
  is a lazy chunk that only staff download. The CSS matters more, because
  `styles.css` is render-blocking for every visitor. So the panel reuses the
  `act-owner-*` rules and puts everything else in an `admin.css` that
  attaches the first time the panel opens. That file sits in the build's
  stylesheet list (`scripts/build.mjs:436`). The spec settles how the module
  learns the hashed file name. The fallback is a small block in `styles.css`
  that uses tokens only.
- **Privacy.** A browsable table of visitor IPs is personal data. The
  mitigations:
  - the table is staff-only;
  - identities are admin-only;
  - no third-party enrichment;
  - recommendations #5 (retention) and #10 (access logging) are ranked where
    they are for this reason.

  The site has no privacy notice. §7 asks whether it needs one.
- **Query cost.** `GROUP BY ip_address` over `user_sessions` stays inside the
  existing 365-day cap and is paginated. All-time first seen is the expensive
  part. The spec measures it with and without the candidate
  `(ip_address, started_at)` index, and adds an index only on that evidence,
  as the index-rebalance migration (`m6b7c8d9e0f1`) did. Sign-in auditing
  costs one INSERT per sign-in.
- **Deploy and rollback.** The change is additive:
  - `role` is a new response field that an old cached SPA ignores;
  - the migration adds a nullable column and a new table, so rolling back the
    code alone is safe.

  One effect is visible: after deploy, a verified `inboxtorj@gmail.com` is
  the admin in every environment where `ADMIN_EMAIL` is unset, staging
  included.
- **Mobile and accessibility.** Dense tables are the risk. The mitigations:
  - Below about 640px, rows reflow into cards, with no horizontal page scroll.
  - Tables use `<caption>`, `<th scope>` and `aria-sort`.
  - The tabs follow the ARIA tabs pattern.
  - Focus returns to the row that opened the confirm dialog.
  - Updates are announced through a polite live region, as in the owner panel.
  - The `accessibility` skill's checklist applies.
- **XSS.** The email, username and user agent are all user-controlled. They
  are rendered with `textContent` through the `el()` helper, as in
  `owner-analytics.js`. The `innerHTML` + `escapeHTML` templates in
  `auth-ui.js` are not the model to copy.

## 7. Assumptions

This is a non-interactive session (Claude Code on the web), so the
intent-planner interview was skipped. The answers below were inferred from
the request and the repository:

1. **"First login / last login" means the first and last visit** from that IP,
   taken from `user_sessions`. Almost no address that reaches the site ever
   signs in, so a view of sign-ins alone would have only a handful of rows.
   The sign-in count and last sign-in sit next to them, taken from
   `audit_events`. Those two columns count only from the day it deploys.
2. **"Visible upon logon"** means the entry appears in the account menu at
   sign-in. The panel does not open by itself.
3. **The admin comes from configuration, and superusers from the database.**
   This split has three benefits:
   - the API cannot demote, delete or lock out the top role;
   - "only one admin" is true by construction, not a rule that needs
     policing;
   - a direct write to the database can create at most a superuser.

   The cost is that two sources answer one question. The single resolver
   keeps that contained.
4. **A `superuser_granted_at` timestamp rather than a `role` string**,
   following the house idiom. If a third stored tier ever appears, a `role`
   enum is the better shape, and the spec can switch to one then.
5. **In the MVP, superusers get IP activity only.** The aggregate analytics
   stay admin-only until recommendation #6 is approved.
6. **Superusers see full IP addresses**, as R5 asks. Recommendation #5 offers
   masking.
7. **The MVP does not require 2FA.** Recommendation #3 is the first follow-up.
8. **Delivery is three PRs**, with the spec written first, in this order:
   - **A**: the migration, `ADMIN_EMAIL`, the resolver and both gates, `role`
     on `/auth/me`, sign-in auditing, moving the analytics routes to
     `require_admin`, and ADR-026.
   - **B**: the panel shell and the Users tab, with its two routes.
   - **C**: the IP activity tab, with its two routes.

   Each PR runs only the gates for the layers it touches.
9. **This task delivers only this intent.** Nobody asked for a spec. It will
   follow at `.claude/specs/2026-09-25-admin-panel.md` once this intent is
   approved.

### Open questions for the owner

Each has a default above, and each is cheap to change until the spec is
written:

- Should superusers also see Traffic (#6) and AI usage (#8)?
- Should staff need 2FA from day one (#3)?
- How long should IP addresses be kept at full precision (#5)?
- Now that more than one person can browse visitor IPs, does the site need a
  short privacy note?
