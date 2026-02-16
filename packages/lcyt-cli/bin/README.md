# LCYT CLI

Command-line interface for sending live captions to YouTube Live streams.

## Installation

```bash
npm install -g lcyt
```

Or use directly with npx:

```bash
npx lcyt
```

## Quick Start

1. **Set up your YouTube stream key:**

```bash
lcyt --stream-key "YOUR_STREAM_KEY"
```

2. **Send heartbeat to verify connection (optional):**

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

**Note:** When using `npx lcyt` without arguments, it defaults to full-screen mode (`-f`). To use standard interactive mode with npx, explicitly pass `-i`:

```bash
npx lcyt      # Defaults to full-screen mode
npx lcyt -i   # Use standard interactive mode
```

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
| `--batch` | `-b` | Add caption to batch queue (send with `--send`) |
| `--send` | | Send all queued batch captions and clear the queue |
| `--timestamp <iso>` | `-t` | Manual ISO timestamp override |
| `--reset` | | Reset sequence counter to 0 |
| `--config <path>` | `-c` | Config file path |
| `--verbose` | `-v` | Enable verbose output |
| `--help` | `-h` | Show help |
| `--version` | | Show version number |

## Modes

### Simple Mode (Non-Interactive)

Send a single caption directly from the command line:

```bash
lcyt "Hello, world!"
lcyt "Custom time" -t "2024-01-15T12:00:00.000"
```

### CLI Batch Mode

Queue up multiple captions across separate CLI invocations, then send them all at once. The batch queue is persisted in the config file.

```bash
# Add captions to the batch queue
lcyt -b "First caption"
lcyt -b "Second caption"
lcyt -b "Third caption" -t "2024-01-15T12:00:00.000"

# Send all queued captions in one batch
lcyt --send
```

- `--batch` / `-b` adds a caption to the queue with either the current timestamp or a custom one via `-t`
- `--send` sends all queued captions as a single POST request and clears the queue
- The batch queue is stored as `batchQueue` in the config file (`~/.lcyt-config.json`)

This is useful for scripted workflows where captions are generated in separate steps before being sent together.

### Standard Interactive Mode (`-i`)

A line-based interactive REPL for sending captions:

```bash
lcyt -i
```

**Commands:**

| Command | Description |
|---------|-------------|
| `<text>` | Send single caption |
| `timestamp\|text` | Send with custom timestamp |
| `/batch [seconds]` | Start auto-batch mode (default: 5s) |
| `/send` | Send collected batch immediately |
| `<empty line>` | Send batch (if any captions queued) |
| `/heartbeat` | Send heartbeat |
| `/status` | Show current status |
| `Ctrl+C` | Exit |

**Batch mode example:**

```
lcyt -i
caption> /batch 10        # Start batch mode with 10 second timeout
batch> Caption 1           # Timer starts here
batch> Caption 2           # Added to batch
batch> Caption 3           # Added to batch
# ... after 10 seconds from first caption, batch auto-sends
```

When batch mode is active, captions are queued instead of sent immediately. The batch auto-sends after the timeout (measured from the first caption). Use `/send` or press Enter on an empty line to send immediately.

### Full-Screen Interactive Mode (`-f`)

A rich terminal UI with file loading, visual context, and navigation:

```bash
lcyt -f
```

The full-screen mode provides:
- File loading capability (`/load <file>`)
- Visual context display (2 previous + current + 5 next lines)
- Sent history tracking
- Easy navigation with arrow keys
- Press Enter to send current line and advance
- Use +N/-N commands to jump multiple lines

**Keyboard shortcuts:**

| Key | Description |
|-----|-------------|
| `Enter` | Send current file line and advance to next |
| `:` or `/` | Open prompt to type custom text or commands |
| `Up` / `k` | Move to previous line |
| `Down` / `j` | Move to next line |
| `PageUp` | Move up 10 lines |
| `PageDown` | Move down 10 lines |
| `Tab` | Switch focus between text preview and history |
| `h` | Show help |
| `q` or `Ctrl+C` | Quit |

**Commands (type `:` or `/` first, then the command):**

| Command | Description |
|---------|-------------|
| `/load <file> [line]` | Load a text file, optionally jump to line number |
| `/reload` | Reload the current file |
| `/goto <N>` | Jump to line number N |
| `/batch [seconds]` | Toggle batch mode (auto-send after N seconds, default 5) |
| `/send` | Send batch immediately |
| `/status` | Show current status (line number, file, sequence, batch status) |
| `/heartbeat` | Send heartbeat to verify connection |
| `/quit` or `/exit` | Quit the application |
| `+N` | Shift pointer forward N lines (e.g., `+5`) |
| `-N` | Shift pointer backward N lines (e.g., `-3`) |

**Custom captions:** Press `:` or `/` to open the prompt. Type plain text (without a `/` prefix) to send it as a custom caption. Custom captions don't move the file pointer. Works with batch mode too.

**Example workflow:**

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
# They'll auto-send 3 seconds after the first one
```

## Sequence

YouTube requires an incrementing sequence counter for each stream.

**Reset sequence counter** (needed when restarting a stream):

```bash
lcyt --reset
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

When using CLI batch mode, a `batchQueue` array is also stored in the config:

```json
{
  "batchQueue": [
    { "text": "First caption", "timestamp": "2024-01-15T12:00:00.000Z" },
    { "text": "Second caption", "timestamp": "2024-01-15T12:00:01.000Z" }
  ]
}
```

The full ingestion URL is constructed as:

```
{baseUrl}?cid={streamKey}&seq={sequence}
```

## YouTube Setup

To get your YouTube Live caption ingestion URL and key:

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** > **Go Live**
3. Set up your stream settings
4. Look for **Closed captions** in the stream settings
5. Enable **POST captions to URL**
6. Copy the ingestion URL (this is usually stable and has been added as a default) and stream key
