# LCYT - Live Captions for YouTube

[![npm version](https://img.shields.io/npm/v/lcyt.svg)](https://www.npmjs.com/package/lcyt)
[![PyPI version](https://img.shields.io/pypi/v/lcyt.svg)](https://pypi.org/project/lcyt/)

Send live captions to YouTube Live streams using Google's official closed caption ingestion url.

To use this package, you first need to:
1. Set up a live in Youtube, set it to 30 second delay and to receive captions via HTTP POST requests.
2. Start the live and then send the captions with the stream key (and in correct sequence).
3. ...
4. Profit! (Captions are visible in the live!)

## Available Packages

| Package | Platform | Installation |
|---------|----------|--------------|
| **Node.js** | npm | `npm install lcyt` |
| **Python** | PyPI | `pip install lcyt` |

A CLI (using Node.js) is included in `bin/lcyt`.

> **Python users:** See the [Python package documentation](python/README.md) for Python-specific API reference and examples.

## Installation

```bash
npm install lcyt
```

```bash
pip install lcyt
```

## Quick Start with CLI (bin/lcyt)

1. **Set up your YouTube stream key:**

```bash
lcyt --stream-key "YOUR_STREAM_KEY"
```

2. **Send heartbeat to verify connection: (optional)**
```bash
lcyt --heartbeat
```


3. **Send a caption:**

```bash
lcyt "Hello, world!"
```

4. **Or start interactive mode:**

```bash
lcyt -i
```

5. **Or start full-screen interactive mode:**

```bash
lcyt -f
```

The full-screen mode provides a rich terminal UI with:
- File loading capability (`/load <file>`)
- Visual context display (2 previous + current + 5 next lines)
- Sent history tracking
- Easy navigation with arrow keys
- Press Enter to send current line and advance
- Use +N/-N commands to jump multiple lines

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--stream-key <key>` | `-k` | YouTube stream key (cid value) |
| `--base-url <url>` | `-u` | Base ingestion URL (default: http://upload.youtube.com/closedcaption) |
| `--region <reg>` | `-r` | Region identifier (default: reg1) |
| `--cue <cue>` | | Cue identifier (default: cue1) |
| `--use-region` | | Include region/cue in caption body (optional) |
| `--interactive` | `-i` | Interactive mode (read from stdin) |
| `--fullscreen` | `-f` | Full-screen interactive mode with file loading |
| `--show-config` | | Show current configuration |
| `--heartbeat` | | Send heartbeat to verify connection |
| `--timestamp <iso>` | `-t` | Manual ISO timestamp override |
| `--reset` | | Reset sequence counter to 0 |
| `--config <path>` | `-c` | Config file path |
| `--verbose` | `-v` | Enable verbose output |
| `--help` | `-h` | Show help |
| `--version` | | Show version number |

### Interactive mode commands

**Standard interactive mode (`-i`):**
- `<text>` - Send single caption
- `timestamp|text` - Send with custom timestamp
- `/batch [seconds]` - Start auto-batch mode (default: 5s). Captions auto-send after timeout from first caption
- `/send` - Send collected batch immediately (also ENTER on empty line works)
- `/heartbeat` - Send heartbeat
- `/status` - Show current status
- `Ctrl+C` - Exit

Example batch usage:
```bash
lcyt -i
/batch 10        # Start batch mode with 10 second timeout
Caption 1        # Timer starts here
Caption 2        # Added to batch
Caption 3        # Added to batch
# ... after 10 seconds from first caption, batch auto-sends
```

**Full-screen interactive mode (`-f`):**

Keyboard shortcuts:
- `Enter` - Send current file line and advance to next
- `:` or `/` - Open prompt to type custom text or commands
- `↑` / `k` - Move to previous line
- `↓` / `j` - Move to next line
- `PageUp` / `PageDown` - Move up/down 10 lines
- `Tab` - Switch focus between text preview and history
- `h` - Show help
- `q` or `Ctrl+C` - Quit

**Custom Captions:**
Press `:` or `/` to open the prompt. You can:
- Type a command starting with `/` (e.g., `/load script.txt`)
- Type plain text to send as a custom caption (e.g., `Hello world`)
- Custom captions don't move the file pointer
- Works with batch mode too!

Commands (type `:` or `/` first, then the command):
- `/load <file>` - Load a text file
- `/reload` - Reload the current file
- `/goto <N>` - Jump to line number N
- `/batch [seconds]` - Toggle batch mode (auto-send after N seconds, default 5)
- `/send` - Send batch immediately
- `/status` - Show current status (line number, file, sequence, batch status)
- `/heartbeat` - Send heartbeat to verify connection
- `+N` - Shift pointer forward N lines (e.g., `+5` moves 5 lines down)
- `-N` - Shift pointer backward N lines (e.g., `-3` moves 3 lines up)

Example workflow:
```bash
# Start full-screen mode
lcyt -f

# In the UI, press : or / to open the prompt, then:
/load script.txt      # Load a file

# Navigate with arrow keys, press Enter to send file lines
# Or use +10 to skip forward 10 lines
# Use /goto 50 to jump to line 50

# Send a custom caption (press : then type):
Hello viewers!       # Sends custom text, pointer stays on same line

# Enable batch mode for rapid caption sending
/batch 3             # Set 3 second auto-send timeout
# Now press Enter multiple times to queue file lines
# Or press : to add custom captions to the batch
# They'll auto-send 3 seconds after the first one
```

### Sequence

Youtube requires an incrementing sequence counter for each stream.

**Reset sequence counter:**
You will need this, if you have to restart the stream.
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

Note: Do not to try to add charset in the Content-Type!

### Body Format
```
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

> **Important Requirements:**
> - **Timestamps must be within 60 seconds** of the server's current time
> - **Body must end with a trailing newline** (`\n`)
> - Region/cue identifier after timestamp is optional (`region:reg1#cue1`). The effects of the regions and cues is not documented and has not been tested.

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
6. Copy the ingestion URL (this is usually stable and has been added as a default) and stream key

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
