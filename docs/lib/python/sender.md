---
title: "Python — YoutubeLiveCaptionSender"
---

# YoutubeLiveCaptionSender (Python)

Direct caption delivery to YouTube Live via Google's HTTP POST ingestion API.

**Import**
```python
from lcyt.sender import YoutubeLiveCaptionSender, Caption, SendResult
```

---

## Dataclasses

### `Caption`

Represents a single caption for batch sending.

```python
@dataclass
class Caption:
    text: str
    timestamp: str | datetime | int | float | None = None
```

### `SendResult`

Returned by `send()`, `send_batch()`, and `heartbeat()`.

```python
@dataclass
class SendResult:
    sequence: int
    status_code: int
    response: str
    server_timestamp: str | None = None
    timestamp: str | None = None   # set by send() only
    count: int | None = None       # set by send_batch() only
```

---

## Constructor

```python
YoutubeLiveCaptionSender(
    stream_key=None,
    base_url=DEFAULT_BASE_URL,
    ingestion_url=None,
    region="reg1",
    cue="cue1",
    use_region=False,
    sequence=0,
    use_sync_offset=False,
    verbose=False,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `stream_key` | `str \| None` | `None` | YouTube Live stream key (required unless `ingestion_url` is provided) |
| `base_url` | `str` | `'http://upload.youtube.com/closedcaption'` | YouTube ingestion base URL |
| `ingestion_url` | `str \| None` | built from `base_url + stream_key` | Override the full ingestion URL |
| `region` | `str` | `'reg1'` | Region identifier for captions |
| `cue` | `str` | `'cue1'` | Cue identifier for captions |
| `use_region` | `bool` | `False` | Include `region:reg1#cue1` in caption body |
| `sequence` | `int` | `0` | Starting sequence number |
| `use_sync_offset` | `bool` | `False` | Apply NTP sync offset to auto-generated timestamps. Set automatically to `True` after calling `sync()`. |
| `verbose` | `bool` | `False` | Enable `DEBUG`-level logging via Python's `logging` module |

---

## Lifecycle Methods

### `start()`

Initialise the sender. Must be called before sending captions.

```python
sender.start()
# or chained:
sender = YoutubeLiveCaptionSender(stream_key="...").start()
```

**Returns:** `self` (for method chaining)

**Raises:** `ValidationError` if neither `stream_key` nor `ingestion_url` is set.

---

### `end()`

Stop the sender and clear the internal queue.

```python
sender.end()
```

**Returns:** `self`

---

## Sending Methods

### `send(text, timestamp=None)`

Send a single caption to YouTube.

```python
result = sender.send("Hello, world!")
result = sender.send("Hello!", "2024-01-01T12:00:00.000")
result = sender.send("Recent", -2.0)  # 2 seconds ago (relative)
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | Caption text (required, non-empty) |
| `timestamp` | `str \| datetime \| int \| float \| None` | See [Timestamp Handling](./README.md#timestamp-handling). Defaults to current time. |

**Returns:** `SendResult`

**Raises:** `ValidationError` if sender not started or text is empty. `NetworkError` on HTTP failure.

---

### `send_batch(captions=None)`

Send a list of captions in one HTTP request.

```python
from lcyt.sender import Caption

result = sender.send_batch([
    Caption(text="First line", timestamp="2024-01-01T12:00:00.000"),
    Caption(text="Second line", timestamp="2024-01-01T12:00:02.000"),
])
```

If `captions` is `None`, the internal queue (built with `construct()`) is drained and sent.

| Parameter | Type | Description |
|---|---|---|
| `captions` | `list[Caption] \| None` | Captions to send. `None` = send queue. |

**Returns:** `SendResult` with `count` set to the number of captions sent.

**Raises:** `ValidationError` if no captions to send. `NetworkError` on HTTP failure.

---

### `construct(text, timestamp=None)`

Add a caption to the internal queue without sending it.

```python
sender.construct("Caption 1")
sender.construct("Caption 2", "2024-01-01T12:00:05.000")
# then send the queue:
sender.send_batch()
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | Caption text (required string) |
| `timestamp` | `str \| datetime \| int \| float \| None` | Optional timestamp |

**Returns:** `int` — current queue length.

**Raises:** `ValidationError` if text is empty or not a string.

---

### `heartbeat()`

Send an empty POST to verify connectivity without advancing captions.

> Per Google's spec the heartbeat does **not** increment the sequence number.

```python
result = sender.heartbeat()
print(result.status_code)  # 200
```

**Returns:** `SendResult`

**Raises:** `NetworkError` on failure.

---

### `sync()`

Perform an NTP-style clock synchronisation against the YouTube server.

Sends a heartbeat, measures round-trip time, and computes the clock offset between the local clock and YouTube's server timestamp. Automatically sets `use_sync_offset = True` so future auto-generated timestamps are corrected.

```python
info = sender.sync()
print(info["sync_offset"])      # e.g. 150 (ms)
print(info["round_trip_time"])  # e.g. 82 (ms)
```

**Returns:** `dict` with keys:

| Key | Type | Description |
|---|---|---|
| `sync_offset` | `int` | Clock offset in milliseconds (positive = server ahead of local) |
| `round_trip_time` | `int` | Round-trip latency to YouTube in ms |
| `server_timestamp` | `str \| None` | ISO timestamp returned by YouTube |
| `status_code` | `int` | HTTP status from YouTube |

**Raises:** `NetworkError` on failure.

---

### `send_test()`

Send a test payload using Google's `region:reg1#cue1` format.

```python
result = sender.send_test()
print(result.status_code)  # 200 if connection is working
```

**Returns:** `SendResult`

---

## Queue Management

### `get_queue()`

Return a copy of the internal caption queue.

```python
queue = sender.get_queue()
# [Caption(text='Caption 1', timestamp=None), ...]
```

**Returns:** `list[Caption]`

---

### `clear_queue()`

Clear all captions from the internal queue.

```python
count = sender.clear_queue()
# int — number of captions cleared
```

**Returns:** `int`

---

## Sequence Management

### `get_sequence()` / `set_sequence(sequence)`

Read or write the internal sequence counter.

```python
seq = sender.get_sequence()   # int
sender.set_sequence(42)       # returns self
```

---

## Sync Offset Management

### `get_sync_offset()` / `set_sync_offset(offset)`

Read or write the clock synchronisation offset (milliseconds).

```python
offset = sender.get_sync_offset()   # int
sender.set_sync_offset(200)         # returns self
```

---

## Properties

| Property | Type | Description |
|---|---|---|
| `is_started` | `bool` | `True` if `start()` has been called and `end()` has not |

---

## Example: Full Workflow

```python
from lcyt.sender import YoutubeLiveCaptionSender, Caption
import os

sender = YoutubeLiveCaptionSender(
    stream_key=os.environ["STREAM_KEY"],
    verbose=True,
)

sender.start()

# Synchronise clock
info = sender.sync()
print(f"Sync offset: {info['sync_offset']}ms")

# Send individual captions
sender.send("Welcome to the stream!")
sender.send("Captions powered by lcyt.")

# Build a batch from a queue
sender.construct("Line one")
sender.construct("Line two")
sender.send_batch()  # drains the queue

sender.end()
```
