# YoutubeLiveCaptionSender

Direct caption delivery to YouTube Live via Google's HTTP POST ingestion API.

**Import**
```js
import { YoutubeLiveCaptionSender } from 'lcyt';
// CJS
const { YoutubeLiveCaptionSender } = require('lcyt');
```

---

## Constructor

```js
new YoutubeLiveCaptionSender(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `streamKey` | `string` | — | YouTube Live stream key (required unless `ingestionUrl` is provided) |
| `baseUrl` | `string` | `'http://upload.youtube.com'` | YouTube ingestion base URL |
| `ingestionUrl` | `string` | built from `baseUrl` + `streamKey` | Override the full ingestion URL |
| `region` | `string` | `'us'` | YouTube region hint (`us`, `eu`, `asia`) |
| `cue` | `string` | `''` | Optional cue ID sent with each caption request |
| `useRegion` | `boolean` | `true` | Whether to include the region in the URL |
| `sequence` | `number` | `0` | Initial sequence number |
| `useSyncOffset` | `boolean` | `true` | Apply NTP-style clock offset when computing timestamps |
| `verbose` | `boolean` | `false` | Enable verbose logging |

---

## Methods

### `start()`

Initialize the sender. Call this before sending any captions.

```js
await sender.start();
```

**Returns:** `Promise<void>`

---

### `send(text, timestamp?)`

Send a single caption to YouTube.

```js
const result = await sender.send('Hello, world!');
const result = await sender.send('Hello!', '2024-01-01T12:00:00.000');
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` | Caption text to send |
| `timestamp` | `string \| number` | Optional. ISO string (`YYYY-MM-DDTHH:MM:SS.mmm`) or Unix milliseconds. Defaults to current time. |

**Returns:** `Promise<SendResult>`

```ts
interface SendResult {
  sequence: number;        // Sequence number used for this request
  timestamp: string;       // ISO timestamp sent to YouTube
  statusCode: number;      // HTTP status code from YouTube
  response: string;        // Raw response body from YouTube
  serverTimestamp: string; // Server-side timestamp (from YouTube response headers)
}
```

**Throws:** [`NetworkError`](./errors.md#networkerror) on non-2xx response.

---

### `sendBatch(captions)`

Send multiple captions in a single HTTP request.

```js
const result = await sender.sendBatch([
  { text: 'First line', timestamp: '2024-01-01T12:00:00.000' },
  { text: 'Second line', timestamp: '2024-01-01T12:00:02.000' },
]);
```

| Parameter | Type | Description |
|---|---|---|
| `captions` | `Array<{text: string, timestamp?: string \| number}>` | Array of caption objects |

**Returns:** `Promise<BatchSendResult>`

```ts
interface BatchSendResult {
  sequence: number;        // Sequence number of the last caption in the batch
  count: number;           // Number of captions sent
  statusCode: number;      // HTTP status code from YouTube
  response: string;        // Raw response body
  serverTimestamp: string; // Server-side timestamp
}
```

**Throws:** [`NetworkError`](./errors.md#networkerror) on non-2xx response.

---

### `construct(text, timestamp?)`

Add a caption to the internal queue without sending it.

```js
sender.construct('Caption 1');
sender.construct('Caption 2', '2024-01-01T12:00:05.000');
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` | Caption text |
| `timestamp` | `string \| number` | Optional timestamp (same format as `send()`) |

**Returns:** `void`

---

### `getQueue()`

Return the current internal caption queue.

```js
const queue = sender.getQueue();
// [{ text: 'Caption 1', timestamp: '...' }, ...]
```

**Returns:** `Array<{text: string, timestamp: string}>`

---

### `clearQueue()`

Clear all captions from the internal queue.

```js
sender.clearQueue();
```

**Returns:** `void`

---

### `heartbeat()`

Send an empty caption request to test connectivity without advancing captions.

```js
const result = await sender.heartbeat();
```

**Returns:** `Promise<HeartbeatResult>`

```ts
interface HeartbeatResult {
  sequence: number;
  statusCode: number;
  serverTimestamp: string;
}
```

**Throws:** [`NetworkError`](./errors.md#networkerror) on failure.

---

### `sync()`

Perform an NTP-style clock synchronisation against the YouTube server.

Updates the internal `syncOffset` used to compensate for local/server clock drift.

```js
const result = await sender.sync();
console.log(result.syncOffset); // e.g. 150 (ms)
```

**Returns:** `Promise<SyncResult>`

```ts
interface SyncResult {
  syncOffset: number;       // Computed offset in milliseconds (positive = server is ahead)
  roundTripTime: number;    // Round-trip latency in milliseconds
  serverTimestamp: string;  // ISO timestamp returned by YouTube
  statusCode: number;
}
```

---

### `end()`

Flush pending captions and clean up resources.

```js
await sender.end();
```

**Returns:** `Promise<void>`

---

### `getSequence()` / `setSequence(seq)`

Read or write the internal sequence counter.

```js
const seq = sender.getSequence(); // number
sender.setSequence(42);
```

---

### `getSyncOffset()` / `setSyncOffset(offset)`

Read or write the clock synchronisation offset (milliseconds).

```js
const offset = sender.getSyncOffset(); // number
sender.setSyncOffset(200);
```

---

## Example: Full Workflow

```js
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({
  streamKey: process.env.STREAM_KEY,
  verbose: true,
});

await sender.start();

// Synchronise clock
await sender.sync();

// Send individual captions
await sender.send('Welcome to the stream!');
await sender.send('Captions powered by lcyt.');

// Build a batch from a queue
sender.construct('Line one');
sender.construct('Line two');
await sender.sendBatch(sender.getQueue());
sender.clearQueue();

await sender.end();
```
