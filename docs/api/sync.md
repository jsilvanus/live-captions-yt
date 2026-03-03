---
id: api/sync
title: "/sync — Clock Sync"
methods: [POST]
auth: [bearer]
---

# /sync — Clock Sync

NTP-style clock synchronisation. The server sends a caption to YouTube and uses the response timestamp to compute a clock offset. This offset is stored in the session and applied to subsequent caption timestamps.

---

## `POST /sync` — Clock Sync

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
