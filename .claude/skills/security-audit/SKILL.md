---
name: security-audit
description: Security verification checklist covering authentication boundaries, Content Security Policy (CSP) hashes, rate limits, and DOM sanitization in rjWebApp.
---

# Security Audit Protocol

Before finalizing any changes touching authentication, session tokens, rate limits, API routes, or user-controlled DOM rendering:

## 1. Authentication & Authorization Boundaries
- **Default Deny**: Every endpoint accessing or modifying user state must require `user: User = Depends(get_current_user)` from `server/auth/dependencies.py`.
- **Deliberately Anonymous Endpoints**: Only two endpoints are allowed to be anonymous without a token:
  - `POST /chat` (uses `get_optional_current_user` to shield visitor demo).
  - `POST /sessions` (creates initial session identifier).
  - Do NOT add authentication to these two endpoints (this is an explicit non-goal in `AGENTS.md` and `docs/SECURITY.md`).
- **Secret Hygiene**: Ensure `JWT_SECRET` is never hardcoded and meets the 32-character minimum enforced by `server/config/settings.py`.

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
- [ ] Python ruff lint passes: `ruff check server tests`.
