---
id: api/sessions
title: "/live — Session Management"
methods: [POST, GET, PATCH, DELETE]
auth: [none, bearer]
---

# /live — Session Management

Endpoints for creating, querying, updating, and deleting caption relay sessions.

---

## `POST /live` — Register Session

Create a new caption relay session. Returns a JWT token for all subsequent requests in this session. Registration is idempotent: if a session with the same `sessionId` (derived from `apiKey + streamKey + domain`) already exists, the existing session is returned.

**Authentication:** None (uses `apiKey` in the request body)

**Request**

```http
POST /live
Content-Type: application/json
```

**Target-array mode** (recommended) — pass all YouTube stream keys and optional generic webhook targets inside the `targets` array and omit `streamKey`:

```json
{
  "apiKey": "your-api-key",
  "domain": "https://your-app.example.com",
  "targets": [
    { "id": "yt-main",    "type": "youtube", "streamKey": "xxxx-xxxx-xxxx-xxxx" },
    { "id": "yt-backup",  "type": "youtube", "streamKey": "yyyy-yyyy-yyyy-yyyy" },
    {
      "id": "webhook-1",
      "type": "generic",
      "url": "https://webhook.example.com/captions",
      "headers": { "Authorization": "Bearer my-webhook-secret" }
    }
  ]
}
```

**Legacy single-target mode** — pass a single stream key as `streamKey`. Additional targets can still be supplied via the `targets` array.

