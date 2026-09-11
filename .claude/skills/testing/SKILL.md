---
name: testing
description: Canonical decision protocol and commands for running targeted and full test suites across frontend, backend, database, and documentation layers.
---

# Testing Strategy & Decision Procedure

Use this protocol to select and execute the appropriate quality gates for changes in `rjWebApp`.

## 1. Impacted Layer Selection Matrix

Identify modified files and run the corresponding targeted tests first:

| Impacted Area | Trigger Files | Targeted Command |
| :--- | :--- | :--- |
| **Frontend** | `frontend/js/**`, `frontend/*.html`, `frontend/*.css` | `npm run lint` && `npm test` |
| **Backend** | `server/**/*.py`, `tests/backend/**` | `ruff check server tests` && `PYTHONPATH=. pytest` |
| **Database** | `server/models/**`, `server/alembic/**` | `cd server && PYTHONPATH=.. alembic check` |
| **CSP / Docs** | `docs/*.md`, `frontend/index.html` | `python3 scripts/check_csp_hashes.py` && `python3 scripts/check_docs.py` |

## 2. Escalation & Full Gate Protocol

Run the full suite before submitting PRs or completing significant features:

1. **Frontend Full Gate**:
   ```bash
   npm run lint
   npm test
   npm run build
   ```
2. **Backend Full Gate**:
   ```bash
   ruff check server tests
   PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55
   ```
3. **Database Migration Full Verification (CI Equivalent)**:
   ```bash
   cd server
   PYTHONPATH=.. alembic upgrade head
   PYTHONPATH=.. alembic check
   PYTHONPATH=.. alembic downgrade -1
   PYTHONPATH=.. alembic upgrade head
   cd ..
   ```
4. **Documentation & Hash Invariants**:
   ```bash
   python3 scripts/check_csp_hashes.py
   python3 scripts/check_docs.py --fix --show-tokens
   ```
