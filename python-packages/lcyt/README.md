# LCYT Python - Live Captions for YouTube

[![PyPI version](https://img.shields.io/pypi/v/lcyt.svg)](https://pypi.org/project/lcyt/)

Python library for sending live captions to YouTube Live streams using Google's official closed caption ingestion API.

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
sender.send("Hello, world!")
sender.end()
```

## API Reference

### YoutubeLiveCaptionSender

The main class for sending captions directly to YouTube.

#### Constructor

```python
sender = YoutubeLiveCaptionSender(
    stream_key="YOUR_KEY",       # YouTube stream key (cid value)
    base_url="http://...",       # Base ingestion URL (optional)
    ingestion_url="http://...",  # Full URL (overrides stream_key/base_url)
    region="reg1",               # Region identifier (default: reg1)
    cue="cue1",                  # Cue identifier (default: cue1)
    use_region=False,            # Include region/cue in body (optional)
    sequence=0,                  # Starting sequence number
    use_sync_offset=False,       # Apply syncOffset to auto-generated timestamps
    verbose=False,               # Enable debug logging
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
| `use_sync_offset` | bool | False | Apply sync_offset to auto-generated timestamps |
| `verbose` | bool | False | Enable debug logging |

#### Methods

##### `start()`

Initialize the sender. Must be called before sending captions.

```python
sender.start()
```

##### `send(text, timestamp=None)`

Send a single caption.

`timestamp` accepts:
- `datetime` object (timezone-aware or naive UTC)
- `int`/`float` >= 1000 — Unix epoch in **seconds** (`time.time()` style)
- `int`/`float` < 1000 or negative — relative offset in **seconds** from now (e.g. `-2` = 2 seconds ago)
- ISO string `YYYY-MM-DDTHH:MM:SS.mmm` — used as-is
- ISO string with trailing `Z` or `+00:00` — auto-stripped
- `None` — auto-generated current time (sync offset applied if enabled)

```python
result = sender.send("Hello, world!")
result = sender.send("ISO string", "2024-01-15T12:00:00.000")

import time
from datetime import datetime, timezone
result = sender.send("Epoch seconds", time.time())          # int/float >= 1000
result = sender.send("Datetime object", datetime.now(timezone.utc))
result = sender.send("2 seconds ago", -2)                   # relative offset
result = sender.send("Now", 0)                              # offset of 0 = now

# Returns SendResult with:
# - sequence: int
# - status_code: int
# - response: str
# - server_timestamp: str | None
# - timestamp: str | None  (formatted timestamp that was sent)
```

##### `construct(text, timestamp=None)`

Queue a caption for batch sending. Accepts the same timestamp forms as `send()`.

```python
sender.construct("First caption")
sender.construct("ISO string", "2024-01-15T12:00:01.000")
sender.construct("Datetime", datetime.now(timezone.utc))
sender.construct("Epoch seconds", time.time())
sender.construct("2 seconds ago", -2)
print(len(sender.get_queue()))  # 5
```

##### `send_batch(captions=None)`

Send multiple captions in a single POST request. If no list is provided, sends and clears the internal queue built with `construct()`.

```python
from lcyt import Caption

# Option 1: Pass list directly
result = sender.send_batch([
    Caption(text="Caption 1"),
    Caption(text="Caption 2", timestamp="2024-01-15T12:00:00.500"),
    Caption(text="Caption 3", timestamp=datetime.now(timezone.utc)),
    Caption(text="Caption 4", timestamp=time.time()),
    Caption(text="Caption 5", timestamp=-1),  # 1 second ago
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

##### `heartbeat()`

Send an empty POST to verify connection. Does not increment the sequence number.

```python
result = sender.heartbeat()
print(f"Server time: {result.server_timestamp}")
```

##### `sync()`

Synchronize the local clock with YouTube's server clock (NTP-style midpoint estimation).
Automatically enables `use_sync_offset` so future auto-generated timestamps are corrected.

```python
result = sender.sync()
# result is a dict with:
# - sync_offset: int      (ms; positive = server ahead of local)
# - round_trip_time: int  (ms)
# - server_timestamp: str | None
# - status_code: int
print(f"Offset: {result['sync_offset']}ms, RTT: {result['round_trip_time']}ms")
```

##### `get_sync_offset()` / `set_sync_offset(offset)`

Get or set the clock offset in milliseconds manually.

```python
offset = sender.get_sync_offset()
sender.set_sync_offset(-50)  # Manually correct by -50ms
```

##### `send_test()`

Send a test payload using current timestamps and the `region:reg1#cue1` format from Google's documentation.

```python
result = sender.send_test()
```

##### `end()`

Stop the sender and cleanup.

```python
sender.end()
```

##### `get_queue()` / `clear_queue()`

Manage the caption queue.

```python
queue = sender.get_queue()       # Returns list of Caption objects
cleared = sender.clear_queue()   # Returns count of cleared captions
```

##### `get_sequence()` / `set_sequence(seq)`

Get or set the current sequence number.

```python
seq = sender.get_sequence()
sender.set_sequence(100)
```

---

### BackendCaptionSender

Use `BackendCaptionSender` to route captions through an `lcyt-backend` relay server instead
of sending directly to YouTube. Exposes the same interface as `YoutubeLiveCaptionSender`.

```python
from lcyt import BackendCaptionSender

sender = BackendCaptionSender(
    backend_url="https://captions.example.com",
    api_key="a1b2c3d4-...",
    stream_key="YOUR_YOUTUBE_KEY",
)

sender.start()
sender.send("Hello!")
sender.send("With session time", time=5000)  # 5s since session start
sender.sync()
sender.end()
```

#### Constructor

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `backend_url` | str | — | Base URL of the lcyt-backend server |
| `api_key` | str | — | API key registered in the backend |
| `stream_key` | str | — | YouTube stream key |
| `domain` | str | `http://localhost` | CORS origin for the session |
| `sequence` | int | 0 | Starting sequence number (overridden by server on `start()`) |
| `verbose` | bool | False | Enable debug logging |

#### Methods

- **`start()`** — Register session, get JWT. Updates `sequence`, `sync_offset`, `started_at`.
- **`end()`** — Tear down session and clear JWT.
- **`send(text, timestamp=None, time=None)`** — Send a single caption.
  `time` is ms since session start (resolved server-side); mutually exclusive with `timestamp`.
- **`send_batch(captions=None)`** — Send list of caption dicts, or drain the local queue.
- **`construct(text, timestamp=None, time=None)`** — Queue a caption locally.
- **`get_queue()`** / **`clear_queue()`** — Inspect or clear the local queue.
- **`sync()`** — Trigger NTP-style sync on the backend. Updates local `sync_offset`.
- **`heartbeat()`** — Get session status. Updates local `sequence` and `sync_offset`.
- **`get_sequence()`** / **`set_sequence(seq)`**
- **`get_sync_offset()`** / **`set_sync_offset(offset)`**
- **`get_started_at()`** — Session start timestamp (Unix epoch seconds from server).

---

### Configuration Management

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

---

### Error Handling

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

---

### Data Classes

#### Caption

```python
from lcyt import Caption

caption = Caption(
    text="Hello, world!",
    timestamp="2024-01-15T12:00:00.000",  # str | datetime | int | float | None
)
```

#### SendResult

Returned by `send()`, `send_batch()`, and `heartbeat()`:

```python
# Fields:
# - sequence: int
# - status_code: int
# - response: str
# - server_timestamp: str | None
# - timestamp: str | None  (set by send())
# - count: int | None      (set by send_batch())
```

---

## Google Caption Format

### Request Format

- **Method:** POST
- **Content-Type:** `text/plain` (no charset!)
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
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
CAPTION TEXT
```

### Timestamp Format

YouTube requires timestamps in the format:

```
YYYY-MM-DDTHH:MM:SS.mmm
```

- No trailing `Z`, no UTC offset — millisecond precision
- Must be within 60 seconds of the server's current time

> **Note:** The Python library uses **seconds** for numeric epoch values (`time.time()` convention),
> while the Node.js library uses **milliseconds** (`Date.now()` convention). Both match their
> platform's standard.

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

To get your YouTube Live caption stream key:

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** → **Go Live**
3. Set up your stream settings (enable 30-second delay, set captions to HTTP POST)
4. Look for **Closed captions** in the stream settings
5. Enable **POST captions to URL**
6. Copy the stream key (cid value)

## License

MIT
