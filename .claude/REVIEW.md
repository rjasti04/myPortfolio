# AI Pull Request Review Instructions

When reviewing pull requests for `rjWebApp`, evaluate against the following core principles:

## 1. Architectural Integrity
These are the standing non-goals in `AGENTS.md`, phrased as review questions. If
one appears to be wrong, argue it against the ADR - do not silently pass it.

- **ADR-001 (Vanilla ES Modules)**: Does the PR add any frontend framework, JSX, or unvetted build-time transform? If yes, flag as **Critical**.
- **ADR-016 (Zero Third-Party Assets)**: Does the PR introduce external script tags, stylesheets, Google Fonts links, or unvetted cdnjs URLs? If yes, flag as **Critical**.
- **ADR-023 (Server Owns Model & Token Ceilings)**: Does the frontend attempt to send model IDs, system prompts, or token limits to the backend? If yes, flag as **Critical**.

## 2. Security & Schema Safety
- **Authentication**: Is every new endpoint in one of the three guard tiers (`get_current_user`, `require_owner`, `require_session_access`) unless `docs/SECURITY.md` lists it as anonymous? Check `server/controllers/` too: `session_routes.py`, `system_routes.py` and `event_routes.py` register handlers with `router.add_api_route(...)`, so a `@router`-only grep misses them. The `security-audit` skill has the full checklist.
- **CSP Integrity**: If `frontend/index.html` was touched, did inline script hashes change?
- **Database Migrations**: Does any change in `server/models/` include a matching Alembic migration with a single head? Is it non-destructive?
- **Input Sanitization**: Does dynamic content rendered to the DOM pass through `DOMPurify.sanitize()`?

## 3. Review Output Format
Use the finding table defined in `AGENTS.md` §5, with zero conversational filler.
It is defined once there so the columns cannot drift between this file, the
`review` skill and the reviewer subagents.
