# API Documentation

## Overview

The rjWebApp backend is a FastAPI service that provides activity tracking and AI chat functionality powered by Amazon Bedrock.

**Base URL**: `https://rjasti.com/api` (production)

---

## Authentication

⚠️ **WARNING**: The API currently has NO authentication. This is a security risk and should be addressed before production use.

---

## Endpoints

### Health Check

#### `GET /health`

Check API and database health status.

**Response** (200 OK):
```json
{
  "status": "ok",
  "db": "connected",
  "pool_free": 8,
  "pool_size": 10
}
```

---

### Session Management

#### `POST /sessions`

Create a new user session for activity tracking.

**Request Body**:
```json
{
  "user_agent": "Mozilla/5.0...",
  "device_type": "desktop"
}
```

**Response** (201 Created):
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "started_at": "2024-01-15T10:30:00Z"
}
```

---

#### `PATCH /sessions/{session_id}/heartbeat`

Update session last_active_at timestamp. Call every 60 seconds to keep session alive.

---

#### `PATCH /sessions/{session_id}/end`

Mark a session as ended.

---

#### `GET /sessions/{session_id}`

Retrieve session details.

---

### Event Tracking

#### `POST /events`

Record a single activity event.

**Constraints**:
- `event_data` must be ≤ 4KB when serialized to JSON
- `page_path` max length: 256 characters

---

#### `POST /events/bulk`

Record multiple events in a single transaction (up to 500 events).

---

#### `GET /sessions/{session_id}/events`

List events for a specific session with pagination.

**Query Parameters**:
- `limit` (optional): Number of events to return (1-500, default: 100)
- `offset` (optional): Number of events to skip (0-1,000,000, default: 0)

---

### AI Chat (Amazon Bedrock)

#### `POST /chat`

Stream a chat response from Amazon Bedrock.

**Constraints**:
- `messages`: 1-24 messages
- Each message `content`: 1-8,000 characters
- Messages must alternate between user/assistant roles
- First message must be from user

**Concurrency Limit**: 4 concurrent chat streams

---

#### `POST /chat/summarize`

Summarize a conversation history using Amazon Bedrock.

---

#### `GET /models`

List available Amazon Bedrock foundation models in the configured region.

---

## Rate Limiting

**Global Rate Limit**: 60 requests per minute per IP address

---

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string (asyncpg format)
- `AWS_REGION`: AWS region for Bedrock (e.g., `us-east-1`)
- `DEFAULT_MODEL_ID`: Default Bedrock model ID

### Optional
- `ALLOWED_MODEL_IDS`: Comma-separated allowlist of model IDs
- `CORS_ORIGINS`: Comma-separated allowed origins
- `TRUSTED_PROXY_IPS`: Comma-separated proxy IPs/CIDRs
- `MAX_BODY_BYTES`: Request body limit (default: 1048576)
- `CHAT_MAX_CONCURRENCY`: Max concurrent chat streams (default: 4)
- `LOG_LEVEL`: Python logging level (default: INFO)

---

## Security Considerations

⚠️ **CRITICAL SECURITY ISSUES**:

1. **No Authentication**: API is completely open
2. **Recommended Mitigations**:
   - Implement API key authentication
   - Add JWT-based session tokens
   - Implement per-session rate limiting

3. **Current Protections**:
   - Rate limiting (60 req/min per IP)
   - Request body size limits
   - Input validation via Pydantic
   - Parameterized SQL queries
   - CORS restrictions

---

## Client Example

```javascript
import { API_BASE, apiFetch } from './config.js';

// Create session
const session = await apiFetch(`${API_BASE}/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_agent: navigator.userAgent,
    device_type: 'desktop'
  })
}).then(r => r.json());

// Track event
await apiFetch(`${API_BASE}/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: session.session_id,
    event_type: 'page_view',
    page_path: window.location.pathname
  })
});
```

---

**Last Updated**: 2024
**API Version**: 1.0.0
