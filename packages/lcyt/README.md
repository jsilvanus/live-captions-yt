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
// Send with custom timestamp
await sender.send('Custom timestamp', '2024-01-15T12:00:00.000');

// Send multiple captions in one batch
await sender.sendBatch([
  { text: 'First caption' },
  { text: 'Second caption' },
  { text: 'Third caption', timestamp: '2024-01-15T12:00:01.000' }
]);

// Or use construct() to build a batch, then send
sender.construct('First caption');
sender.construct('Second caption');
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

```javascript
const result = await sender.send('Hello', '2024-01-15T12:00:00.000');
// result: { sequence, timestamp, statusCode, response, serverTimestamp }
```

### `construct(text, timestamp?)`
Add a caption to the internal queue for later batch sending.

```javascript
sender.construct('First caption');
sender.construct('Second caption', '2024-01-15T12:00:00.500');
console.log(sender.getQueue().length); // 2
```

### `getQueue()` / `clearQueue()`
Get a copy of the current queue, or clear it.

```javascript
const queue = sender.getQueue();   // Returns copy of queue array
const cleared = sender.clearQueue(); // Returns number of cleared captions
```

### `sendBatch(captions?)`
Send multiple captions in a single POST request. If no array is provided, sends and clears the internal queue built with `construct()`.

```javascript
const result = await sender.sendBatch([
  { text: 'Caption 1' },
  { text: 'Caption 2', timestamp: '2024-01-15T12:00:00.500' }
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
- **Timestamps** must be within 60 seconds of server time
- **Body** must end with a trailing newline
- Use `<br>` for line breaks within caption text

## License

MIT
