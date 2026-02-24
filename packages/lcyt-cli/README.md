# LCYT CLI - Live Captions for YouTube

[![npm version](https://img.shields.io/npm/v/lcyt-cli.svg)](https://www.npmjs.com/package/lcyt-cli)

Command-line tool for sending live captions to YouTube Live streams.

> Looking for the library? See [`lcyt`](https://www.npmjs.com/package/lcyt).

## Installation

```bash
npm install -g lcyt-cli
```

Or run directly with npx:

```bash
npx lcyt-cli
```

## Getting Started

### 1. Set up your YouTube stream key

```bash
lcyt --stream-key "YOUR_STREAM_KEY"
```

To get your stream key:
1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** > **Go Live**
3. In stream settings, find **Closed captions**
4. Enable **POST captions to URL**
5. Copy the stream key (cid value)

### 2. Verify connection (optional)

```bash
lcyt --heartbeat
```

### 3. Send captions

```bash
lcyt "Hello, world!"          # Send a single caption
lcyt -i                       # Start interactive mode
lcyt -f                       # Start full-screen interactive mode
```

When running via `npx lcyt-cli` without arguments, it defaults to full-screen mode.

## Options

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
| `--test` | | Send test payload from Google docs |
| `--timestamp <iso>` | `-t` | Manual ISO timestamp override |
| `--reset` | | Reset sequence counter to 0 |
| `--config <path>` | `-c` | Config file path |
| `--verbose` | `-v` | Enable verbose output |
| `--help` | `-h` | Show help |
| `--version` | | Show version number |
| `--log-stderr` | | Write human logs to `stderr` instead of `stdout` (env: `LCYT_LOG_STDERR=1`) |

## Interactive Mode (`-i`)

A simple line-by-line mode that reads from stdin.

```bash
lcyt -i
```

Commands:
- `<text>` - Send single caption
- `timestamp|text` - Send with custom timestamp
- `/batch [seconds]` - Start auto-batch mode (default: 5s)
- `/send` - Send collected batch immediately
- `<empty line>` - Send batch (if any captions queued)
- `/heartbeat` - Send heartbeat
- `/status` - Show current status
- `Ctrl+C` - Exit

### Batch example

```bash
lcyt -i
/batch 10        # Start batch mode with 10 second timeout
Caption 1        # Timer starts here
Caption 2        # Added to batch
Caption 3        # Added to batch
# ... after 10 seconds from first caption, batch auto-sends
```

## Full-Screen Mode (`-f`)

A rich terminal UI with file loading, navigation, and sent history.

```bash
lcyt -f
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send current file line and advance |
| `Up` / `k` | Move to previous line |
| `Down` / `j` | Move to next line |
| `PageUp` / `PageDown` | Move up/down 10 lines |
| `Tab` | Switch focus between input and preview |
| `h` | Show help |
| `q` / `Ctrl+C` | Quit |

### Commands (type in input field)

| Command | Description |
|---------|-------------|
| `/load <file> [line]` | Load a text file, optionally jump to line number |
| `/reload` | Reload the current file |
| `/goto <N>` | Jump to line number N |
| `/batch [seconds]` | Toggle batch mode (auto-send after N seconds) |
| `/send` | Send batch immediately |
| `/status` | Show current status |
| `/heartbeat` | Send heartbeat to server |
| `/quit` or `/exit` | Quit the application |
| `+N` or `-N` | Shift pointer forward/backward N lines |

Text typed without a `/` prefix is sent as a custom caption (does not move the file pointer).

### Example workflow

```bash
lcyt -f

# In the UI:
/load script.txt          # Load a file
/goto 10                  # Jump to line 10

# Press Enter to send the current line and advance
# Use arrow keys to navigate
# Type custom text and press Enter to send ad-hoc captions

/batch 3                  # Enable batch mode (3s auto-send)
# Press Enter multiple times to queue lines rapidly
/send                     # Or send the batch immediately
```

## Sequence

YouTube requires an incrementing sequence counter for each stream. The counter is saved to your config file automatically.

Reset when restarting a stream:

```bash
lcyt --reset
```

## Configuration

Config is stored in `~/.lcyt-config.json`:

```json
{
  "baseUrl": "http://upload.youtube.com/closedcaption",
  "streamKey": "YOUR_STREAM_KEY",
  "region": "reg1",
  "cue": "cue1",
  "sequence": 42
}
```

View current config:

```bash
lcyt --show-config
```

Use a custom config file:

```bash
lcyt --config /path/to/config.json
```

## Docker / MCP notes

If you run the MCP host or a relay in Docker, rebuild the image after pulling changes so the container picks up the updated CLI behavior (logger stderr option):

```bash
# from repo root
docker build -t lcyt-mcp ./packages/lcyt-mcp
# restart your container using the new image
docker rm -f lcyt-mcp-container || true
docker run -d --name lcyt-mcp-container lcyt-mcp
```

Adjust image name and container commands to match your deployment.

## License

MIT
