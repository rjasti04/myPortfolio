# AI Development Context Guide (rjWebApp)

Welcome! This document provides architectural context, development constraints, and testing procedures for rjWebApp. Refer to this before planning any changes.

## 1. Core Architecture & Tech Stack
*   **Frontend**: Single-page portfolio PWA built with vanilla ES modules, CSS, and Three.js.
    *   *Key Files*: `frontend/index.html` (main structure), `frontend/js/main.js` (entry point), `frontend/js/chat.js` (SSE stream reader & DOMPurify markdown parser), `frontend/styles.css` (global styles).
*   **Backend**: FastAPI ASGI service using SQLAlchemy (async engine + asyncpg driver) and AWS Amazon Bedrock.
    *   *Key Files*: `server/main.py` (FastAPI app & routes), `server/services/bedrock_service.py` (Bedrock prompt caching & streaming service), `server/routes/chat_routes.py` (SSE `/api/chat/stream` endpoint), `server/models/` (DB schemas).

## 2. AWS Bedrock Prompt Caching & Observability
*   **Prompt Caching**:
    *   Bedrock system prompts and portfolio knowledge base use Anthropic prompt caching (`cache_control: {"type": "ephemeral"}`).
    *   Reduces Time to First Token (TTFT) by ~80% and cuts prompt token billing by 90% on cache hits (5-minute sliding TTL).
*   **Streaming & Telemetry**:
    *   Endpoint `/api/chat/stream` returns Server-Sent Events (`text/event-stream`).
    *   Each completion finishes with a `metrics` payload yielding input tokens, output tokens, cache read tokens, latency (ms), and cache hit status.
    *   Telemetry metrics are automatically logged to PostgreSQL under `user_activity_events` (`event_type: "ai_llm_telemetry"`).

## 3. Environment Variables & Setup
To run the server locally, create a `.env` file in the root with:
```bash
DATABASE_URL=postgresql+asyncpg://<user>:<password>@localhost:5432/<dbname>
AWS_REGION=us-east-1
DEFAULT_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
TESTING=false
```

## 4. Autonomous Testing Workflow

### Python Backend Tests
Tests are located in `tests/backend/` and use `pytest` with SQLite in-memory db.
*   **Command**: 
    ```powershell
    $env:PYTHONPATH='.'; & 'server/.venv/Scripts/pytest.exe' tests/backend/
    ```
*   **Crucial Constraints**:
    1.  `PYTHONPATH` must include the root directory (`.`).
    2.  `TESTING=true` must be set to bypass rate-limiting middleware (automatically injected in `conftest.py`).
    3.  `DATABASE_URL`, `AWS_REGION`, and `DEFAULT_MODEL_ID` are mocked in test fixtures (`conftest.py`).

### JavaScript Frontend Tests
*   **Command**: `npm test` (Runs `node --test frontend/tests/*.test.js` under JSDOM environment).
