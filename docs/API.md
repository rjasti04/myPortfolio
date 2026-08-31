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
  "session_token": "9f2c...e41a",
  "started_at": "2024-01-15T10:30:00Z"
}
```

`session_token` is issued once, here, and is the only thing that authorises
access to this session afterwards. Store it with the id.

---

### Session capability tokens

Every endpoint scoped to a `session_id` requires the token issued when that
session was created. Without it the session id alone granted full access, so any
party holding or guessing an id could read a visitor's behavioural trail and
device metadata, or write events attributed to them.

Send it as a header:

```
X-Session-Token: <session_token>
```

`GET /sessions/{session_id}/stream` also accepts `?session_token=...`, because
`EventSource` cannot set request headers. Prefer the header everywhere else -
a query parameter is liable to end up in access logs.

A missing or wrong token returns **403** with an identical body whether or not
the session exists, so the endpoint cannot be used to discover valid ids.

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

**Body**:
- `events` (required): 1-500 event objects, same shape as `POST /events`
- `client_ts` (optional): client clock at flush time, diagnostic only - never
  trusted for ordering
- `flush_reason` (optional): what triggered the batch, one of `threshold`,
  `timer`, `unload`, `hidden`, `manual`. Tallied per reason and reported by
  `GET /system/pipeline`; a high `unload` share means the timed flush is not
  keeping up and data is riding the unreliable path.

---

#### `GET /sessions/{session_id}/events`

List events for a specific session with pagination.

**Query Parameters**:
- `limit` (optional): Number of events to return (1-500, default: 100)
- `offset` (optional): Number of events to skip (0-1,000,000, default: 0)
- `event_type` (optional): restrict to one declared event type

---

#### `GET /sessions/{session_id}/events/summary`

Aggregate counts by event type, plus the session-wide span (distinct paths,
first and last event). Every declared type is zero-filled so the client tile
grid does not reflow as counts land.

---

#### `GET /sessions/{session_id}/events/funnel`

Path funnel and transition edges for a session, computed in a single
window-function pass.

**Query Parameters**:
- `limit` (optional): Maximum paths to return (1-25, default: 8)

**Response**: `steps` (path, hits, first_at, last_at, share) ordered by hits,
and `transitions` (from, to, weight) for the most common path-to-path moves.

---

#### `GET /sessions/{session_id}/stream`

Server-sent events for the live activity dashboard. Three named channels share
one connection:

| Channel | Payload |
| :--- | :--- |
| `hello` | Bootstrap: server time, `resumed_from`, pipeline snapshot |
| `activity` | One event, compact shape, carrying `id:` for resume |
| `pipeline` | Per-stage health snapshot, every 2s |

The compact activity frame drops `session_id` (implicit in the stream) and
sends epoch millis rather than an ISO string:

```json
{"i": 10432, "t": 1756570000123, "e": "click", "p": "/#activity", "d": {"element_id": "cta"}}
```

An unnamed `data:` frame carrying the verbose shape is emitted alongside each
`activity` frame, so a client using `EventSource.onmessage` still works. Both
are deduplicated by `event_id` client-side.

**Resume**: each `activity` frame carries an `id:`. On reconnect the browser
sends `Last-Event-ID` automatically and the server replays the gap from a
per-session ring buffer (`SSE_REPLAY_BUFFER`, retained for `SSE_REPLAY_TTL`
after disconnect). `retry: 3000` is advertised on connect.

**Backpressure**: each listener queue is bounded (`SSE_QUEUE_MAXSIZE`); at the
cap the oldest frame is dropped, since a live tail beats a stale backlog.

---

### System

#### `GET /system/pipeline`

Per-stage health for the activity dashboard's ETL visualiser. Read-only over
in-process counters, so it costs no database round trip.

`mode` is one of:

| Mode | Meaning |
| :--- | :--- |
| `kafka` | A broker is attached; figures are its own |
| `simulator` | The mock event generator is running |
| `simulated` | No broker; queue figures are modelled (default) |
| `bypass` | No broker and modelling disabled |

The Kafka stage always carries a `simulated` boolean, so a consumer can tell
modelled figures from broker-reported ones. In `simulated` mode the numbers are
derived from the API's real throughput rather than invented: `messages` is the
true count of events processed, partition offsets sum to it, `throughput` is
the observed rolling-minute rate, and `lag` rises with arrivals then drains
geometrically against wall time (so poll rate does not move it). Set
`SIMULATE_KAFKA_METRICS=false` for the `bypass` report instead.

`fanout` is `postgres` when cross-instance LISTEN/NOTIFY relay is active,
otherwise `local`.

Stages report: `ingress` (events, last_event_at, flush_reasons), `kafka`
(mode, messages, lag, topic), `fastapi` (listeners, queued_frames,
dropped_frames), `postgres` (rows_written, buffer_depth, flushes,
flush_failures, last_flush_ms, last_error).

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
- `KAFKA_BOOTSTRAP_SERVERS`: Broker list. Empty (default) runs the pipeline in
  `simulated` mode - see `GET /system/pipeline`
- `SIMULATE_KAFKA_METRICS`: Model queue figures from real throughput when no
  broker is attached (default: true). False reports `bypass`
- `SIMULATED_KAFKA_PARTITIONS`: Partitions the modelled topic presents
  (default: 3)
- `SIMULATED_KAFKA_GROUP`: Modelled consumer group (default: activity-dashboard)
- `KAFKA_TOPIC`: Activity topic (default: session-activity)
- `KAFKA_BATCH_SIZE`: Rows buffered before an eager flush (default: 10)
- `KAFKA_BATCH_TIMEOUT`: Periodic flush interval in seconds (default: 3.0)
- `ENABLE_EVENT_SIMULATOR`: Generate mock events when no broker is configured
  (default: false)
- `SSE_QUEUE_MAXSIZE`: Per-listener frame backlog cap (default: 100)
- `SSE_REPLAY_BUFFER`: Per-session Last-Event-ID resume ring (default: 200)
- `SSE_REPLAY_TTL`: Seconds a disconnected session's resume ring is kept
  (default: 300)
- `ENABLE_PG_FANOUT`: Relay SSE broadcasts between API instances over Postgres
  LISTEN/NOTIFY. Only needed with more than one process; pure overhead on a
  single instance (default: false)
- `PG_FANOUT_CHANNEL`: NOTIFY channel name (default: activity_events)

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
