# LCYT - Live Captions for YouTube (Core Library)

[![npm version](https://img.shields.io/npm/v/lcyt.svg)](https://www.npmjs.com/package/lcyt)

Node.js library for sending live captions to YouTube Live streams using Google's official closed caption ingestion API.

> Looking for the CLI? See [`lcyt-cli`](https://www.npmjs.com/package/lcyt-cli).

## Installation

```bash
npm install lcyt
```

## Quick Start (ESM)

```javascript
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({
  streamKey: 'YOUR_STREAM_KEY'
});

sender.start();
await sender.send('Hello, world!');
sender.end();
```

## Quick Start (CommonJS)

```javascript
const { YoutubeLiveCaptionSender } = require('lcyt');

const sender = new YoutubeLiveCaptionSender({
  streamKey: 'YOUR_STREAM_KEY'
});

sender.start();

sender.send('Hello, world!').then(() => {
  sender.end();
});
```

## Usage Examples

```javascript
// Send with auto-generated timestamp
await sender.send('Hello, world!');

// Send with a Date object
await sender.send('Custom timestamp', new Date());

// Send with epoch milliseconds
await sender.send('Custom timestamp', Date.now());

// Send with a relative offset (2 seconds ago)
await sender.send('Custom timestamp', -2);

// Send with an ISO string timestamp
await sender.send('Custom timestamp', '2024-01-15T12:00:00.000');

// Send multiple captions in one batch
await sender.sendBatch([
  { text: 'First caption' },
  { text: 'Second caption', timestamp: new Date() },
  { text: 'Third caption', timestamp: '2024-01-15T12:00:01.000' }
]);

// Or use construct() to build a batch, then send
sender.construct('First caption');
sender.construct('Second caption', new Date());
sender.construct('Third caption', '2024-01-15T12:00:01.000');
await sender.sendBatch(); // Sends the queued captions

// Send heartbeat to verify connection
const result = await sender.heartbeat();
console.log('Server time:', result.serverTimestamp);

// Synchronize clock with YouTube's server (NTP-style)
const syncResult = await sender.sync();
console.log(`Offset: ${syncResult.syncOffset}ms, RTT: ${syncResult.roundTripTime}ms`);
```

## Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `streamKey` | string | `null` | YouTube stream key (cid value) |
| `baseUrl` | string | `'http://upload.youtube.com/closedcaption'` | Base ingestion URL |
| `ingestionUrl` | string | `null` | Full pre-built URL (overrides streamKey/baseUrl) |
| `region` | string | `'reg1'` | Region identifier |
| `cue` | string | `'cue1'` | Cue identifier |
| `useRegion` | boolean | `false` | Include region/cue in caption body (optional) |
| `sequence` | number | `0` | Starting sequence number |
| `useSyncOffset` | boolean | `false` | Apply syncOffset to auto-generated timestamps |
| `verbose` | boolean | `false` | Enable verbose logging |

## Methods

### `start()`
Initialize the sender. Must be called before sending captions.

### `send(text, timestamp?)`
Send a single caption. Returns a Promise.

`timestamp` accepts:
- `Date` object
- `number >= 1000` — Unix epoch in **milliseconds** (`Date.now()` style)
- `number < 1000` or negative — relative offset in **seconds** from now (e.g. `-2` = 2 seconds ago)
- ISO string `YYYY-MM-DDTHH:MM:SS.mmm` — used as-is
- ISO string with trailing `Z` — `Z` is stripped automatically
- Omitted — current time (sync offset applied if enabled)

```javascript
const result = await sender.send('Hello', '2024-01-15T12:00:00.000');
// result: { sequence, timestamp, statusCode, response, serverTimestamp }
```

### `construct(text, timestamp?)`
Add a caption to the internal queue for later batch sending.

`timestamp` accepts the same forms as `send()`.

```javascript
sender.construct('First caption');
sender.construct('Second caption', new Date());
sender.construct('Third caption', '2024-01-15T12:00:00.500');
console.log(sender.getQueue().length); // 3
```

### `getQueue()` / `clearQueue()`
Get a copy of the current queue, or clear it.

```javascript
const queue = sender.getQueue();     // Returns copy of queue array
const cleared = sender.clearQueue(); // Returns number of cleared captions
```

### `sendBatch(captions?)`
Send multiple captions in a single POST request. If no array is provided, sends and clears the internal queue built with `construct()`.

```javascript
const result = await sender.sendBatch([
  { text: 'Caption 1' },
  { text: 'Caption 2', timestamp: new Date() },
  { text: 'Caption 3', timestamp: '2024-01-15T12:00:00.500' }
]);
// result: { sequence, count, statusCode, response, serverTimestamp }
```

### `heartbeat()`
Send an empty POST to verify connection. Does not increment the sequence number.

```javascript
const result = await sender.heartbeat();
// result: { sequence, statusCode, serverTimestamp }
```

### `sync()`
Synchronize the local clock with YouTube's server clock (NTP-style midpoint estimation).
Automatically sets `useSyncOffset = true`.

```javascript
const result = await sender.sync();
// result: { syncOffset, roundTripTime, serverTimestamp, statusCode }
console.log(`Offset: ${result.syncOffset}ms, RTT: ${result.roundTripTime}ms`);
```

### `getSyncOffset()` / `setSyncOffset(offset)`
Get or set the clock offset in milliseconds.

```javascript
const offset = sender.getSyncOffset();
sender.setSyncOffset(-50); // Manually correct by -50ms
```

### `end()`
Stop the sender and cleanup.

### `getSequence()` / `setSequence(seq)`
Get or set the current sequence number.

```javascript
const seq = sender.getSequence();
sender.setSequence(100);
```

## Backend Relay (BackendCaptionSender)

Use `BackendCaptionSender` to route captions through an `lcyt-backend` relay instead of
sending directly to YouTube. This is useful in browser environments or when direct access
to YouTube's ingestion URL is restricted.

```javascript
import { BackendCaptionSender } from 'lcyt/backend';

const sender = new BackendCaptionSender({
  backendUrl: 'https://captions.example.com',
  apiKey: 'a1b2c3d4-...',
  streamKey: 'YOUR_YOUTUBE_KEY'
});

await sender.start();

// send() and sendBatch() return immediately with { ok, requestId }.
// YouTube delivery happens asynchronously on the backend.
// Subscribe to GET /events on the backend to receive the real outcome.
const { requestId } = await sender.send('Hello!');
await sender.send('With session time', { time: 5000 }); // 5s since session start
await sender.sync();
await sender.end();
```

### Async delivery

Unlike `YoutubeLiveCaptionSender`, `BackendCaptionSender.send()` and `sendBatch()` do **not** block until YouTube responds. They return `{ ok: true, requestId: string }` as soon as the backend acknowledges the request (`202 Accepted`). The actual delivery result — sequence number, YouTube status code, server timestamp — arrives later on the backend's `GET /events` SSE stream.

The backend serialises concurrent sends per session internally, so sequence numbers always stay monotonically increasing even when sends are fired in rapid succession.

`BackendCaptionSender` exposes the same interface as `YoutubeLiveCaptionSender`
(`send`, `sendBatch`, `construct`, `getQueue`, `clearQueue`, `sync`, `heartbeat`,
`getSequence`, `setSequence`, `getSyncOffset`, `setSyncOffset`) plus `getStartedAt()`.
Note: `getSequence()` reflects the last server-confirmed value (updated via `heartbeat()`),
not the in-flight value.

## Error Handling

ESM:
```javascript
import { ConfigError, NetworkError, ValidationError } from 'lcyt/errors';
```

CommonJS:
```javascript
const { ConfigError, NetworkError, ValidationError } = require('lcyt/errors');
```

```javascript
try {
  await sender.send('Hello');
} catch (err) {
  if (err instanceof ConfigError) {
    console.log('Configuration error:', err.message);
  } else if (err instanceof NetworkError) {
    console.log('Network error:', err.message, err.statusCode);
  } else if (err instanceof ValidationError) {
    console.log('Validation error:', err.message, err.field);
  }
}
```

## Subpath Exports

ESM:
```javascript
import { YoutubeLiveCaptionSender } from 'lcyt';            // Main class
import { BackendCaptionSender } from 'lcyt/backend';         // Backend relay client
import { ConfigError, ValidationError } from 'lcyt/errors';  // Error classes
import { loadConfig, saveConfig } from 'lcyt/config';        // Config utilities
import logger from 'lcyt/logger';                             // Logger
```

CommonJS:
```javascript
const { YoutubeLiveCaptionSender } = require('lcyt');
const { BackendCaptionSender } = require('lcyt/backend');
const { ConfigError, ValidationError } = require('lcyt/errors');
const { loadConfig, saveConfig } = require('lcyt/config');
const logger = require('lcyt/logger');
```

## Google Caption Format

LCYT implements Google's official YouTube Live caption format:

- **Method:** POST to `{baseUrl}?cid={streamKey}&seq={sequence}`
- **Content-Type:** `text/plain` (no charset!)
- **Body** must end with a trailing newline
- Use `<br>` for line breaks within caption text

### Timestamp Format

YouTube requires timestamps in the format:

```
YYYY-MM-DDTHH:MM:SS.mmm
```

- No trailing `Z`, no UTC offset — millisecond precision
- Example: `2024-01-15T12:00:00.000`
- **Must be within 60 seconds** of the server's current time

### Body Format

```
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

The region/cue suffix is optional and controlled by the `useRegion` constructor option.

## License

MIT
