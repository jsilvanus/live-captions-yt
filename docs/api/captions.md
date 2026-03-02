# Caption Delivery

Endpoints for sending captions and receiving real-time delivery results via SSE.

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

---

## `GET /events` — SSE Event Stream

Open a persistent Server-Sent Events connection to receive real-time caption delivery results and session events.

**Authentication:** Bearer JWT (via `Authorization: Bearer <token>` header) or query parameter (`?token=<JWT>`)

The query parameter form is useful for `EventSource` in browsers, which cannot set custom headers.

**Request**

```http
GET /events
Authorization: Bearer <token>
Accept: text/event-stream
```

or

```
GET /events?token=<JWT>
```

**Response — `200 OK`** (streaming, `Content-Type: text/event-stream`)

The connection stays open until the session ends or the client disconnects.

---

### SSE Events

#### `connected`

Sent immediately after the SSE connection is established.

```
event: connected
data: {"sessionId":"a1b2c3...","micHolder":null}
```

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string` | The session identifier |
| `micHolder` | `string \| null` | Client ID currently holding the mic lock, or `null` |

---

#### `caption_result`

Sent after a caption (or batch) is successfully delivered to YouTube.

```
event: caption_result
data: {"requestId":"...","sequence":7,"statusCode":200,"serverTimestamp":"2024-01-01T12:00:00.082","count":1}
```

| Field | Type | Description |
|---|---|---|
| `requestId` | `string` | Matches the `requestId` from `POST /captions` |
| `sequence` | `number` | Sequence number used for this delivery |
| `statusCode` | `number` | HTTP status from YouTube |
| `serverTimestamp` | `string` | Timestamp returned by YouTube |
| `count` | `number` | Number of captions in the batch (present for batch sends) |

---

#### `caption_error`

Sent when caption delivery to YouTube fails.

```
event: caption_error
data: {"requestId":"...","error":"HTTP 403: Forbidden","statusCode":403,"sequence":7}
```

| Field | Type | Description |
|---|---|---|
| `requestId` | `string` | Matches the `requestId` from `POST /captions` |
| `error` | `string` | Human-readable error message |
| `statusCode` | `number \| undefined` | HTTP status code from YouTube (if available) |
| `sequence` | `number \| undefined` | Sequence number at the time of failure |

---

#### `mic_state`

Sent when the soft mic lock changes (see [`POST /mic`](./stats.md#post-mic--mic-lock)).

```
event: mic_state
data: {"holder":"client-abc"}
```

| Field | Type | Description |
|---|---|---|
| `holder` | `string \| null` | Client ID now holding the mic, or `null` if released |

---

#### `session_closed`

Sent when the session is terminated (by `DELETE /live`, TTL expiry, or GDPR erasure).

```
event: session_closed
data: {}
```

After receiving this event, the client should close the SSE connection and stop sending captions.

---

## Example: Full Client Flow (Browser)

```js
// 1. Register session
const reg = await fetch('/live', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey, streamKey, domain: location.origin }),
});
const { token } = await reg.json();

// 2. Open SSE stream
const es = new EventSource(`/events?token=${token}`);

es.addEventListener('caption_result', (e) => {
  const { requestId, sequence, statusCode } = JSON.parse(e.data);
  console.log('Delivered:', requestId, 'seq', sequence, 'status', statusCode);
});

es.addEventListener('caption_error', (e) => {
  const { requestId, error } = JSON.parse(e.data);
  console.error('Failed:', requestId, error);
});

es.addEventListener('session_closed', () => {
  es.close();
});

// 3. Send a caption
const res = await fetch('/captions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ captions: [{ text: 'Hello, world!' }] }),
});
const { requestId } = await res.json();
// Wait for caption_result with matching requestId on the SSE stream
```
