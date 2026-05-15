# rjWebApp

Personal portfolio web app for Rajeev Jasti. The frontend is a static single-page
site with responsive navigation, project filtering, a contact flow, PWA assets,
session activity views, and an AI chat interface. The optional backend is a
FastAPI service for activity tracking and Amazon Bedrock-powered chat.

## Tech Stack

- Frontend: HTML, CSS, JavaScript modules, Three.js, service worker, web app manifest
- Backend: FastAPI, asyncpg/PostgreSQL, Pydantic, boto3/Amazon Bedrock, structlog
- Tooling: Node.js test runner, jsdom, ESLint, Stylelint, Prettier

## Project Structure

```text
.
|-- index.html              # Main portfolio page
|-- styles.css              # Global styles and responsive layout
|-- sw.js                   # Service worker for app-shell caching
|-- manifest.json           # PWA metadata
|-- js/                     # Frontend modules
|-- server/main.py          # FastAPI activity and chat API
|-- server/requirements.txt # Backend Python dependencies
|-- tests/                  # Node.js unit tests
|-- scripts/                # Image maintenance helpers
|-- docs/                   # Supporting documentation
```

## Prerequisites

- Node.js 18+
- npm
- Python 3.10+
- PostgreSQL database for the API
- AWS credentials with Amazon Bedrock access if chat endpoints are enabled

The FastAPI service uses SQLAlchemy ORM and Alembic for database migrations.

## Install

```bash
npm install
python -m pip install -r server/requirements.txt
```

### Database Migrations

Apply database migrations to set up the `users`, `user_sessions`, and `user_activity_events` tables:

```bash
export DATABASE_URL="postgresql+asyncpg://user:password@host:5432/dbname"
cd server
alembic upgrade head
```

## Run the Frontend Locally

Serve the repository root so JavaScript modules and service worker behavior use
normal browser security rules:

```bash
python -m http.server 8080
```

Open `http://localhost:8080`.

## Run the API Locally

Set the required environment variables before starting Uvicorn.

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://user:password@host:5432/dbname"
$env:AWS_REGION="us-east-1"
$env:DEFAULT_MODEL_ID="your-bedrock-model-id"
python -m uvicorn server.main:app --reload
```

Bash:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/dbname"
export AWS_REGION="us-east-1"
export DEFAULT_MODEL_ID="your-bedrock-model-id"
python -m uvicorn server.main:app --reload
```

## API Configuration

Required:

- `DATABASE_URL`: PostgreSQL connection string used by asyncpg
- `AWS_REGION`: AWS region for Bedrock clients
- `DEFAULT_MODEL_ID`: default Bedrock model ID used by chat endpoints

Optional:

- `JWT_SECRET`: Secret key used for signing JSON Web Tokens. Crucial for production security.
- `ALLOWED_MODEL_IDS`: comma-separated allowlist of Bedrock model IDs
- `CORS_ORIGINS`: comma-separated browser origins allowed by FastAPI CORS
- `TRUSTED_PROXY_IPS`: comma-separated proxy IPs/CIDRs trusted for `X-Forwarded-For`
- `MAX_BODY_BYTES`: request body limit, default `1048576`
- `CHAT_MAX_CONCURRENCY`: concurrent chat stream limit, default `4`
- `CHAT_STREAM_QUEUE_SIZE`: async streaming queue size, default `32`
- `BEDROCK_TIMEOUT_SECONDS`: Bedrock read timeout, default `30`
- `BEDROCK_QUEUE_PUT_TIMEOUT_SECONDS`: stream queue put timeout, default `2`
- `LOG_LEVEL`: Python logging level, default `INFO`

The frontend currently points API calls at `https://rjasti.com/api` in
`js/analytics.js`. Change `API_BASE` there when testing against a different API
host.

## Available Scripts

```bash
npm run lint          # Run JavaScript and CSS linters
npm run lint:js       # Lint js/*.js
npm run lint:css      # Lint CSS files
npm run format        # Format supported files with Prettier
npm run format:check  # Check formatting without writing
npm test              # Run Node.js unit tests
npm run audit         # Check npm packages for high-severity advisories
```

## Backend Endpoints

**Authentication Endpoints:**
- `POST /auth/register`: Create a new user account
- `POST /auth/login`: Authenticate and receive JWT access/refresh tokens
- `POST /auth/refresh`: Obtain a new access token using a refresh token
- `POST /auth/logout`: Invalidate client-side tokens
- `GET /auth/me`: Retrieve current user profile

**Activity and Chat Endpoints:**
- `GET /health`: API and database health check
- `POST /sessions`: create an activity session
- `PATCH /sessions/{session_id}/heartbeat`: refresh session activity
- `PATCH /sessions/{session_id}/end`: end a session
- `GET /sessions/{session_id}`: fetch session metadata
- `POST /events`: record one activity event
- `POST /events/bulk`: record up to 500 activity events
- `GET /sessions/{session_id}/events`: list events for a session
- `POST /chat`: stream a Bedrock chat response (Restricted after 6 messages for anonymous users)
- `POST /chat/summarize`: summarize chat history through Bedrock (Restricted after 6 messages for anonymous users)
- `GET /models`: list available Bedrock foundation models

### Authentication Flow
The application uses stateless JWTs for authentication. Unauthenticated users are allowed to send up to 6 AI chat messages before a login modal triggers. The frontend persists tokens in `localStorage` and silently intercepts expired token errors (HTTP 401) to request a new token via the `/auth/refresh` endpoint seamlessly.

## Deployment Notes

- The static frontend can be hosted by any static web server or CDN.
- The service worker caches local app-shell assets and selected third-party CDN
  resources. Bump `CACHE_NAME` in `sw.js` when changing cached asset behavior.
- API responses are intentionally excluded from service worker caching.
- The backend has no application-level authentication. Keep it behind trusted
  routing, firewall/security-group rules, or a reverse proxy unless public access
  is intentional.
- The in-memory rate limiter is suitable for a single API instance. Use a shared
  store such as Redis for multi-instance deployments.

## Maintenance Helpers

Image helper scripts live in `scripts/` and require Pillow:

```bash
python -m pip install Pillow
python scripts/verify_images.py
python scripts/optimize_images.py
```

`optimize_images.py` writes optimized image files and creates timestamped backups
under `backups/`.

## Data and AWS Impact

This README is documentation only. It does not modify database schemas, data
pipelines, IAM roles, VPC settings, Bedrock configuration, or other AWS
infrastructure.
