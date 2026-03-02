---
title: "/stats — Usage Statistics"
methods: [GET, DELETE]
auth: [bearer]
---

# /stats — Usage Statistics

Per-key usage statistics and GDPR data erasure.

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

