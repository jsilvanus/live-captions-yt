# lcyt-backend (Node.js)

An Express.js HTTP relay server that bridges web clients to YouTube Live's caption ingestion API. It handles CORS, multi-session management, API key authentication, clock synchronization, and SQLite-backed key persistence.

> **See also:** [`python-packages/lcyt-backend/`](../../python-packages/lcyt-backend/) for the equivalent Python/Flask implementation.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Server](#running-the-server)
- [Admin CLI](#admin-cli)
- [Docker](#docker)
- [API Reference](#api-reference)
  - [POST /live](#post-live)
  - [GET /live](#get-live)
  - [DELETE /live](#delete-live)
  - [POST /captions](#post-captions)
  - [GET /events](#get-events)
  - [POST /sync](#post-sync)
  - [GET /health](#get-health)
  - [Admin: GET /keys](#admin-get-keys)
  - [Admin: POST /keys](#admin-post-keys)
  - [Admin: GET /keys/:key](#admin-get-keyskey)
  - [Admin: PATCH /keys/:key](#admin-patch-keyskey)
  - [Admin: DELETE /keys/:key](#admin-delete-keyskey)
- [Authentication](#authentication)
- [Session Lifecycle](#session-lifecycle)
- [Testing](#testing)
- [Relation to the Monorepo](#relation-to-the-monorepo)

---

## Overview

YouTube's live caption ingestion API requires HTTP POST requests sent from a server-side process. Browsers cannot call it directly due to CORS restrictions. `lcyt-backend` solves this by acting as a secure intermediary:

1. A web client authenticates with an API key and stream key.
2. The server registers a session, creates a `YoutubeLiveCaptionSender` instance, and returns a short-lived JWT.
3. The client uses the JWT to send captions, trigger clock sync, or tear down the session.
4. The server forwards caption data to YouTube and relays the result.

---

## Architecture

```
packages/lcyt-backend/
├── bin/
│   └── lcyt-backend-admin      # CLI tool for local API key management
├── src/
│   ├── index.js                # Entry point; graceful shutdown wiring
│   ├── server.js               # Express app factory; middleware + route setup
│   ├── db.js                   # SQLite operations (api_keys table)
│   ├── store.js                # In-memory session store with TTL cleanup
│   ├── middleware/
│   │   ├── auth.js             # JWT Bearer token verification
│   │   ├── admin.js            # X-Admin-Key header validation (constant-time)
│   │   └── cors.js             # Dynamic CORS policy enforcement
│   └── routes/
│       ├── live.js             # Session registration, status, teardown
│       ├── captions.js         # Caption queuing → 202 + async YouTube delivery
│       ├── events.js           # GET /events SSE stream for delivery results
│       ├── sync.js             # Clock synchronization
│       └── keys.js             # Admin CRUD for API keys
├── test/                       # Node built-in test runner suite
├── Dockerfile                  # Multi-stage build (node:20-slim)
└── package.json
```

**Key design decisions:**

- **Session IDs** are a 16-char SHA-256 hex hash of `apiKey:streamKey:domain`, so raw credentials are never stored in JWTs or exposed in logs.
- **In-memory sessions** with configurable TTL; no session DB is required for operation.
- **Async caption delivery:** `POST /captions` returns `202 { ok, requestId }` immediately. The YouTube HTTP call is serialised per session via a per-session Promise queue (so sequence numbers stay monotonic) and the result is pushed to `GET /events` via an `EventEmitter` on the session.
- **Admin routes** (`/keys`) are never exposed to CORS—they must be called from the server's local network.
- **SQLite** (via `better-sqlite3`) stores API keys persistently across restarts.

---

## Prerequisites

- Node.js 20+
- npm 8+ (for workspace support)

---

## Installation

Always install from the **monorepo root** so npm workspace symlinks are created:

```bash
# From the repo root
npm install
```

This links the local `lcyt` package into `packages/lcyt-backend/node_modules/`.

---

## Configuration

All configuration is done via environment variables (12-factor style). No config files are required.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP port the server listens on |
| `JWT_SECRET` | **Yes** | Random (warns on startup) | Secret used to sign and verify session JWTs. Must be set in production. |
| `ADMIN_KEY` | No | *(unset)* | Secret for admin endpoints (`/keys`). If unset, admin routes return `503`. |
| `DB_PATH` | No | `./lcyt-backend.db` | Path to the SQLite database file |
| `SESSION_TTL` | No | `7200000` (2 hours) | Session idle timeout in milliseconds |
| `CLEANUP_INTERVAL` | No | `300000` (5 minutes) | How often to sweep and expire stale sessions (ms) |
| `NODE_ENV` | No | *(unset)* | Set to `production` to suppress development warnings |

**Example `.env`:**

```env
PORT=3000
JWT_SECRET=change-me-to-a-long-random-string
ADMIN_KEY=change-me-to-another-long-random-string
DB_PATH=/var/lib/lcyt/backend.db
SESSION_TTL=3600000
```

> **Security note:** If `JWT_SECRET` is not set, the server generates a random secret on each start. This means all existing JWTs are invalidated on restart. Always set `JWT_SECRET` in production.

---

## Running the Server

**From the monorepo root:**

```bash
# Using the workspace script
npm run start:backend

# Or directly
node packages/lcyt-backend/src/index.js
```

**From the package directory:**

```bash
cd packages/lcyt-backend
JWT_SECRET=mysecret ADMIN_KEY=myadminkey node src/index.js
```

The server logs the port and a warning if `JWT_SECRET` is not configured.

---

## Admin CLI

A local CLI tool is included for managing API keys without running HTTP requests. It reads from the same SQLite database as the server.

```bash
# List all keys
node packages/lcyt-backend/bin/lcyt-backend-admin list

# Add a new key (auto-generates UUID if --key is omitted)
node packages/lcyt-backend/bin/lcyt-backend-admin add \
  --owner "Alice" \
  [--key custom-key-value] \
  [--expires 2027-01-01]

# Show details for a specific key
node packages/lcyt-backend/bin/lcyt-backend-admin info <key>

# Soft-revoke a key (sets active = 0)
node packages/lcyt-backend/bin/lcyt-backend-admin revoke <key>

# Hard-delete a key from the database
node packages/lcyt-backend/bin/lcyt-backend-admin delete <key>

# Extend or update a key's expiry
node packages/lcyt-backend/bin/lcyt-backend-admin renew <key> --expires 2027-12-31
```

> The CLI uses the same `DB_PATH` environment variable as the server.

---

## Docker

A multi-stage `Dockerfile` is included at the package root. Build it from the **monorepo root** so the `lcyt` workspace dependency is available:

```bash
docker build \
  -f packages/lcyt-backend/Dockerfile \
  -t lcyt-backend:latest \
  .
```

**Run the container:**

```bash
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET=your-long-random-secret \
  -e ADMIN_KEY=your-admin-secret \
  -e DB_PATH=/data/backend.db \
  -v /host/path/to/data:/data \
  lcyt-backend:latest
```

---

## API Reference

All request and response bodies are JSON (`Content-Type: application/json`).

---

### POST /live

Register a new caption session (or retrieve an existing one for the same credentials).

**Auth:** None — the API key in the request body is the credential.

**CORS:** Permissive (any origin allowed).

**Request body:**

```json
{
  "apiKey":    "string (required)",
  "streamKey": "string (required)",
  "domain":    "string (required) — your app's origin URL, e.g. https://example.com",
  "sequence":  0
}
```

**Response `200 OK`:**

```json
{
  "token":      "eyJhbGci...",
  "sessionId":  "a1b2c3d4e5f6a7b8",
  "sequence":   0,
  "syncOffset": 42,
  "startedAt":  1700000000000
}
```

| Field | Description |
|---|---|
| `token` | JWT to include in `Authorization: Bearer` header for subsequent requests |
| `sessionId` | 16-char hex identifier for this session |
| `sequence` | Current caption sequence number |
| `syncOffset` | Estimated clock difference vs. YouTube server (ms) |
| `startedAt` | Unix timestamp (ms) when the session was created |

**Error responses:**

| Status | Reason |
|---|---|
| `400` | Missing required field (`apiKey`, `streamKey`, or `domain`) |
| `401` | API key not found, revoked, or expired |

**Notes:** This endpoint is idempotent. Calling it again with the same `apiKey + streamKey + domain` returns the same session and token.

---

### GET /live

Check the current status of an active session.

**Auth:** `Authorization: Bearer <token>`

**CORS:** Dynamic — restricted to the `domain` registered for this session.

**Response `200 OK`:**

```json
{
  "sequence":   5,
  "syncOffset": 42
}
```

**Error responses:**

| Status | Reason |
|---|---|
| `401` | Missing or invalid JWT |
| `404` | Session not found (may have expired) |

---

### DELETE /live

Tear down a session. Closes the YouTube connection and removes the session from memory.

**Auth:** `Authorization: Bearer <token>`

**CORS:** Dynamic.

**Response `200 OK`:**

```json
{
  "removed":   true,
  "sessionId": "a1b2c3d4e5f6a7b8"
}
```

**Error responses:**

| Status | Reason |
|---|---|
| `401` | Missing or invalid JWT |
| `404` | Session not found |

---

### POST /captions

Send one or more captions to YouTube.

**Auth:** `Authorization: Bearer <token>`

**CORS:** Dynamic.

**Request body:**

```json
{
  "captions": [
    {
      "text":      "Hello, world!",
      "timestamp": "2024-01-01T12:00:00.000Z",
      "time":      1500
    }
  ]
}
```

| Field | Description |
|---|---|
| `text` | Caption text (required per caption) |
| `timestamp` | Absolute ISO 8601 timestamp (optional). Takes precedence over `time`. |
| `time` | Milliseconds since session start (optional). Resolved to an absolute timestamp using `startedAt + time + syncOffset`. |

If neither `timestamp` nor `time` is provided, the current server time is used.

**Response `202 Accepted`** (always, for valid auth + session):

```json
{
  "ok":        true,
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

The YouTube HTTP call happens in the background. The actual delivery result — sequence number, status code, and server timestamp — is pushed to the client on the `GET /events` SSE stream. Use `requestId` to correlate the ack with the eventual result event.

**Error responses (before queuing):**

| Status | Reason |
|---|---|
| `400` | `captions` field missing or empty array |
| `401` | Missing or invalid JWT |
| `404` | Session not found |

Delivery failures (YouTube errors, network errors) arrive as `caption_error` events on the SSE stream — they do **not** affect the HTTP status of the original `POST /captions` call.

---

### GET /events

Subscribe to the real-time SSE stream of caption delivery results for the current session.

**Auth:** `Authorization: Bearer <token>` **or** `?token=<jwt>` query parameter. The query-parameter form is required for browser `EventSource` connections, which cannot set custom headers.

**CORS:** Dynamic (same policy as other session-scoped routes).

**Response:** `text/event-stream` (Server-Sent Events). The connection stays open until the client closes it or the session is torn down.

**Events:**

| Event | When | Data |
|---|---|---|
| `connected` | Immediately on subscribe | `{ "sessionId": "..." }` |
| `caption_result` | YouTube accepted the caption(s) | `{ "requestId": "...", "sequence": 6, "statusCode": 200, "serverTimestamp": "...", ["count": 3] }` |
| `caption_error` | YouTube rejected or a network error occurred | `{ "requestId": "...", "error": "...", "statusCode": 401, ["sequence": 6] }` |
| `session_closed` | Session expired or was deleted server-side | `{}` |

**Example (browser):**

```javascript
const es = new EventSource(`https://captions.example.com/events?token=${encodeURIComponent(jwt)}`);

es.addEventListener('caption_result', (e) => {
  const { requestId, sequence, statusCode } = JSON.parse(e.data);
  console.log(`Caption #${sequence} delivered (${statusCode})`);
});

es.addEventListener('caption_error', (e) => {
  const { requestId, error } = JSON.parse(e.data);
  console.error('Delivery failed:', error);
});

es.addEventListener('session_closed', () => es.close());
```

**Error responses (before streaming begins):**

| Status | Reason |
|---|---|
| `401` | Missing, invalid, or expired token |
| `404` | Session not found |

---

### POST /sync

Perform an NTP-style clock synchronization with the YouTube caption server. Updates the session's `syncOffset`.

**Auth:** `Authorization: Bearer <token>`

**CORS:** Dynamic.

**Response `200 OK`:**

```json
{
  "syncOffset":      55,
  "roundTripTime":   120,
  "serverTimestamp": "2024-01-01T12:00:00.042Z",
  "statusCode":      200
}
```

| Field | Description |
|---|---|
| `syncOffset` | Updated estimate of clock skew vs. YouTube server (ms) |
| `roundTripTime` | Measured round-trip time of the sync request (ms) |
| `serverTimestamp` | YouTube server's reported time |

**Error responses:**

| Status | Reason |
|---|---|
| `401` | Missing or invalid JWT |
| `404` | Session not found |
| `502` | YouTube sync request failed |

---

### GET /health

Liveness check. Returns server uptime and active session count.

**Auth:** None.

**CORS:** Permissive.

**Response `200 OK`:**

```json
{
  "ok":             true,
  "uptime":         3600,
  "activeSessions": 2
}
```

---

### Admin: GET /keys

List all API keys.

**Auth:** `X-Admin-Key: <admin-key>` header.

**CORS:** Disabled (admin routes must be called server-side).

**Response `200 OK`:**

```json
{
  "keys": [
    {
      "key":       "550e8400-e29b-41d4-a716-446655440000",
      "owner":     "Alice",
      "active":    true,
      "expires":   "2027-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T10:00:00.000Z"
    }
  ]
}
```

---

### Admin: POST /keys

Create a new API key.

**Auth:** `X-Admin-Key: <admin-key>` header.

**Request body:**

```json
{
  "owner":   "Alice",
  "key":     "optional-custom-key",
  "expires": "2027-01-01"
}
```

| Field | Required | Description |
|---|---|---|
| `owner` | Yes | Human-readable label for the key holder |
| `key` | No | Custom key value; a UUID is generated if omitted |
| `expires` | No | ISO date string; no expiry if omitted |

**Response `201 Created`:** Key object (same shape as GET /keys list item).

**Error responses:**

| Status | Reason |
|---|---|
| `400` | `owner` is missing |
| `401` | `X-Admin-Key` header is missing |
| `403` | `X-Admin-Key` value is wrong |
| `503` | `ADMIN_KEY` environment variable is not set |

---

### Admin: GET /keys/:key

Get details for a specific API key.

**Auth:** `X-Admin-Key: <admin-key>` header.

**Response `200 OK`:** Key object.

**Error responses:** `404` if key not found, plus standard admin auth errors.

---

### Admin: PATCH /keys/:key

Update an API key's owner or expiry.

**Auth:** `X-Admin-Key: <admin-key>` header.

**Request body** (all fields optional):

```json
{
  "owner":   "Bob",
  "expires": "2028-06-01"
}
```

Pass `"expires": null` to remove the expiry (make the key permanent).

**Response `200 OK`:** Updated key object.

**Error responses:** `404` if key not found, plus standard admin auth errors.

---

### Admin: DELETE /keys/:key

Revoke or permanently delete an API key.

**Auth:** `X-Admin-Key: <admin-key>` header.

**Query parameters:**

| Parameter | Description |
|---|---|
| `permanent=true` | Hard-delete the row. Omit for a soft revoke (`active = 0`). |

**Response `200 OK`:**

```json
{ "key": "550e8400-...", "revoked": true }
// or
{ "key": "550e8400-...", "deleted": true }
```

**Error responses:** `404` if key not found, plus standard admin auth errors.

---

## Authentication

The backend uses a two-tier authentication system:

### Session auth (JWT Bearer tokens)

Used for all session-scoped operations: `/live` (GET, DELETE), `/captions`, `/sync`.

- Tokens are signed with `JWT_SECRET` using HS256.
- Token payload: `{ sessionId, apiKey, streamKey, domain }`.
- All comparisons use Node.js `crypto.timingSafeEqual` to prevent timing attacks.
- Include the token in all requests as: `Authorization: Bearer <token>`.

### Admin auth (X-Admin-Key header)

Used for all `/keys` routes. The key must match the `ADMIN_KEY` environment variable.

- Comparison is constant-time (no timing oracle).
- If `ADMIN_KEY` is not configured, all `/keys` routes return `503 Admin API not configured`.
- Admin routes have no CORS headers — they cannot be called from a browser.

---

## Session Lifecycle

```
Client                          lcyt-backend                    YouTube
  │                                  │                              │
  │── POST /live ──────────────────> │                              │
  │   {apiKey, streamKey, domain}    │── validates API key in SQLite│
  │                                  │── creates YoutubeLiveCaption │
  │                                  │   Sender instance            │
  │                                  │── runs initial sync ────────>│
  │<── {token, sessionId, ...} ──── │<─── sync response ───────────│
  │                                  │                              │
  │── GET /events?token=... ───────> │                              │
  │<── text/event-stream open ────── │                              │
  │<── event: connected ──────────── │                              │
  │                                  │                              │
  │── POST /captions ──────────────> │                              │
  │   Authorization: Bearer <token>  │                              │
  │<── 202 {ok, requestId} ───────── │                              │
  │                                  │── sender.send() ────────────>│  (async)
  │<── event: caption_result ─────── │<─── 200 OK ─────────────────│
  │                                  │                              │
  │── POST /sync ──────────────────> │                              │
  │<── {syncOffset, rtt} ─────────── │── sender.sync() ───────────>│
  │                                  │                              │
  │── DELETE /live ────────────────> │                              │
  │<── {removed: true} ─────────── │── sender.end() ─────────────>│
  │<── event: session_closed ─────── │── session removed from memory│
```

Sessions expire automatically after `SESSION_TTL` milliseconds of inactivity (default: 2 hours). A background sweep runs every `CLEANUP_INTERVAL` milliseconds (default: 5 minutes) to clean up expired sessions and call `sender.end()` on them.

---

## Testing

Tests use Node.js's built-in test runner (`node:test`) and the native `fetch` API. No external test framework is required.

```bash
# Run all tests for this package
npm test -w packages/lcyt-backend

# Or from within the package directory
npm test

# Or from the monorepo root (runs all package tests)
npm test
```

Test files are in `test/` and cover each route (`live`, `captions`, `keys`, `sync`), the session store, database layer, and health endpoint.

---

## Relation to the Monorepo

```
live-captions-yt/
├── packages/lcyt             ← Core library (YoutubeLiveCaptionSender)
├── packages/lcyt-cli         ← Interactive CLI for local users
└── packages/lcyt-backend     ← THIS PACKAGE
                                   Depends on: packages/lcyt
```

`lcyt-backend` uses `YoutubeLiveCaptionSender` from the sibling `lcyt` package to manage the actual YouTube connection. The CLI (`lcyt-cli`) and this backend serve different use cases: the CLI is for a single user running captions locally, while the backend serves multiple remote web clients simultaneously.
