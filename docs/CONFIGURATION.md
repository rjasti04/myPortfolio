# Configuration Reference

Every environment variable the backend reads, plus the CI/CD secrets and the
frontend's (buildless) configuration. `.env.example` is the annotated template;
this is the exhaustive list.

- [How configuration is loaded](#how-configuration-is-loaded)
- [Required](#required)
- [Networking and CORS](#networking-and-cors)
- [Request limits](#request-limits)
- [Chat and Bedrock](#chat-and-bedrock)
- [Activity ingest pipeline](#activity-ingest-pipeline)
- [Server-sent events](#server-sent-events)
- [Multi-instance fan-out](#multi-instance-fan-out)
- [Outbound email](#outbound-email)
- [Logging and test mode](#logging-and-test-mode)
- [AWS credentials](#aws-credentials)
- [CI/CD secrets and variables](#cicd-secrets-and-variables)
- [Frontend configuration](#frontend-configuration)
- [Client/server values that must agree](#clientserver-values-that-must-agree)

---

## How configuration is loaded

- **The API** reads `os.environ` directly. It does **not** load `.env` itself —
  in production `systemd` supplies the environment. For local development,
  export the variables or use a `.env` loader in your shell/process manager.
- **Alembic** does load `.env` — `server/alembic/env.py` calls
  `load_dotenv()` on the repository root `.env` and then `server/.env`, because
  the deploy runs migrations over SSH without the service's environment.
- **Validation is at import time and fatal.** `server/config/settings.py` raises
  `RuntimeError` for a missing required value, a `JWT_SECRET` that is too short
  or is the published placeholder, and any integer setting that is non-numeric
  or ≤ 0 (`config/env.py::env_int`). There are no fallbacks.
- Booleans are read as case-insensitive `"true"`; anything else is false.

---

## Required

The service refuses to start without all four.

| Variable | Example | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@host:5432/db` | The `+asyncpg` driver marker is required. Also read by Alembic and (with the marker stripped) by the `LISTEN/NOTIFY` fan-out |
| `AWS_REGION` | `us-east-1` | Region for both Bedrock clients |
| `DEFAULT_MODEL_ID` | `us.anthropic.claude-3-5-sonnet-20241022-v2:0` | Default chat model; always added to the allowlist |
| `JWT_SECRET` | `openssl rand -hex 32` | Signs **every** token: access, refresh, password reset, magic link, 2FA pre-auth — **and** the HMAC analytics session tokens |

`JWT_SECRET` is rejected if it is unset/blank, shorter than 32 characters, or
equal to the placeholder that once shipped in this repository (any token signed
with that value must be treated as forgeable). **Rotating it invalidates every
outstanding token, logs everyone out, and invalidates every live analytics
session token.**

---

## Networking and CORS

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `CORS_ORIGINS` | a localhost dev list | Comma-separated allowed browser origins. `https://rjasti.com` and `https://www.rjasti.com` are **always** appended |
| `TRUSTED_PROXY_IPS` | *(empty)* | Comma-separated IPs/CIDRs whose `X-Forwarded-For` is honoured. Invalid entries are logged and skipped |

When `CORS_ORIGINS` is unset the default list is
`http://localhost:{1111,8080,8000,3000,5173,5500}` and the matching `127.0.0.1`
forms.

`TRUSTED_PROXY_IPS` matters for two things: the `ip_address` stored on a session
row, and the key the rate limiter buckets by. With it empty, both use the direct
peer — which behind a reverse proxy means every request looks like one client.

---

## Request limits

| Variable | Default | Purpose |
| :--- | ---: | :--- |
| `MAX_BODY_BYTES` | `1048576` | Request body ceiling; over it → **413** |
| `MAX_STREAMS_PER_SESSION` | `2` | Concurrent SSE connections one analytics session may hold; over it → **429** |

`MAX_STREAMS_PER_SESSION` exists because a session token is free (`POST
/sessions` is unauthenticated by design) and an open stream holds a worker slot
for as long as it lasts. Two is enough for a real visitor with the dashboard
open in a second tab.

The general (60/min) and auth (5/min) rate budgets are **not** environment
configurable — they are the `RateLimitMiddleware` constructor default and a
hardcoded constant respectively.

---

## Chat and Bedrock

| Variable | Default | Purpose |
| :--- | ---: | :--- |
| `ALLOWED_MODEL_IDS` | *(empty)* | Extra allowlisted Bedrock model ids, comma-separated |
| `CHAT_MAX_CONCURRENCY` | `4` | Concurrent Bedrock streams across the process; over it → **429** |
| `CHAT_FREE_MESSAGE_LIMIT` | `6` | User-role messages an unauthenticated caller may send before **401** |
| `CHAT_RATE_LIMIT_PER_MINUTE` | `12` | Per-IP requests/min against `/chat`, `/chat/`, `/chat/stream`, `/chat/summarize` |
| `CHAT_STREAM_QUEUE_SIZE` | `128` | Bounded queue between the Bedrock reader thread and the SSE response |
| `BEDROCK_TIMEOUT_SECONDS` | `30` | Bedrock read timeout (connect timeout is a fixed 10 s) |
| `BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS` | `10` | How long the reader thread waits for queue room before concluding the client is gone |

The effective allowlist is always `ALLOWED_MODEL_IDS` ∪ `{DEFAULT_MODEL_ID,
google.gemma-3-4b-it, anthropic.claude-3-5-sonnet-20241022-v2:0}`.

`CHAT_RATE_LIMIT_PER_MINUTE` paired with the size ceilings in
`server/schemas/chat.py` (60 messages, 8,000 chars each, 24,000 total) is what
bounds the worst case an anonymous IP can bill to the Bedrock account. Roughly
one message every five seconds — no real conversation exceeds it.

---

## Activity ingest pipeline

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `KAFKA_BOOTSTRAP_SERVERS` | *(empty)* | Broker list. Empty → the consumer falls back to the simulator/modelled mode |
| `KAFKA_TOPIC` | `session-activity` | Activity topic |
| `KAFKA_BATCH_SIZE` | `10` | Rows buffered before an eager flush |
| `KAFKA_BATCH_TIMEOUT` | `3.0` | Periodic flush interval, seconds — this is what writes any batch smaller than `KAFKA_BATCH_SIZE` |
| `KAFKA_LAG_SAMPLE_INTERVAL` | `5.0` | How often consumer lag is sampled. Diagnostic only; sampled on a timer because measuring per message cost more than consuming |
| `MAX_BUFFERED_EVENTS` | `10000` | Ceiling on events held in memory awaiting a write. At the cap the **oldest** are dropped and counted |
| `ENABLE_EVENT_SIMULATOR` | `false` | Generate mock events when no broker is configured. Only emits while there are active SSE listeners |
| `SIMULATE_KAFKA_METRICS` | `true` | Model the Kafka stage's figures from real throughput. `false` reports an honest `bypass` |
| `SIMULATED_KAFKA_PARTITIONS` | `3` | Partitions the modelled topic presents |
| `SIMULATED_KAFKA_GROUP` | `activity-dashboard` | Modelled consumer group name |

Browser events reach PostgreSQL through `POST /events/bulk` whether or not a
broker exists — Kafka is an optional additional source, never the only path.

`MAX_BUFFERED_EVENTS` guards the one failure mode guaranteed to take the API
down alongside the database: a failed flush returns its events to the buffer, so
without a cap a database outage grows it until the process runs out of memory.
Losing the tail of a backlog beats losing the service; the drops are counted and
surfaced by `/system/pipeline`.

---

## Server-sent events

| Variable | Default | Purpose |
| :--- | ---: | :--- |
| `SSE_QUEUE_MAXSIZE` | `100` | Per-listener frame backlog. At the cap the oldest frame is dropped |
| `SSE_REPLAY_BUFFER` | `200` | Per-session `Last-Event-ID` resume ring |
| `SSE_REPLAY_TTL` | `300` | Seconds a disconnected session's resume ring is kept |

`SSE_REPLAY_TTL` is comfortably longer than the 3 s client reconnect delay and
short enough to bound memory. Non-configurable companions live in
`event_controller`: keep-alive at 15 s, pipeline frames every 2 s,
`retry: 3000` advertised on connect.

---

## Multi-instance fan-out

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `ENABLE_PG_FANOUT` | `false` | Relay SSE broadcasts between API instances over Postgres `LISTEN/NOTIFY` |
| `PG_FANOUT_CHANNEL` | `activity_events` | `NOTIFY` channel name |
| `HOSTNAME` | process id | Read to build `INSTANCE_ID`, which stops a process delivering its own notification twice |

Only needed with more than one API process serving the same clients. On a single
instance it is **pure overhead** — the in-memory registry already fans out.
Payloads above 7800 bytes stay local rather than killing the notification
(PostgreSQL caps `NOTIFY` payloads at 8000 bytes).

---

## Outbound email

Password-reset and magic-link delivery, plus the password-change security
notification.

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SMTP_HOST` | `127.0.0.1` | Relay host |
| `SMTP_PORT` | `25` | Relay port |
| `SMTP_USER` | *(unset)* | With `SMTP_PASSWORD`, enables STARTTLS + certificate validation |
| `SMTP_PASSWORD` | *(unset)* | See above |
| `EMAILS_FROM_EMAIL` | `inboxtorj@gmail.com` | `From` header |

Certificate validation is **on for anything that is not loopback**, whether or
not credentials are supplied. These messages carry live account-recovery
credentials, so a man-in-the-middle on the relay is an account takeover.

A send failure is logged and swallowed, never surfaced: the recovery endpoints
answer identically whether or not an address exists, and "your mail server is
down" through that channel would leak which addresses are real. Tokens are
logged only as a 12-character digest.

---

## Logging and test mode

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL`. Applied by `setup_logging()`, called from `main.py` |
| `TESTING` | *(unset)* | `true` disables rate limiting **and** stops the three background pipeline tasks from starting |
| `TEST_DATABASE_URL` | `sqlite+aiosqlite:///:memory:?cache=shared` | Read by `tests/backend/conftest.py` only |

**Never set `TESTING=true` in production.** It disables the rate limiter
entirely.

Logs are structlog → JSON, so every line carries `request_id`, `event`,
`timestamp` and `level` and is aggregator-ready.

---

## AWS credentials

Not read directly by application code — boto3 resolves them through its standard
chain (environment variables, shared credentials file, or the EC2 instance
profile, which is what production uses).

Required permissions:

| Action | Used by |
| :--- | :--- |
| `bedrock:ListFoundationModels` | `GET /models` |
| `bedrock:InvokeModelWithResponseStream` | Anthropic models on `/chat/stream` |
| `bedrock:InvokeModel` / Converse stream | Non-Anthropic models on `/chat/stream` |

---

## CI/CD secrets and variables

Consumed by `.github/workflows/deploy.yml`.

### Secrets

| Name | Purpose |
| :--- | :--- |
| `EC2_HOST` | Deployment target hostname |
| `EC2_USERNAME` | SSH user; also derives `REMOTE_APP_DIR` (`/home/<user>/fastapi`) |
| `EC2_SSH_KEY` | Private key |
| `EC2_HOST_KEY` | **Optional but recommended.** Pinned host key. Without it the workflow falls back to `ssh-keyscan` — trust-on-first-use on every run — and emits a warning. Capture it with `ssh-keyscan -H <host>` |

### Repository variables

| Name | Default | Purpose |
| :--- | :--- | :--- |
| `HEALTH_CHECK_URL` | `https://rjasti.com/api/health` | Probed after restart; the site URL for the smoke test is derived from it |

### On the deployment host

The API's own environment (including `JWT_SECRET`) is supplied by `systemd`, not
by the workflow. The deploy's rsync explicitly **excludes `.env*`**, so host
configuration is never overwritten by a deploy. A virtualenv is expected at
`$REMOTE_APP_DIR/.venv` with `pip` and `alembic` on hand.

---

## Frontend configuration

There is no build-time configuration and no `window.APP_CONFIG`. Two values are
resolved at runtime:

| Value | Source |
| :--- | :--- |
| API base | `getApiBaseUrl()` in `frontend/js/analytics.js`, from `window.location.hostname` |
| Contact address | `CONTACT_EMAIL` in `frontend/js/config.js` |

| Hostname | API base |
| :--- | :--- |
| `localhost`, `127.0.0.1`, `[::1]` | `http://localhost:8000`, falling back to production if `/health` fails |
| contains `staging` | `https://staging-api.rjasti.com/api` |
| origin contains `www.` | `https://www.rjasti.com/api` |
| anything else | `https://rjasti.com/api` |

`CONTACT_EMAIL` is **also hardcoded** in `index.html` — in the mailto links, the
JSON-LD structured data, the connect menu and the FormSubmit `action`. Changing
it means changing both.

Adding a new API origin also requires adding it to the `connect-src` directive
of the CSP in `index.html`.

---

## Client/server values that must agree

| Client | Server | Consequence of drift |
| :--- | :--- | :--- |
| `FREE_MESSAGE_LIMIT = 6` (`chat.js`) | `CHAT_FREE_MESSAGE_LIMIT` | The UI either asks for a login too early, or lets the user type a message the API will reject with 401 |
| `SUMMARIZE_TOKEN_THRESHOLD = 6000` (`chat.js`) | `MAX_TOTAL_CONTENT_CHARS = 24000` | If the client threshold rises above the server cap, long conversations start failing with 422 |
| `SESSION_FETCH_LIMIT = 500` (`activity.js`) | `limit` ≤ 500 on the events list | A larger client value yields 422 |
| Event type strings emitted by the frontend | `EVENT_TYPES` in `schemas/event.py` | The event is counted in `rejected[]` and lost; the rest of the batch survives |
| API origins in `getApiBaseUrl()` | `CORS_ORIGINS` + the always-appended production domains | The browser blocks the request |
| API origins in `getApiBaseUrl()` | `connect-src` in the `index.html` CSP | The browser blocks the request before it is sent |
