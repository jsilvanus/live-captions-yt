---
title: "/captions — Send Captions"
methods: [POST]
auth: [bearer]
---

# /captions — Send Captions

Queue one or more captions for delivery to YouTube. Returns `202 Accepted` immediately; the actual YouTube delivery result arrives on the SSE event stream (`GET /events`).

---

## `POST /captions` — Send Captions

Queue one or more captions for delivery to YouTube. Returns `202 Accepted` immediately; the actual YouTube delivery result arrives on the SSE event stream (`GET /events`).

**Authentication:** Bearer JWT

Captions are serialised per session (using an internal send queue) to keep sequence numbers monotonic, even if multiple `POST /captions` requests arrive concurrently.

**Request**

```http
POST /captions
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "captions": [
    { "text": "Hello, world!" },
    { "text": "Second line", "timestamp": "2024-01-01T12:00:02.000" },
    { "text": "Third line",  "time": 5000 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `captions` | `array` | Yes | Array of caption objects (at least one required) |
| `captions[].text` | `string` | Yes | Caption text |
| `captions[].timestamp` | `string \| number` | No | ISO string (`YYYY-MM-DDTHH:MM:SS.mmm`) or Unix milliseconds. Defaults to current server time. |
| `captions[].time` | `number` | No | Milliseconds since session `startedAt`. Resolved by the server as `startedAt + time + syncOffset`. Cannot be combined with `timestamp`. |

**Response — `202 Accepted`**

```json
{
  "ok": true,
  "requestId": "a1b2c3d4e5f6..."
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | Always `true` for a 202 response |
| `requestId` | `string` | Correlates to a `caption_result` or `caption_error` SSE event |

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid or empty captions array |
| `401` | Missing or invalid JWT |
| `429` | Daily or lifetime usage limit exceeded |

