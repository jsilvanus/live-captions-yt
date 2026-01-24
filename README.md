# LCYT - Live Caption Tool for YouTube

Send live captions to YouTube Live streams using Google's official closed caption API format.

## Installation

```bash
npm install -g lcyt
```

Or install locally:

```bash
npm install lcyt
```

## Quick Start

1. **Set up your YouTube stream key:**

```bash
lcyt --stream-key "YOUR_STREAM_KEY"
```

2. **Send a caption:**

```bash
lcyt "Hello, world!"
```

3. **Or start interactive mode:**

```bash
lcyt -i
```

> **Note:** The `--use-region` flag includes the `region:reg1#cue1` identifier in the caption body. This is optional but supported by YouTube.

## CLI Usage

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--stream-key <key>` | `-k` | YouTube stream key (cid value) |
| `--base-url <url>` | `-u` | Base ingestion URL (default: http://upload.youtube.com/closedcaption) |
| `--region <reg>` | `-r` | Region identifier (default: reg1) |
| `--cue <cue>` | | Cue identifier (default: cue1) |
| `--use-region` | | Include region/cue in caption body (optional) |
| `--interactive` | `-i` | Interactive mode (read from stdin) |
| `--heartbeat` | | Send heartbeat to verify connection |
| `--timestamp <iso>` | `-t` | Manual ISO timestamp override |
| `--reset` | | Reset sequence counter to 0 |
| `--config <path>` | `-c` | Config file path |
| `--verbose` | `-v` | Enable verbose output |
| `--help` | `-h` | Show help |
| `--version` | | Show version number |

### Examples

**Set up stream key:**
```bash
lcyt --stream-key "ABC123"
```

**Send single caption:**
```bash
lcyt "Hello world"
```

**Send heartbeat to verify connection:**
```bash
lcyt --heartbeat
```

**Interactive mode:**
```bash
lcyt -i
```

Interactive mode commands:
- `<text>` - Send single caption
- `timestamp|text` - Send with custom timestamp
- `/batch` - Start batch mode (collect multiple captions)
- `/send` - Send collected batch
- `/heartbeat` - Send heartbeat
- `/status` - Show current status
- `Ctrl+C` - Exit

**View current config:**
```bash
lcyt
```

**Reset sequence counter:**
```bash
lcyt --reset
```

## Library API

### Basic Usage

```javascript
const { YoutubeLiveCaptionSender } = require('lcyt');

const sender = new YoutubeLiveCaptionSender({
  streamKey: 'YOUR_STREAM_KEY'
});

sender.start();

// Send a single caption
await sender.send('Hello, world!');

// Send with custom timestamp
await sender.send('Custom timestamp', '2024-01-15T12:00:00.000');

// Send multiple captions in one batch (direct array)
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

sender.end();
```

### Constructor Options

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

### Methods

#### `start()`
Initialize the sender. Must be called before sending captions.

```javascript
sender.start();
```

#### `send(text, timestamp?)`
Send a single caption. Returns a Promise.

```javascript
const result = await sender.send('Hello', '2024-01-15T12:00:00.000');
// result: { sequence, timestamp, statusCode, response, serverTimestamp }
```

#### `construct(text, timestamp?)`
Add a caption to the internal queue for later batch sending.

```javascript
sender.construct('First caption');
sender.construct('Second caption', '2024-01-15T12:00:00.500');
console.log(sender.getQueue().length); // 2
```

#### `getQueue()`
Get a copy of the current caption queue.

```javascript
const queue = sender.getQueue();
// [{ text: 'First caption', timestamp: null }, { text: 'Second caption', timestamp: '...' }]
```

#### `clearQueue()`
Clear all captions from the queue.

```javascript
const cleared = sender.clearQueue(); // Returns number of cleared captions
```

#### `sendBatch(captions?)`
Send multiple captions in a single POST request. If no array is provided, sends the internal queue built with `construct()`.

```javascript
// Option 1: Pass array directly
const result = await sender.sendBatch([
  { text: 'Caption 1' },
  { text: 'Caption 2', timestamp: '2024-01-15T12:00:00.500' }
]);

// Option 2: Use construct() then sendBatch()
sender.construct('Caption 1');
sender.construct('Caption 2');
const result = await sender.sendBatch(); // Sends queue and clears it

// result: { sequence, count, statusCode, response, serverTimestamp }
```

#### `heartbeat()`
Send an empty POST to verify connection. Can be used for clock synchronization.

```javascript
const result = await sender.heartbeat();
// result: { sequence, statusCode, serverTimestamp }
```

#### `end()`
Stop the sender and cleanup.

```javascript
sender.end();
```

#### `getSequence()` / `setSequence(seq)`
Get or set the current sequence number.

```javascript
const seq = sender.getSequence();
sender.setSequence(100);
```

## Google Caption Format

LCYT implements Google's official YouTube Live caption format:

### Request Format
- **Method:** POST
- **Content-Type:** `text/plain`
- **URL params:** `cid=<stream_key>&seq=N`

### Body Format
```
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
ANOTHER CAPTION
```

> **Important Requirements:**
> - **Timestamps must be within 60 seconds** of the server's current time
> - **Body must end with a trailing newline** (`\n`)
> - Region/cue identifier after timestamp is optional (`region:reg1#cue1`)

### Example POST
```
POST /closedcaption?cid=YOUR_KEY&seq=42
Content-Type: text/plain

2024-01-15T12:00:06.873 region:reg1#cue1
Hello, this is my caption
2024-01-15T12:00:07.500 region:reg1#cue1
And here's another line
```

### Line Breaks
Use `<br>` within caption text for line breaks:
```javascript
await sender.send('Line one<br>Line two');
```

## Configuration

LCYT stores configuration in `~/.lcyt-config.json`:

```json
{
  "baseUrl": "http://upload.youtube.com/closedcaption",
  "streamKey": "YOUR_STREAM_KEY",
  "region": "reg1",
  "cue": "cue1",
  "sequence": 42
}
```

### URL Construction

The full ingestion URL is constructed as:

```
{baseUrl}?cid={streamKey}&seq={sequence}
```

## YouTube Setup

To get your YouTube Live caption ingestion URL and key:

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** → **Go Live**
3. Set up your stream settings
4. Look for **Closed captions** in the stream settings
5. Enable **POST captions to URL**
6. Copy the ingestion URL and stream key

## Error Handling

LCYT provides custom error classes for different error types:

```javascript
const { ConfigError, NetworkError, ValidationError } = require('lcyt/src/errors');

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

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT
