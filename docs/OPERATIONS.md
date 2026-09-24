# Operations

Build, continuous integration, deployment, rollback and day-two operations.

- [The build](#the-build)
- [CI/CD pipeline](#cicd-pipeline)
- [Quality gates](#quality-gates)
- [Deployment](#deployment)
- [Rollback](#rollback)
- [Production layout](#production-layout)
- [Monitoring](#monitoring)
- [Runbook](#runbook)
- [Manual procedures](#manual-procedures)

---

## The build

```bash
npm run build      # scripts/build.mjs → dist/
```

Two invariants shape the script:

1. **`frontend/` stays the source of truth and stays runnable on its own.**
   `python -m http.server --directory frontend` must keep working, so the build
   only ever reads from it. Nothing writes back.
2. **Inline `<script>` bodies are never touched.** `index.html` pins them by
   `sha256` in its CSP, so reformatting one silently stops it running. The build
   rewrites `src`/`href` attributes only, and CI verifies the hashes afterwards
   on both the source and the built page.

What it produces:

| Output | Detail |
| :--- | :--- |
| `dist/assets/main-<hash>.js` | Bundled `js/main.js` and its static imports |
| `dist/assets/auth-ui-<hash>.js` | Bundled `js/auth-ui.js` |
| `dist/assets/chunk-<hash>.js` | Split chunks — chat and activity stay lazily loaded |
| `dist/assets/app-logic-<hash>.js` | IIFE build of the classic script |
| `dist/assets/theme-bootstrap-<hash>.js` | IIFE build of the pre-paint script |
| `dist/assets/styles-<hash>.css` etc. | Minified CSS with hashed font assets and rewritten `url()` |
| `dist/index.html` | Asset references rewritten to hashed paths |
| `dist/sw.js` | `CACHE_NAME` and `PRECACHE_URLS` regenerated from what was built |
| `dist/**` | Static files copied by extension allowlist, plus vendor scripts, `.htaccess`, `worldcup.html`, `ucl.html`, `arcade.html` |

The precache list is **generated**, not hand-maintained. The old 40-entry manual
list both defeated the lazy loading in `main.js` and let a single renamed file
fail `cache.addAll` and stop the worker installing at all. It now covers the app
shell only — the two entries, everything they reach through **static** imports,
the stylesheets and the two classic scripts.

The build **throws** if `index.html` had no asset reference rewritten, or if
`sw.js` had neither substitution applied — a silent no-op there would ship a
broken deploy.

`dist/` is gitignored and rebuilt in CI on every run.

---

## CI/CD pipeline

`.github/workflows/deploy.yml`, triggered on push to `main` and on pull requests
targeting `main`. (Restricting the push trigger to `main` matters: `'**'` ran the
whole matrix twice for any branch with an open PR — once for the push and once
for the PR — doubling cost for no extra signal.)

```
   push/PR to main
         │
   ┌─────┴──────────────────┬──────────────────────┐
   ▼                        ▼                      ▼
frontend-check         backend-check          migration-check
lint · test · build    pip-audit · ruff       single head · upgrade
CSP hashes · audits    pytest (3.10 + 3.12)   alembic check · downgrade
dist/ artifact
   └────────────────────────┴──────────────────────┘
                            │  all three green, push to main only
                            ▼
                         deploy
   download dist/ → snapshot → verify sources → rsync server/ → rsync dist/
   → pip install --require-hashes → alembic upgrade head
   → restart units → health probe → smoke test
                            │
                       on any failure
                            ▼
                    roll back → confirm health
```

The three gates run concurrently with `cancel-in-progress: true` (safe — nothing
they do is stateful). Every workflow runs with `permissions: contents: read`, and
every action is pinned to a commit SHA, with Dependabot keeping the pins current. The deploy job uses `cancel-in-progress: false` so
concurrent merges **queue** rather than cancel: interrupting a half-finished
migration or file sync is worse than waiting.

---

## Quality gates

### `frontend-check` (20 min, Node 22)

1. `npm ci`
2. `npm run lint` — ESLint + Stylelint
3. `npm test` — Node test runner + jsdom
4. `npm run build` — a build failure is caught here rather than mid-deploy
5. `python3 scripts/check_csp_hashes.py` — sees both the source and the built page
6. `python3 scripts/check_docs.py` — the counts the docs quote still match the
   repository; `--fix` applies the corrections locally
7. `npm run audit` — `continue-on-error`, so transitive dev advisories are
   visible without blocking a portfolio deploy
8. `npm audit --omit=dev --audit-level=high` — **blocking**, over the three
   packages whose bytes ship (`dompurify`, `marked`, Font Awesome, now
   `dependencies`). An unreachable advisory endpoint is a warning, not a failure
9. On a push to `main` only, `dist/` is uploaded as the `dist` artifact (kept a
   day) for the deploy job

### `backend-check` (15 min, Python 3.10 **and** 3.12)

`fail-fast: false`, so one interpreter failing still reports the other. Both
versions are tested because the host's interpreter is not pinned by this
repository, and the lock is resolved `--universal` precisely so one set of pins
covers the range — this job is what proves it.

1. `pip install --require-hashes -r server/requirements-dev.txt` (a superset of
   the runtime lock resolved in one pass, so CI can never test against a
   different version of a shared package than production installs)
2. `pip-audit -r server/requirements.txt --require-hashes --disable-pip` —
   **blocking**, on the 3.10 leg only (both legs install the same lock)
3. `ruff check server tests`
4. `pytest --cov=server --cov-report=term-missing --cov-fail-under=55`

Environment: `TESTING=true`, `DATABASE_URL=sqlite+aiosqlite:///:memory:`,
`AWS_REGION=us-east-1`, `DEFAULT_MODEL_ID=google.gemma-3-4b-it`, and a
test-only `JWT_SECRET`.

### `migration-check` (15 min, Python 3.10, `postgres:16` service)

The pytest suite builds its schema with `Base.metadata.create_all` against
SQLite, so **migrations are never executed by any test** and a model that had
drifted from its migration was only discovered by `alembic upgrade head` running
against production. This job closes that gap:

1. Assert exactly one migration head
2. `alembic upgrade head` against real PostgreSQL
3. **`alembic check`** — compares the models against the schema the migrations
   just built and fails if they disagree
4. `alembic downgrade base && alembic upgrade head` — proves reversibility

---

## Deployment

Runs only on a push to `main` with all three gates green.

| Step | What it does | Why it exists |
| :--- | :--- | :--- |
| Checkout `github.sha` | Pins to the commit that triggered the run | Checking out the branch would deploy whatever `main` points at when the job starts, not what the gates passed |
| Download `dist/` | The `dist` artifact `frontend-check` built and tested from the same commit | This job used to run `npm ci` and `npm run build` itself, *after* writing a root-equivalent SSH key to disk - one compromised package's install script would have been root on the host. It now runs no package code at all |
| Configure SSH | Writes the key from `env:` (never `${{ }}` inside `run:`); uses `EC2_HOST_KEY` if set, else `ssh-keyscan` with a warning | Pinned host key means the deploy refuses to talk to anything else |
| **Snapshot** | `rsync` of `server/` and the web root into `deploy-backups/<UTC stamp>/`, records `alembic current`, repoints `current`, prunes to 10 | Everything after this is recoverable. A single `.prev` pair reached exactly one release back — two bad deploys and the last good one was gone |
| Verify sources | Refuses if `server/` or `dist/` has fewer than 5 files, or `dist/index.html` / `dist/assets` is missing | `rsync --delete` mirrors the source: an empty source doesn't fail, it **deletes the destination** — and one of them is Apache's document root |
| rsync `server/` | Excludes `.venv`, `venv`, `__pycache__`, `.env*`, `.git` | `.env*` exclusion is why a deploy can never clobber host configuration |
| rsync `dist/` → web root | `--rsync-path="sudo rsync"` | Ships the built output, not the source tree |
| Install + migrate | `pip install --require-hashes` then `alembic upgrade head` | Same hash-checked lock CI tested. `alembic/env.py` loads `.env` itself, since an SSH command does not inherit systemd's environment |
| Restart | `fastapi.service` and `httpd` | |
| **Health probe** | Units active, then up to 12 × 5 s polls of `HEALTH_CHECK_URL` for `"status":"ok"` | A restart returning 0 only means systemd accepted the unit. An import-time failure — a missing `JWT_SECRET`, say — exits after systemd has reported success, leaving the site down behind a green checkmark |
| **Smoke test** | `GET /` is 200 · the served `sw.js` cache version matches what this run built · `GET /api/health` is 200 | `/health` only runs `SELECT 1`. It cannot tell you whether Apache is serving the new frontend, or whether the `/api` prefix still routes — the two things a deploy is most likely to break. Read-only; nothing writes to production data |

---

## Rollback

Automatic on any failure, or cancellation, after the snapshot succeeded
(`if: (failure() || cancelled()) && env.DEPLOY_SNAPSHOT == 'ok'`).

A hang counts as a failure. Every deploy step that can take more than seconds
carries its own `timeout-minutes`, sized to its worst case, and a step timeout
fails the step. A hang in `rsync` or `alembic upgrade` used to be bounded only
by the job timeout, which cancels the job instead, so `failure()` stayed false
and the half-deployed release was left in place. The budgets, and the sum that has
to fit inside the job timeout with the rollback's own, are in a comment above
the job's `timeout-minutes`. A deploy cancelled by hand part-way through rolls
back for the same reason.

1. Resolve `deploy-backups/current` → the newest snapshot.
2. `rsync -a --delete` the snapshot's `server/` and `html/` back.
3. Reinstall the snapshot's pinned dependencies.
4. Restart `fastapi.service` and `httpd`.
5. Print the recorded pre-deploy Alembic revision and the remaining rollback
   points.
6. A follow-up step polls the health URL up to 6 × 5 s and fails loudly if
   service is not restored.

**The database is deliberately NOT downgraded.** `alembic downgrade` can drop
columns and lose rows. The consequence is a rule: **migrations must stay
backward-compatible with the release before them** — expand now, contract in a
later deploy.

Ten timestamped snapshots are retained.

---

## Production layout

| Path | Contents |
| :--- | :--- |
| `/var/www/html/` | The deployed `dist/`, served by Apache |
| `/home/<EC2_USERNAME>/fastapi/server/` | The API source |
| `/home/<EC2_USERNAME>/fastapi/.venv/` | Python virtualenv (`pip`, `alembic`) |
| `/home/<EC2_USERNAME>/fastapi/.env` | Service configuration — **never touched by a deploy** |
| `/home/<EC2_USERNAME>/deploy-backups/` | Timestamped snapshots, `current` symlink |

Units: `fastapi.service` (Uvicorn) and `httpd` (Apache). Apache serves the
static site and proxies `/api`.

---

## Monitoring

| Signal | Where |
| :--- | :--- |
| `GET /health` | Liveness plus a real database round trip |
| `GET /system/pipeline` | Per-stage ingest health, no database cost — safe to poll |
| `X-Request-ID` | On every response; correlates to structured log lines |
| `Server-Timing: app;dur=` | Handler time, separable from network time |
| `journalctl -u fastapi.service` | Structured JSON application logs |
| `client_error` events | Client-side exceptions, forwarded through the analytics pipeline into `user_activity_events` |

**Pipeline health rules of thumb**

- `postgres.health == "error"` — check `last_error`, `dropped_overflow`,
  `dropped_rejected`. Overflow means the database was unavailable long enough to
  fill `MAX_BUFFERED_EVENTS`; rejected means writes were refused outright.
- `fastapi.dropped_frames` climbing — SSE consumers are slower than the event
  rate, or `SSE_QUEUE_MAXSIZE` is too small.
- `ingress.flush_reasons.unload` a large share — the client's timed flush is not
  keeping up and data is riding the unreliable unload path.
- `kafka.simulated == true` — the figures are modelled from real throughput, not
  broker-reported. Expected without a broker.

There is no external uptime monitor, alerting, or error-tracking service
configured in this repository.

---

## Runbook

### The site is down but `/api/health` is fine

Apache or the document root. Check `systemctl status httpd`, then confirm the
web root is populated. Compare the served `sw.js` cache version with the one the
last successful run built — a mismatch means a half-landed frontend sync.

### `/api/health` returns 503

Database unreachable. Check PostgreSQL, then `DATABASE_URL` on the host. Events
buffer in memory meanwhile (capped at `MAX_BUFFERED_EVENTS`) and flush when the
database returns; the overflow counter in `/system/pipeline` says how much was
lost.

### The API will not start after a deploy

Almost always import-time configuration. `journalctl -u fastapi.service -n 60`.
Look for a `RuntimeError` naming a missing variable, or `JWT_SECRET` being unset,
too short, or the placeholder. The automatic rollback should already have
restored the previous release.

### Visitors are signed out, or the API returns 429 after a few refreshes

Both causes are fixed in the code now; check that the deploy carrying them is
actually live before digging further.

The budget was a hardcoded 60/min and is now `RATE_LIMIT_PER_MINUTE`, default
**1000**, per client IP. "Per client" depends on `TRUSTED_PROXY_IPS`, which was
empty — and with it empty `client_ip_from_request` falls back to the direct
peer, the loopback address for **every** visitor behind Apache, so the budget
was one bucket for the whole site. It now defaults to `127.0.0.1,::1`. If a
`TRUSTED_PROXY_IPS=` line in the host's `.env` sets it back to empty, delete
that line — an explicit empty value still wins over the default. The same
setting decides the `ip_address` recorded on a session row, so a site whose
`user_sessions` rows all show one IP has the same cause and is the quickest way
to confirm it.

The activity dashboard is the chattiest page in the app — a single load fires
the session create or heartbeat, a bulk event flush, three `/sessions/{id}/…`
reads and the SSE stream, then a flush and an end call on unload — so it is
where a mis-scoped budget shows up first.

A 429 no longer signs anyone out: `auth.js` clears tokens only on a 401 or 403
from `/auth/refresh`. If visitors still report being logged out, look for a
genuine `401` — an expired or revoked refresh token, or `JWT_SECRET` having
been rotated out from under existing sessions.

### Chat returns 429 constantly

Either the per-IP chat budget (`CHAT_RATE_LIMIT_PER_MINUTE`) or Bedrock
concurrency. If the concurrency slots appear stuck with no traffic, restart the
service and check for a leaked slot — `BedrockSlot.release` is idempotent and
driven from two paths precisely to prevent that, and
`test_an_abandoned_streaming_response_does_not_leak_its_slot` guards it.

### The activity dashboard shows no live events

Check in order: is a session token present (`sessionStorage.rj_session_id` and
the `rj_session_token` cookie)? Does `GET /sessions/{id}/stream` return 429
(stream cap reached)? Does `/system/pipeline` show `fastapi.listeners > 0`? With
more than one API process, `ENABLE_PG_FANOUT` must be on or an event ingested by
one worker never reaches a listener on another.

### A migration failed mid-deploy

The rollback restores code but **not** schema. Read `alembic-revision` in the
snapshot directory for the pre-deploy revision, then decide manually whether to
downgrade. If the migration was written to be backward-compatible — as required
— the restored release runs correctly against the newer schema and there is
nothing urgent to do.

### CSP hash check fails

Someone edited an inline script in `index.html`, or Prettier reformatted it. Run
`python scripts/check_csp_hashes.py`; it prints the required
`'sha256-…'` value. Paste it into the `script-src` directive and re-run. If the
edit was accidental, revert instead.

---

### Someone is locked out of their account by 2FA

Their authenticator is gone and there is no way back in through the site: there
are no recovery codes, `disable` demands a live TOTP code, `/2fa/setup` refuses
to reissue a secret while one is enrolled, password reset does not touch the 2FA
columns, and the magic-link path re-challenges. `docs/review/2fa.md` finding 9
has the detail. Clear the factor for them — see
[Clear a lost second factor](#clear-a-lost-second-factor) below.

---

## Manual procedures

### Deploy without CI

Not recommended — it skips every gate. If unavoidable, follow the same order:
snapshot, build, verify sources are non-empty, rsync, install with
`--require-hashes`, `alembic upgrade head`, restart, probe health.

### Roll back further than one release

```bash
ls -1d ~/deploy-backups/20*/ | sort -r      # available snapshots
SNAP=~/deploy-backups/<stamp>
rsync -a --delete "$SNAP/server/" ~/fastapi/server/
sudo rsync -a --delete "$SNAP/html/" /var/www/html/
~/fastapi/.venv/bin/pip install --require-hashes -r ~/fastapi/server/requirements.txt
sudo systemctl restart fastapi.service httpd
cat "$SNAP/alembic-revision"                # schema revision at that point
```

### Rotate `JWT_SECRET`

Generate with `openssl rand -hex 32`, update the host `.env`, restart
`fastapi.service`. **Every** outstanding token becomes invalid: all users are
logged out, pending reset and magic links stop working, and every live analytics
session token is refused (browsers create fresh sessions automatically).

### Clear a lost second factor

For an account whose authenticator is gone. Runs on the host, against the
database — there is no self-service path (`docs/SECURITY.md`, "Known
limitations").

```bash
cd ~/fastapi
python scripts/clear_2fa.py --email someone@example.com
```

It prints the account's 2FA and lockout state, asks you to type the address back
to confirm, then clears `totp_secret`, `is_totp_enabled` and `totp_last_step` —
and with them both lockout tallies: `totp_failed_attempts` / `totp_locked_until`,
which the wrong codes that led here will normally have set, and
`failed_login_attempts` / `locked_until`, since an owner in this position has
usually been trying their password too. That is the state `disable_2fa` leaves
behind, so nothing downstream can tell an emergency unlock from an ordinary one.

| Flag | Effect |
| :--- | :--- |
| `--yes` | Skip the confirmation prompt. Also required for a soft-deleted account. |
| `--keep-sessions` | Leave existing logins and pending links alive. Off by default: the usual cause is a phone that is lost or wiped, and anything still authenticated on it should go with it. |

Needs `DATABASE_URL` and nothing else — it reads the ORM through
`server/config/env.py`, not `config/settings.py`, so it runs over SSH without
the service's `JWT_SECRET` or Bedrock configuration, the same way `alembic` does.

Two things it does not do. It **sends no security email** — the notification is
scheduled through `BackgroundTasks` inside the running service, so tell the
account holder yourself. And it leaves **no audit trail** beyond the timestamped
line it prints; there is no account-level audit log.

Afterwards the account signs in with email and password alone, and **Manage 2FA**
will hand out a fresh QR code and secret key for the new authenticator.

### Add or upgrade a Python dependency

```bash
# edit server/requirements.in (or requirements-dev.in), then regenerate BOTH:
uv pip compile server/requirements.in --universal \
  --python-version 3.10 --generate-hashes -o server/requirements.txt
uv pip compile server/requirements-dev.in --universal \
  --python-version 3.10 --generate-hashes -o server/requirements-dev.txt
```

`--universal` is required, not cosmetic — a single-version resolve pins
conditional packages unconditionally and breaks the moment CI and the host
disagree on Python. `test_dependency_locks.py` will fail otherwise.

### Update a vendored library

```bash
# bump the version in package.json, then:
npm install
cp node_modules/dompurify/dist/purify.min.js frontend/vendor/purify.min.js
cp node_modules/marked/marked.min.js         frontend/vendor/marked.min.js
```

### Re-subset the fonts

```bash
python -m pip install "fonttools[woff]"
python scripts/vendor_fonts.py     # needs network; output is committed
```

Run after adding an icon that is not already used anywhere on the site.
