# LCYT Python - Live Caption Tool for YouTube

Send live captions to YouTube Live streams using Google's official closed caption API format.

## Installation

```bash
pip install lcyt
```

Or install from source:

```bash
pip install .
```

## Quick Start

```python
from lcyt import YoutubeLiveCaptionSender

sender = YoutubeLiveCaptionSender(stream_key="YOUR_STREAM_KEY")
sender.start()

# Send a caption
sender.send("Hello, world!")

sender.end()
```

## API Reference

### YoutubeLiveCaptionSender

The main class for sending captions to YouTube.

#### Constructor

```python
sender = YoutubeLiveCaptionSender(
    stream_key="YOUR_KEY",      # YouTube stream key (cid value)
    base_url="http://...",      # Base ingestion URL (optional)
    ingestion_url="http://...", # Full URL (overrides stream_key/base_url)
    region="reg1",              # Region identifier (default: reg1)
    cue="cue1",                 # Cue identifier (default: cue1)
    use_region=False,           # Include region/cue in body (optional)
    sequence=0,                 # Starting sequence number
    verbose=False,              # Enable debug logging
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `stream_key` | str | None | YouTube stream key (cid value) |
| `base_url` | str | `http://upload.youtube.com/closedcaption` | Base ingestion URL |
| `ingestion_url` | str | None | Full pre-built URL (overrides stream_key/base_url) |
| `region` | str | `reg1` | Region identifier |
| `cue` | str | `cue1` | Cue identifier |
| `use_region` | bool | False | Include region/cue in caption body |
| `sequence` | int | 0 | Starting sequence number |
| `verbose` | bool | False | Enable verbose logging |

### Methods

#### `start()`

Initialize the sender. Must be called before sending captions.

```python
sender.start()
```

#### `send(text, timestamp=None)`

Send a single caption.

```python
result = sender.send("Hello, world!")
result = sender.send("Custom timestamp", "2024-01-15T12:00:00.000")

# Returns SendResult with:
# - sequence: int
# - status_code: int
# - response: str
# - server_timestamp: str | None
```

#### `construct(text, timestamp=None)`

Queue a caption for batch sending.

```python
sender.construct("First caption")
sender.construct("Second caption")
sender.construct("Third caption", "2024-01-15T12:00:01.000")
print(len(sender.get_queue()))  # 3
```

#### `send_batch(captions=None)`

Send multiple captions in a single POST request. If no list is provided, sends the internal queue built with `construct()`.

```python
from lcyt import Caption

# Option 1: Pass list directly
result = sender.send_batch([
    Caption(text="Caption 1"),
    Caption(text="Caption 2", timestamp="2024-01-15T12:00:00.500"),
])

# Option 2: Use construct() then send_batch()
sender.construct("Caption 1")
sender.construct("Caption 2")
result = sender.send_batch()  # Sends queue and clears it

# Returns SendResult with:
# - sequence: int
# - count: int
# - status_code: int
# - response: str
# - server_timestamp: str | None
```

#### `heartbeat()`

Send an empty POST to verify connection. Can be used for clock synchronization.

```python
result = sender.heartbeat()
print(f"Server time: {result.server_timestamp}")
```

#### `end()`

Stop the sender and cleanup.

```python
sender.end()
```

#### `get_queue()` / `clear_queue()`

Manage the caption queue.

```python
queue = sender.get_queue()  # Returns list of Caption objects
cleared = sender.clear_queue()  # Returns count of cleared captions
```

#### `get_sequence()` / `set_sequence(seq)`

Get or set the current sequence number.

```python
seq = sender.get_sequence()
sender.set_sequence(100)
```

## Configuration Management

LCYT provides utilities for managing configuration:

```python
from lcyt import LCYTConfig, load_config, save_config, get_default_config_path

# Load config from default path (~/.lcyt-config.json)
config = load_config()

# Load from custom path
config = load_config("/path/to/config.json")

# Create and save config
config = LCYTConfig(
    stream_key="YOUR_KEY",
    sequence=42,
)
save_config(config)

# Get default config path
path = get_default_config_path()  # ~/.lcyt-config.json
```

## Error Handling

LCYT provides custom exception classes:

```python
from lcyt import (
    LCYTError,       # Base exception
    ConfigError,     # Configuration errors
    NetworkError,    # HTTP/network errors (has status_code attribute)
    ValidationError, # Input validation errors (has field attribute)
)

try:
    sender.send("Hello")
except ConfigError as e:
    print(f"Configuration error: {e}")
except NetworkError as e:
    print(f"Network error: {e}, status: {e.status_code}")
except ValidationError as e:
    print(f"Validation error: {e}, field: {e.field}")
```

## Data Classes

### Caption

```python
from lcyt import Caption

caption = Caption(
    text="Hello, world!",
    timestamp="2024-01-15T12:00:00.000",  # Optional
)
```

### SendResult

Returned by `send()`, `send_batch()`, and `heartbeat()`:

```python
from lcyt import SendResult

# Fields:
# - sequence: int
# - status_code: int
# - response: str
# - server_timestamp: str | None
# - timestamp: str | None (for send())
# - count: int | None (for send_batch())
```

## Google Caption Format

LCYT implements Google's official YouTube Live caption format:

### Request Format

- **Method:** POST
- **Content-Type:** `text/plain`
- **URL params:** `cid=<stream_key>&seq=N`

### Body Format

```
YYYY-MM-DDTHH:MM:SS.mmm
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

With region (when `use_region=True`):

```
YYYY-MM-DDTHH:MM:SS.mmm [region:reg1#cue1]
CAPTION TEXT
```

### Important Requirements

- Timestamps must be within 60 seconds of the server's current time
- Body must end with a trailing newline (`\n`)
- Region/cue identifier after timestamp is optional

### Line Breaks

Use `<br>` within caption text for line breaks:

```python
sender.send("Line one<br>Line two")
```

## YouTube Setup

To get your YouTube Live caption ingestion URL and key:

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** → **Go Live**
3. Set up your stream settings
4. Look for **Closed captions** in the stream settings
5. Enable **POST captions to URL**
6. Copy the ingestion URL and stream key

## License

MIT
