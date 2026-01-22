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

1. **Set up your YouTube ingestion URL and stream key:**

```bash
lcyt --url "https://www.youtube.com/api/closedcaption" --yt-key "YOUR_STREAM_KEY"
```

2. **Send a caption:**

```bash
lcyt "Hello, world!"
```

3. **Or start interactive mode:**

```bash
lcyt -i
```

## CLI Usage

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--url <url>` | `-u` | Base ingestion URL |
| `--yt-key <key>` | | YouTube stream key (appends `?cid=<key>`) |
| `--key <key>` | `-k` | Generic service key (appended as-is) |
| `--interactive` | `-i` | Interactive mode (read from stdin) |
| `--heartbeat` | | Send heartbeat to verify connection |
| `--timestamp <iso>` | `-t` | Manual ISO timestamp override |
| `--reset` | | Reset sequence counter to 0 |
| `--config <path>` | `-c` | Config file path |
| `--verbose` | `-v` | Enable verbose output |
| `--help` | `-h` | Show help |
| `--version` | | Show version number |

### Examples

**Set up YouTube key:**
```bash
lcyt --url "https://www.youtube.com/api/closedcaption" --yt-key "ABC123"
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
  ingestionUrl: 'https://www.youtube.com/api/closedcaption?cid=YOUR_KEY',
  lang: 'en',
  name: 'LCYT'
});

sender.start();

// Send a single caption
await sender.send('Hello, world!');

// Send with custom timestamp
await sender.send('Custom timestamp', '2024-01-15T12:00:00.000');

// Send multiple captions in one batch
await sender.sendBatch([
  { text: 'First caption' },
  { text: 'Second caption' },
  { text: 'Third caption', timestamp: '2024-01-15T12:00:01.000' }
]);

// Send heartbeat to verify connection
const result = await sender.heartbeat();
console.log('Server time:', result.serverTimestamp);

sender.end();
```

### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ingestionUrl` | string | `null` | Caption ingestion endpoint URL |
| `lang` | string | `'en'` | Language code |
| `name` | string | `'LCYT'` | Track name |
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

#### `sendBatch(captions)`
Send multiple captions in a single POST request.

```javascript
const result = await sender.sendBatch([
  { text: 'Caption 1' },
  { text: 'Caption 2', timestamp: '2024-01-15T12:00:00.500' }
]);
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
- **URL params:** `&seq=N&key=yt_qc`

### Body Format
```
YYYY-MM-DDTHH:MM:SS.mmm
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

### Example POST
```
POST /closedcaption?cid=YOUR_KEY&seq=42&key=yt_qc
Content-Type: text/plain

2024-01-15T12:00:06.873
Hello, this is my caption
2024-01-15T12:00:07.500
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
  "url": "https://www.youtube.com/api/closedcaption",
  "ytKey": "YOUR_STREAM_KEY",
  "key": null,
  "sequence": 42
}
```

### URL Construction

The full ingestion URL is constructed based on your configuration:

- **YouTube key**: `url + "?cid=" + ytKey`
- **Generic key**: `url + key`
- **No key**: `url` as-is

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
