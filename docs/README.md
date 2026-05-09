# rjWebApp

A single-page portfolio web application with responsive section navigation, an accessible project detail modal, progressive enhancement for no-JS browsing, and contact-first calls to action.

## Getting started

### Prerequisites
- **Node.js 18+** and **npm** — required for running tests (`jsdom`), linting, and formatting

### Install dependencies
```bash
npm install
python -m pip install -r requirements.txt
```

### Run locally
Open `index.html` directly in a browser, or serve the folder with your preferred static server.

Example using Python:
```bash
python -m http.server 8080
```
Then open `http://localhost:8080`.

### Run the API
Set the required API environment variables before starting ASGI:

```powershell
$env:DATABASE_URL="postgresql://user:password@host:5432/dbname"
$env:AWS_REGION="us-east-1"
$env:DEFAULT_MODEL_ID="your-bedrock-model-id"
python -m uvicorn server.main:app
```

Optional hardening knobs:
- `ALLOWED_MODEL_IDS` - comma-separated Bedrock model IDs allowed from API requests.
- `CORS_ORIGINS` - comma-separated browser origins allowed by FastAPI CORS.
- `TRUSTED_PROXY_IPS` - comma-separated proxy IPs/CIDRs allowed to supply `X-Forwarded-For`.
- `MAX_BODY_BYTES`, `CHAT_MAX_CONCURRENCY`, and `BEDROCK_TIMEOUT_SECONDS` - request and chat safety limits.

The API does not require application-level authentication. Keep the FastAPI service private with same-host networking, firewall/security-group rules, or a reverse proxy if it should not be publicly callable.

## Available scripts
- `npm run lint` - runs all linters.
- `npm run lint:js` - runs ESLint on `app-logic.js` and `js/*.js`.
- `npm run lint:css` - runs Stylelint on all CSS files.
- `npm run format` - formats HTML/CSS/JS/JSON/Markdown/YAML files with Prettier.
- `npm run format:check` - verifies formatting without writing changes.
- `npm test` - runs unit tests.

## Features
- Section-based in-page navigation with active-link state and hash restoration.
- Light/dark theme toggle persisted in `localStorage`.
- Accessible project detail modal with keyboard dismissal and focus handling.
- Progressive enhancement so core content remains available without JavaScript.
- Contact form with native form fallback plus AJAX enhancement when JavaScript is available.
