# AI Pull Request Review Instructions

When reviewing pull requests for `rjWebApp`, evaluate against the following core principles:

## 1. Architectural Integrity
- **ADR-001 (Vanilla ES Modules)**: Does the PR add any frontend framework, JSX, or unvetted build-time transform? If yes, flag as **Critical**.
- **ADR-016 (Zero Third-Party Assets)**: Does the PR introduce external script tags, stylesheets, Google Fonts links, or unvetted cdnjs URLs? If yes, flag as **Critical**.
- **ADR-023 (Server Owns Model & Token Ceilings)**: Does the frontend attempt to send model IDs, system prompts, or token limits to the backend? If yes, flag as **Critical**.

## 2. Security & Schema Safety
- **Authentication**: Are new endpoints protected by `get_current_user` unless explicitly listed in `docs/SECURITY.md` as anonymous?
- **CSP Integrity**: If `frontend/index.html` was touched, did inline script hashes change?
- **Database Migrations**: Does any change in `server/models/` include a matching Alembic migration with a single head? Is it non-destructive?
- **Input Sanitization**: Does dynamic content rendered to the DOM pass through `DOMPurify.sanitize()`?

## 3. Review Output Format
Reviews must be structured, concise, and actionable with zero conversational filler:

| Category | Severity | Location | The "Why" | The Fix |
| :--- | :--- | :--- | :--- | :--- |
| Bug / Security / Performance / Architecture | Critical / High / Medium / Low | `path/file:line` | Concise rationale | Snippet or suggested diff |
