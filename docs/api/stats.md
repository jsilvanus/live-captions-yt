---
title: "Statistics, Usage & Mic Lock"
methods: [GET, DELETE, POST]
auth: [bearer, adminkey, none]
---

# Statistics, Usage & Mic Lock

Endpoints for per-key statistics, GDPR data erasure, domain-level usage analytics, and the collaborative mic lock.

---

## `GET /stats` — User Statistics

Return usage statistics and session history for the authenticated API key.

**Authentication:** Bearer JWT

**Request**

```http
GET /stats
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "apiKey": "key-abc",
  "owner": "Alice",
  "email": "alice@example.com",
  "expires": "2025-01-01T00:00:00.000Z",
  "usage": {
    "lifetimeUsed": 1234,
    "dailyUsed": 42,
    "dailyLimit": 1000,
    "lifetimeLimit": 50000
  },
  "sessions": [
    {
      "sessionId": "a1b2c3...",
      "domain": "https://my-app.example.com",
      "startedAt": "2024-06-01T10:00:00.000Z",
      "endedAt": "2024-06-01T11:00:00.000Z",
      "captionsSent": 120,
      "captionsFailed": 2
    }
  ],
  "captionErrors": [
    {
      "sessionId": "a1b2c3...",
      "error": "HTTP 403",
      "occurredAt": "2024-06-01T10:30:00.000Z"
    }
  ],
  "authEvents": [
    {
      "event": "session_start",
      "domain": "https://my-app.example.com",
      "occurredAt": "2024-06-01T10:00:00.000Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `apiKey` | `string` | Redacted/aliased API key identifier |
| `owner` | `string` | Owner name associated with the key |
| `email` | `string \| null` | Owner email (if stored) |
| `expires` | `string \| null` | Key expiry timestamp, or `null` if no expiry |
| `usage.lifetimeUsed` | `number` | Total captions sent across all sessions |
| `usage.dailyUsed` | `number` | Captions sent today |
| `usage.dailyLimit` | `number \| null` | Daily caption limit, or `null` if unlimited |
| `usage.lifetimeLimit` | `number \| null` | Lifetime caption limit, or `null` if unlimited |
| `sessions` | `array` | Completed session records |
| `captionErrors` | `array` | Recent caption delivery failures |
| `authEvents` | `array` | Recent authentication and usage events |

---

## `DELETE /stats` — GDPR Data Erasure

Permanently anonymise the authenticated API key and delete all associated personal data. This implements the GDPR "right to erasure".

**Authentication:** Bearer JWT

**Request**

```http
DELETE /stats
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "ok": true,
  "message": "Your data has been anonymised and deleted."
}
```

**Side effects:**
- Terminates the active session
- Anonymises the API key record (owner name and email replaced with placeholder values)
- Deletes all associated `session_stats`, `caption_errors`, and `auth_events` records
- The key's email is retained in minimal form for fraud prevention purposes
- The active JWT is invalidated

> **Note:** After calling this endpoint, the API key can no longer be used. Contact your server admin if you need a new key.

---

## `GET /usage` — Domain Usage Statistics

Return aggregated caption statistics broken down by domain and time period.

**Authentication:**
- If `USAGE_PUBLIC` environment variable is set: no authentication required (CORS limited to `ALLOWED_DOMAINS`)
- Otherwise: `X-Admin-Key` header required

**Request**

```http
GET /usage?from=2024-01-01&to=2024-01-31&granularity=day
X-Admin-Key: <ADMIN_KEY>
```

**Query Parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | `string` | 30 days ago | Start date in `YYYY-MM-DD` format |
| `to` | `string` | today | End date in `YYYY-MM-DD` format |
| `granularity` | `string` | `'day'` | Aggregation level: `'hour'` or `'day'` |
| `domain` | `string` | all domains | Filter to a specific domain |

**Response — `200 OK`**

```json
{
  "from": "2024-01-01",
  "to": "2024-01-31",
  "granularity": "day",
  "public": false,
  "data": [
    {
      "domain": "https://my-app.example.com",
      "date": "2024-01-15",
      "sessions_started": 12,
      "sessions_ended": 11,
      "captions_sent": 480,
      "captions_failed": 3,
      "batches_sent": 120,
      "total_duration_ms": 3600000,
      "peak_sessions": 4
    }
  ]
}
```

When `granularity=hour`, each record also includes an `hour` field (integer 0–23).

| Field | Type | Description |
|---|---|---|
| `domain` | `string` | Origin domain |
| `date` | `string` | Date in `YYYY-MM-DD` format |
| `hour` | `number` | Hour of day (only present when `granularity=hour`) |
| `sessions_started` | `number` | Sessions created in this period |
| `sessions_ended` | `number` | Sessions closed in this period |
| `captions_sent` | `number` | Captions successfully delivered |
| `captions_failed` | `number` | Captions that failed delivery |
| `batches_sent` | `number` | Number of batch requests |
| `total_duration_ms` | `number` | Sum of session durations in milliseconds |
| `peak_sessions` | `number` | Highest concurrent session count observed |

---

## `POST /mic` — Mic Lock

Claim or release the soft mic lock for a collaborative session. The mic lock is advisory — it signals which client should be considered the active speaker, but does not block other clients from sending captions.

**Authentication:** Bearer JWT

**Request**

```http
POST /mic
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "action": "claim",
  "clientId": "client-abc"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | `'claim'` to acquire the lock, `'release'` to relinquish it |
| `clientId` | `string` | Yes | Unique identifier for the calling client |

**Behavior:**
- **`claim`**: Sets the session's `micHolder` to `clientId`, overwriting any existing holder. All connected SSE clients receive a `mic_state` event.
- **`release`**: Clears `micHolder` only if the caller is the current holder. If the caller is not the holder, the request is a no-op.

**Response — `200 OK`**

```json
{
  "ok": true,
  "holder": "client-abc"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | Always `true` |
| `holder` | `string \| null` | The current mic holder after this operation |

**Side effects:** A `mic_state` SSE event is broadcast to all SSE clients in the session.
