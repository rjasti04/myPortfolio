---
name: security-audit
description: Security verification checklist covering authentication boundaries, Content Security Policy (CSP) hashes, rate limits, and DOM sanitization in rjWebApp.
---

# Security Audit Protocol

Before finalizing any changes touching authentication, session tokens, rate limits, API routes, or user-controlled DOM rendering:

## 1. Authentication & Authorization Boundaries

`docs/SECURITY.md` is the source of truth for the model; this is the checklist.

### Find every endpoint first

Routes are registered two ways, and grepping for only the first misses ten of
them:

```bash
grep -rn --exclude-dir=.venv -E '@router\.(get|post|put|patch|delete)' server/routes
grep -rn --exclude-dir=.venv 'add_api_route' server/routes
```

`session_routes.py`, `system_routes.py` and `event_routes.py` use
`router.add_api_route(...)`, so their handlers - and the dependencies that guard
them - live in `server/controllers/`, not next to the route.

### The three guard tiers

| Tier | Dependency | Guards |
| :--- | :--- | :--- |
| Account | `get_current_user` (`server/auth/dependencies.py`) | Anything reading or writing a user's own data |
| Owner | `require_owner` (wraps `get_current_user`) | The four `/analytics/*` routes |
| Session capability | `require_session_access` (`server/auth/session_token.py`) | `PATCH /sessions/{id}/heartbeat`, `PATCH /sessions/{id}/end`, `GET /sessions/{id}`, `/events*` - an HMAC token issued once at session creation, because these exist to track anonymous visitors and cannot require a login |

A new endpoint that touches user or session state must sit in one of these three.
Adding an endpoint that reads a `session_id` from the URL and checks nothing else
is the exact bug `require_session_access` was introduced to close.

### Deliberately unauthenticated

- `POST /chat` (`get_optional_current_user`) and `POST /sessions`. Do **not** add
  auth to these - it is a standing non-goal in `AGENTS.md`. The guard is the cost
  budget and stream cap, not a login.
- The account-recovery surface, which cannot require a token by definition:
  `/register`, `/verify-email`, `/resend-verification`, `/login`, `/refresh`,
  `/2fa/verify`, `/magic-link/request`, `/magic-link/verify`, `/forgot-password`,
  `/reset-password`.
- `POST /contact`.
- `POST /chat/summarize` (`server/routes/chat_routes.py`) - **needs no auth, and
  takes no db and no session binding while calling Bedrock.** Like `POST /chat`,
  it refuses an anonymous request past `CHAT_FREE_MESSAGE_LIMIT` user turns
  (`enforce_free_message_limit`) before it takes a concurrency slot. It is still
  a second anonymous inference path, so treat any change that widens it as a
  cost-exposure change.

**Secret Hygiene**: `JWT_SECRET` is never hardcoded and meets the 32-character
minimum enforced by `server/config/settings.py`.

## 2. Content Security Policy (CSP) Integrity
- The SPA enforces an ultra-strict CSP with pinned SHA-256 script hashes in `frontend/index.html`.
- **Inline Scripts**: Editing or reformatting inline `<script>` tags in `frontend/index.html` invalidates the sha256 hash and blocks browser execution silently.
- Whenever editing `frontend/index.html`:
  ```bash
  python3 scripts/check_csp_hashes.py
  ```
  If it fails, copy the exact computed `sha256-...` hash from the output and update the `script-src` directive in `frontend/index.html`.

## 3. DOM Injection & XSS Prevention
- All user-controlled text or dynamic AI output rendered into the DOM must pass through `DOMPurify.sanitize()`.
- Vendored libraries (`DOMPurify` and `marked`) are strictly self-hosted; never import from CDNs.

## 4. Rate Limiting & Denial-of-Service Defense
- All public endpoints must have rate-limiting middleware coverage (`server/middlewares/rate_limit.py`).
- Request payloads must have strict Pydantic length limits (`max_length` on strings) to avoid CPU/memory exhaustion.

## 5. Security Checklist
- [ ] No hardcoded passwords, tokens, or private keys.
- [ ] No third-party network egress added (only `formsubmit.co` contact form fallback is allowed).
- [ ] No request schema accepts a model id, a system prompt or an inference setting from the client (ADR-023). `test_chat_request_carries_nothing_the_server_owns` pins the chat request's fields and roles.
- [ ] Python ruff lint passes: `ruff check server tests`.
