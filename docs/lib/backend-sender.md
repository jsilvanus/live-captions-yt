# BackendCaptionSender

Relay-based caption sender that routes captions through an `lcyt-backend` HTTP server instead of calling YouTube directly. Mirrors the [`YoutubeLiveCaptionSender`](./sender.md) API.

**Import**
```js
import { BackendCaptionSender } from 'lcyt/backend';
// CJS
const { BackendCaptionSender } = require('lcyt/backend');
```

---

## Why Use the Relay?

- Hides your YouTube stream key behind an authenticated server
- Enables usage tracking, daily/lifetime limits, and GDPR controls
- Provides real-time caption delivery results via SSE (`GET /events`)
- Supports browser-based clients that cannot safely store a stream key

---

## Constructor

```js
new BackendCaptionSender(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `backendUrl` | `string` | — | Base URL of the `lcyt-backend` server (required) |
| `apiKey` | `string` | — | API key issued by the backend (required) |
| `streamKey` | `string` | — | YouTube Live stream key (required) |
| `domain` | `string` | — | Registered origin domain for this session (required) |
| `sequence` | `number` | `0` | Initial sequence number |
| `verbose` | `boolean` | `false` | Enable verbose logging |

---

## Methods

### `start()`

Register a session with the backend. Exchanges your API key + stream key for a JWT that is used for all subsequent requests.

```js
await sender.start();
```

**Returns:** `Promise<void>`

**Throws:** [`NetworkError`](./errors.md#networkerror) if the backend rejects registration.

---

### `send(text, timestamp?)`

Queue a single caption for delivery. Returns immediately with `202 Accepted`; the actual YouTube delivery result arrives on the SSE event stream (`GET /events`).

```js
const result = await sender.send('Hello!');
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` | Caption text |
| `timestamp` | `string \| number \| {time: number}` | Optional. ISO string, Unix ms, or `{time: ms}` (milliseconds since session start) |

> **Timestamp formats**
> - ISO string: `'2024-01-01T12:00:00.000'`
> - Unix milliseconds: `1704067200000`
> - Relative: `{ time: 5000 }` — 5 seconds after the session `startedAt` (resolved by the server)

**Returns:** `Promise<{ok: true, requestId: string}>`

The `requestId` correlates to the `caption_result` / `caption_error` SSE event.

---

### `sendBatch(captions)`

Send multiple captions in one request.

```js
const result = await sender.sendBatch([
  { text: 'Line one' },
  { text: 'Line two', timestamp: { time: 3000 } },
]);
```

| Parameter | Type | Description |
|---|---|---|
| `captions` | `Array<{text: string, timestamp?: string \| number \| {time: number}}>` | Captions array |

**Returns:** `Promise<{ok: true, requestId: string}>`

---

### `construct(text, timestamp?)`

Add a caption to the internal queue without sending.

```js
sender.construct('Buffered caption');
```

---

### `getQueue()` / `clearQueue()`

Read or empty the internal caption queue.

```js
const queue = sender.getQueue();
sender.clearQueue();
```

---

### `heartbeat()`

Test connectivity to the backend without sending a real caption.

```js
await sender.heartbeat();
```

**Returns:** `Promise<{ok: true}>`

---

### `sync()`

Perform a clock synchronisation round-trip via `POST /sync` on the backend.

```js
const result = await sender.sync();
```

**Returns:** `Promise<{syncOffset: number, roundTripTime: number, serverTimestamp: string, statusCode: number}>`

---

### `updateSession(fields)`

Update session metadata on the backend via `PATCH /live`.

```js
await sender.updateSession({ sequence: 10 });
```

| Parameter | Type | Description |
|---|---|---|
| `fields` | `{sequence?: number}` | Fields to update |

**Returns:** `Promise<{sequence: number}>`

---

### `getStartedAt()`

Return the session start timestamp (set by the backend when the session was created).

```js
const startedAt = sender.getStartedAt(); // ISO string
```

**Returns:** `string | undefined`

---

### `getSequence()` / `setSequence(seq)`

Read or set the local sequence counter.

---

### `getSyncOffset()` / `setSyncOffset(offset)`

Read or set the clock synchronisation offset (milliseconds).

---

### `end()`

Tear down the backend session (`DELETE /live`).

```js
await sender.end();
```

**Returns:** `Promise<void>`

---

## SSE Event Stream

After calling `start()`, connect to the backend's event stream to receive asynchronous delivery results:

```js
const url = `${backendUrl}/events?token=${jwtToken}`;
const es = new EventSource(url);

es.addEventListener('caption_result', (e) => {
  const { requestId, sequence, statusCode } = JSON.parse(e.data);
  console.log('Delivered:', requestId, 'seq', sequence, 'status', statusCode);
});

es.addEventListener('caption_error', (e) => {
  const { requestId, error, statusCode } = JSON.parse(e.data);
  console.error('Failed:', requestId, error);
});
```

See the [Backend API SSE docs](../api/captions.md#get-events) for the full event reference.

---

## Example

```js
import { BackendCaptionSender } from 'lcyt/backend';

const sender = new BackendCaptionSender({
  backendUrl: 'https://relay.example.com',
  apiKey: 'my-api-key',
  streamKey: 'xxxx-xxxx-xxxx-xxxx',
  domain: 'https://my-app.example.com',
});

await sender.start();
await sender.sync();

const { requestId } = await sender.send('Hello from the relay!');
console.log('Queued with requestId:', requestId);

await sender.end();
```
