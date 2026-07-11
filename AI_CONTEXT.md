# AI Development Context Guide (rjWebApp)

Welcome! This document provides architectural context, development constraints, and testing procedures for rjWebApp. Refer to this before planning any changes.

## 1. Core Architecture & Tech Stack
*   **Frontend**: Single-page portfolio PWA built with vanilla ES modules, CSS, and Three.js.
    *   *Key Files*: `frontend/index.html` (main structure), `frontend/js/main.js` (entry point), `frontend/styles.css` (global styles).
*   **Backend**: FastAPI ASGI service using SQLAlchemy (async engine + asyncpg driver) and AWS Amazon Bedrock.
    *   *Key Files*: `server/main.py` (FastAPI app & routes), `server/models/` (DB schemas), `server/alembic/` (migrations).
    *   *Note*: Refer to `docs/ADR.md` for historical and updated architectural decisions (e.g., transition from raw SQL to SQLAlchemy ORM).

## 2. Environment Variables & Setup
To run the server locally, create a `.env` file in the root with:
```bash
DATABASE_URL=postgresql+asyncpg://<user>:<password>@localhost:5432/<dbname>
AWS_REGION=us-east-1
DEFAULT_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0 # Or equivalent Bedrock ID
TESTING=false
```

## 3. Autonomous Testing Workflow

### Python Backend Tests
Tests are located in `tests/backend/` and use `pytest` with SQLite in-memory db.
*   **Command**: 
    ```powershell
    $env:PYTHONPATH='.'; & 'server/.venv/Scripts/pytest.exe' tests/backend/
    ```
*   **Crucial Constraints**:
    1.  `PYTHONPATH` must include the root directory (`.`).
    2.  `TESTING=true` must be set to bypass the rate-limiting middleware (now automatically injected in `conftest.py`).
    3.  `DATABASE_URL`, `AWS_REGION`, and `DEFAULT_MODEL_ID` must be mocked in the test environment to bypass import-time configuration validations in `server/main.py` (now automatically injected in `conftest.py`).

### JavaScript Frontend Tests
*   **Command**: `npm test` (Runs `node --test frontend/tests/*.test.js` under JSDOM environment).
*   *Note*: Node.js and npm are not in the default system PATH. Ensure Node paths are resolved if running these locally.