```json
{
  "apiKey": "your-api-key",
  "streamKey": "xxxx-xxxx-xxxx-xxxx",
  "domain": "https://your-app.example.com"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | Yes | API key issued by the server admin |
| `streamKey` | `string` | No | YouTube Live stream key. Omit in target-array mode. |
| `domain` | `string` | Yes | Registered origin domain (used for CORS and session isolation) |
| `sequence` | `number` | No | Override the starting sequence number. When omitted, the server uses the persisted per-API-key sequence (see [Per-key Sequence Persistence](#per-api-key-sequence-persistence)). |
| `targets` | `array` | No | Array of caption delivery targets. See [Caption Targets](#caption-targets) below. |

### Caption Targets

Each entry in the `targets` array describes one delivery destination. Two target types are supported.

**YouTube target** — delivers captions via the YouTube Live HTTP caption ingestion API:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Client-assigned identifier (used for logging and updates) |
| `type` | `string` | Yes | Must be `"youtube"` |
| `streamKey` | `string` | Yes | YouTube Live stream key for this target |

**Generic (webhook) target** — POSTs caption data as JSON to an arbitrary HTTP endpoint:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Client-assigned identifier |
| `type` | `string` | Yes | Must be `"generic"` |
| `url` | `string` | Yes | Destination URL (must use `http` or `https`) |
| `headers` | `object` | No | Extra HTTP headers to include in the webhook request (e.g. `Authorization`) |

Generic targets receive a JSON body structured as follows (see also [`POST /captions`](./captions.md#generic-target-payload)):

```json
{
  "source": "https://your-app.example.com",
  "sequence": 7,
  "captions": [
    {
      "text": "Hello, world!",
      "composedText": "Hello, world! <br>Hei maailma!",
      "timestamp": "2024-01-01T12:00:02.000",
      "translations": { "fi-FI": "Hei maailma!" },
      "captionLang": "fi-FI",
      "showOriginal": true
    }
  ]
}
```

**Viewer target** — broadcasts captions to audience members via the public [`GET /viewer/:key`](./viewer.md) SSE endpoint:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Client-assigned identifier |
| `type` | `string` | Yes | Must be `"viewer"` |
| `viewerKey` | `string` | Yes | Short URL-safe key (letters, digits, hyphens, underscores; min 3 characters). Viewers subscribe at `GET /viewer/:viewerKey`. |

**Response — `200 OK`**

```json
{
  "token": "<JWT>",
  "sessionId": "a1b2c3...",
  "sequence": 42,
  "syncOffset": 0,
  "startedAt": "2024-01-01T12:00:00.000"
}
```

| Field | Type | Description |
|---|---|---|
| `token` | `string` | JWT for authenticating subsequent requests |
| `sessionId` | `string` | SHA-256 of `apiKey:streamKey:domain` |
| `sequence` | `number` | Current sequence counter |
| `syncOffset` | `number` | NTP-style clock offset in milliseconds |
| `startedAt` | `string` | Session start time (ISO string) |

**Error responses**

| Status | Reason |
|---|---|
| `400` | Missing or invalid fields |
| `401` | Invalid or expired API key |
| `429` | Daily or lifetime usage limit exceeded |

---

## `GET /live` — Session Status

Return the current sequence number and clock offset for the authenticated session.

**Authentication:** Bearer JWT

**Request**

```http
GET /live
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "sequence": 7,
  "syncOffset": 150
}
```

| Field | Type | Description |
|---|---|---|
| `sequence` | `number` | Current sequence counter |
| `syncOffset` | `number` | Clock offset in milliseconds |

---

## `PATCH /live` — Update Session

Update mutable session fields. Supports advancing the sequence counter and replacing the active caption targets at runtime.

**Authentication:** Bearer JWT

**Request**

```http
PATCH /live
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "sequence": 10,
  "targets": [
    { "id": "yt-main", "type": "youtube", "streamKey": "xxxx-xxxx-xxxx-xxxx" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `sequence` | `number` | No | New sequence counter value. Setting `0` explicitly resets the persisted per-key sequence. |
| `targets` | `array` | No | Replace all active caption targets. Uses the same format as `POST /live`. Old YouTube senders are stopped before the new ones start. |

**Response — `200 OK`**

```json
{
  "sequence": 10,
  "targetsCount": 1
}
```

| Field | Type | Description |
|---|---|---|
| `sequence` | `number` | Current sequence counter |
| `targetsCount` | `number` | Number of active targets after the update |

---

## `DELETE /live` — End Session

Tear down the session. The YouTube sender is stopped, final session statistics are written to the database, and the JWT is invalidated.

**Authentication:** Bearer JWT

**Request**

```http
DELETE /live
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "removed": true,
  "sessionId": "a1b2c3..."
}
```

**Side effects:**
- Closes the `YoutubeLiveCaptionSender` for this session (primary sender and all extra YouTube targets)
- Writes a `session_stats` record to the database
- Emits a `session_closed` event to any connected SSE clients

---

## Session Lifecycle

```
POST /live  →  JWT token issued
     ↓
GET/PATCH /live  (optional — inspect or update state)
     ↓
POST /sync  (recommended after registration)
     ↓
POST /captions  (send captions — see captions.md)
GET /events     (receive results — see captions.md)
     ↓
DELETE /live  →  session closed, stats recorded
```

Sessions expire automatically after `SESSION_TTL` milliseconds of inactivity (default 2 hours). Expiry emits a `session_closed` SSE event.

---

## Per-API-key Sequence Persistence

The caption sequence counter is persisted **per API key** across sessions. When a new session is created via `POST /live`, the server initialises the sequence from the stored value for that API key rather than always starting from `0`.

**2-hour inactivity TTL:** If no caption has been sent in more than 2 hours, the sequence is automatically reset to `0` on the next session start. This matches YouTube's own caption sequence reset window.

**Explicit override:** Pass `"sequence": N` in the `POST /live` body to override the persisted value (useful for testing or forced resets).

**Explicit reset:** `PATCH /live` with `{ "sequence": 0 }` clears the persisted per-key sequence and records a `NULL` last-caption timestamp, so the next session will also start from `0`.

**Automatic update:** Every successful caption delivery via `POST /captions` updates the persisted per-key sequence atomically.

---

## Session Persistence Across Server Restarts

Sessions are stored in the `sessions` SQLite table and **rehydrated automatically** when the server starts. On restart:

1. All previously active sessions are restored into memory (without active YouTube senders — senders are not serialisable).
2. Sequence counters, clock offsets, and metadata are preserved.
3. When a client calls `POST /live` for a rehydrated session, the server issues a **fresh JWT** and attaches a new `YoutubeLiveCaptionSender`. Captions can then be sent normally without any client-side change.

This means clients that reconnect after a server restart do not lose caption history or sequence continuity — they simply need to call `POST /live` again to obtain a new token.
