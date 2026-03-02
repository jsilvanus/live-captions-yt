# Session Management

Endpoints for creating, querying, updating, and deleting caption relay sessions, and for synchronising clocks.

---

## `POST /live` — Register Session

Create a new caption relay session. Returns a JWT token for all subsequent requests in this session. Registration is idempotent: if a session with the same `sessionId` (derived from `apiKey + streamKey + domain`) already exists, the existing session is returned.

**Authentication:** None (uses `apiKey` in the request body)

**Request**

```http
POST /live
Content-Type: application/json
```

```json
{
  "apiKey": "your-api-key",
  "streamKey": "xxxx-xxxx-xxxx-xxxx",
  "domain": "https://your-app.example.com",
  "sequence": 0
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | Yes | API key issued by the server admin |
| `streamKey` | `string` | Yes | YouTube Live stream key |
| `domain` | `string` | Yes | Registered origin domain (used for CORS and session isolation) |
| `sequence` | `number` | No | Starting sequence number (default `0`) |

**Response — `200 OK`**

```json
{
  "token": "<JWT>",
  "sessionId": "a1b2c3...",
  "sequence": 0,
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

Update mutable session fields. Currently supports advancing the sequence counter.

**Authentication:** Bearer JWT

**Request**

```http
PATCH /live
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "sequence": 10
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `sequence` | `number` | No | New sequence counter value |

**Response — `200 OK`**

```json
{
  "sequence": 10
}
```

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
- Closes the `YoutubeLiveCaptionSender` for this session
- Writes a `session_stats` record to the database
- Emits a `session_closed` event to any connected SSE clients

---

## `POST /sync` — Clock Sync

Perform an NTP-style clock synchronisation round-trip. The server sends a caption to YouTube and uses the response timestamp to compute a clock offset. This offset is stored in the session and applied to subsequent caption timestamps.

**Authentication:** Bearer JWT

**Request**

```http
POST /sync
Authorization: Bearer <token>
```

No body required.

**Response — `200 OK`**

```json
{
  "syncOffset": 150,
  "roundTripTime": 82,
  "serverTimestamp": "2024-01-01T12:00:00.082",
  "statusCode": 200
}
```

| Field | Type | Description |
|---|---|---|
| `syncOffset` | `number` | Computed clock offset in milliseconds. Positive means the server is ahead of the client. |
| `roundTripTime` | `number` | Round-trip latency to YouTube in milliseconds |
| `serverTimestamp` | `string` | Timestamp returned by YouTube |
| `statusCode` | `number` | HTTP status from YouTube |

**Side effects:** Updates `syncOffset` in the session store.

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
