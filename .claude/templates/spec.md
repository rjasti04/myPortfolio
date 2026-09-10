<!--
IMPORTANT INSTRUCTION FOR AI AGENTS:
DO NOT overwrite this template file (.claude/templates/spec.md).
When drafting or preparing a technical specification for a feature, create a new distinct file at:
  .claude/specs/YYYY-MM-DD-<feature-slug>.md
Create the .claude/specs/ directory if it does not already exist.
-->

# Technical Specification: [Feature Name]

**Related Intent**: [Link to `.claude/templates/intent.md` instance or PR description]
**Target Audience**: [Visitor / Recruiter / Work Sample / Owner]

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [ ] Frontend SPA (`frontend/js/`, `frontend/index.html`, `frontend/styles.css`)
  - [ ] Backend API (`server/routers/`, `server/services/`)
  - [ ] Database Schema (`server/models/`, `server/alembic/versions/`)
  - [ ] CI/CD & Deploy (`.github/workflows/deploy.yml`)

---

## 2. API Contract & Schemas
- **Route**: `[METHOD] /api/[path]`
- **Authentication**: `get_current_user` (Bearer JWT) | Deliberately Anonymous (Justify in ADR)
- **Request Model**:
  ```python
  # Pydantic v2 Schema
  ```
- **Response Model**:
  ```python
  # Pydantic v2 Schema
  ```
- **Error Responses**:
  - `401 Unauthorized`: Missing or invalid token
  - `422 Unprocessable Entity`: Schema validation failure
  - `429 Too Many Requests`: Rate limit hit

---

## 3. Database Schema & Migration Plan
- **Model Modifications**:
  - Table: `[table_name]` in `server/models/[file].py`
  - Columns / Constraints:
- **Migration Strategy**:
  - Alembic revision command: `PYTHONPATH=. alembic revision --autogenerate -m "..."`
  - Backward compatibility: Verify expand/contract approach so rollback doesn't fail.
  - Reversibility: `alembic upgrade head -> alembic downgrade -1 -> alembic upgrade head`.

---

## 4. Frontend Implementation & DOM Contract
- **Module Structure**: Pure ES module under `frontend/js/[module].js` exported functions.
- **State Management**: Scoped module state or session storage; no external state management libraries.
- **DOM Sanitization**: Any user-controlled strings injected into innerHTML must pass through `DOMPurify.sanitize()`.
- **Styling**: Vanilla CSS tokens in `frontend/styles.css` matching `docs/DESIGN.md`.

---

## 5. Security & Rate Limiting Review
- [ ] Rate limits configured on endpoints.
- [ ] No secrets logged or returned in payload.
- [ ] Inline script modifications accounted for in CSP hashes (`scripts/check_csp_hashes.py`).

---

## 6. Verification & Test Plan
- **Backend Unit / Integration Tests**: `tests/backend/unit/test_[...].py`
- **Frontend Tests**: `frontend/tests/[...].test.js`
- **Quality Gates**:
  ```bash
  npm run lint
  npm test
  $env:PYTHONPATH='.'; pytest
  python scripts/check_csp_hashes.py
  python scripts/check_docs.py --fix
  ```
