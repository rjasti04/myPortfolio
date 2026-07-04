# Tasks: Authentication & Database Security Hardening

- [x] Create token database model (`RefreshToken`)
- [x] Export RefreshToken model in `server/models/__init__.py`
- [x] Implement password length bypass/pre-hashing and JWT JTI support in `server/auth/security.py`
- [x] Fix HTTPException swallowing in `server/auth/dependencies.py`
- [x] Add email lowercase normalization and refresh token rotation/revocation handling in `server/services/auth_service.py`
- [x] Update `/auth/logout` endpoint in `server/routers/auth.py`
- [x] Upgrade rate limiting in `server/main.py`
- [/] Generate and apply Alembic migration for `refresh_tokens` table
- [ ] Verify using automated tests and manual checks
