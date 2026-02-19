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

// Send with an ISO string timestamp
await sender.send('Custom timestamp', '2024-01-15T12:00:00.000');

// Send multiple captions in one batch (timestamps can be Date objects or strings)
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
| `verbose` | boolean | `false` | Enable verbose logging |

## Methods

### `start()`
Initialize the sender. Must be called before sending captions.

### `send(text, timestamp?)`
Send a single caption. Returns a Promise.

`timestamp` can be a `Date` object, an ISO string (`YYYY-MM-DDTHH:MM:SS.mmm`), or omitted (auto-generated). Must be within 60 seconds of the server's current time.

```javascript
// ISO string
const result = await sender.send('Hello', '2024-01-15T12:00:00.000');
// Date object
const result2 = await sender.send('Hello', new Date());
// result: { sequence, timestamp, statusCode, response, serverTimestamp }
```

### `construct(text, timestamp?)`
Add a caption to the internal queue for later batch sending.

`timestamp` accepts the same formats as `send()` (Date object, ISO string, or omitted).

```javascript
sender.construct('First caption');
sender.construct('Second caption', new Date());
sender.construct('Third caption', '2024-01-15T12:00:00.500');
console.log(sender.getQueue().length); // 3
```

### `getQueue()` / `clearQueue()`
Get a copy of the current queue, or clear it.

```javascript
const queue = sender.getQueue();   // Returns copy of queue array
const cleared = sender.clearQueue(); // Returns number of cleared captions
```

### `sendBatch(captions?)`
Send multiple captions in a single POST request. If no array is provided, sends and clears the internal queue built with `construct()`.

Each caption's `timestamp` can be a `Date` object, an ISO string, or omitted (auto-generated 100ms apart).

```javascript
const result = await sender.sendBatch([
  { text: 'Caption 1' },
  { text: 'Caption 2', timestamp: new Date() },
  { text: 'Caption 3', timestamp: '2024-01-15T12:00:00.500' }
]);
// result: { sequence, count, statusCode, response, serverTimestamp }
```

### `heartbeat()`
Send an empty POST to verify connection. Can be used for clock synchronization.

```javascript
const result = await sender.heartbeat();
// result: { sequence, statusCode, serverTimestamp }
```

### `end()`
Stop the sender and cleanup.

### `getSequence()` / `setSequence(seq)`
Get or set the current sequence number.

```javascript
const seq = sender.getSequence();
sender.setSequence(100);
```

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

The package provides additional subpath exports:

ESM:
```javascript
import { YoutubeLiveCaptionSender } from 'lcyt';           // Main export
import { ConfigError, ValidationError } from 'lcyt/errors'; // Error classes
import { loadConfig, saveConfig } from 'lcyt/config';       // Config utilities
import logger from 'lcyt/logger';                            // Logger
```

CommonJS:
```javascript
const { YoutubeLiveCaptionSender } = require('lcyt');
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

- No trailing `Z`, no UTC offset — local wall-clock format with millisecond precision
- Example: `2024-01-15T12:00:00.000`
- **Must be within 60 seconds** of the server's current time

LCYT accepts timestamps as:
- A `Date` object — converted automatically
- A `number >= 1000` — Unix epoch in **milliseconds** (`Date.now()` style)
- A `number < 1000` or negative — relative offset in **seconds** from now (e.g. `-2` = 2 seconds ago, `0` = now)
- An ISO string with trailing `Z` (e.g. `2024-01-15T12:00:00.000Z`) — `Z` is stripped automatically
- A pre-formatted string (`YYYY-MM-DDTHH:MM:SS.mmm`) — used as-is
- Omitted — current time is used

### Body Format

```
YYYY-MM-DDTHH:MM:SS.mmm [region:reg1#cue1]
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

The region/cue suffix is optional and controlled by the `useRegion` constructor option.

## License

MIT
