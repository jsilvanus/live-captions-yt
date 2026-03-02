---
title: "Python — BackendCaptionSender"
---

# BackendCaptionSender (Python)

Send live captions via an `lcyt-backend` relay server instead of directly to YouTube.

**Import**
```python
from lcyt.backend_sender import BackendCaptionSender
```

---

## Overview

`BackendCaptionSender` communicates with an `lcyt-backend` HTTP server rather than YouTube's ingestion endpoint directly. It mirrors the `YoutubeLiveCaptionSender` API but returns response dicts instead of `SendResult` dataclasses.

**Why use this?**
- Your client cannot reach YouTube directly (firewall, CORS, restricted network)
- You want multi-user session management and API key enforcement from the relay
- You need the SSE result stream (`GET /events`) for async delivery confirmation

**Async delivery:** `send()` returns immediately with `{"ok": True, "requestId": "..."}`. The actual YouTube delivery result arrives on the `GET /events` SSE stream.

---

## Constructor

```python
BackendCaptionSender(
    backend_url,
    api_key,
    stream_key,
    domain="http://localhost",
    sequence=0,
    verbose=False,
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `backend_url` | `str` | — | Base URL of the lcyt-backend server (e.g. `"https://captions.example.com"`) |
| `api_key` | `str` | — | API key registered in the backend's database |
| `stream_key` | `str` | — | YouTube Live stream key |
| `domain` | `str` | `"http://localhost"` | CORS origin the session is associated with |
| `sequence` | `int` | `0` | Starting sequence number (overridden by server on `start()`) |
| `verbose` | `bool` | `False` | Enable verbose output |

---

## Lifecycle Methods

### `start()`

Register a session with the backend and obtain a JWT token.

```python
sender.start()
# or chained:
sender = BackendCaptionSender(...).start()
```

Updates internal `sequence`, `sync_offset`, and `started_at` from the server response. Idempotent — returns the existing session if one already exists.

**Returns:** `self`

**Raises:** `NetworkError` on HTTP failure.

---

### `end()`

Tear down the backend session and clear the stored JWT.

```python
sender.end()
```

**Returns:** `self`

**Raises:** `NetworkError` on HTTP failure.

---

## Sending Methods

### `send(text, timestamp=None, time=None)`

Send a single caption via the backend.

```python
result = sender.send("Hello, world!")
result = sender.send("Absolute time", timestamp="2024-01-01T12:00:00.000")
result = sender.send("Relative time", time=5000)  # 5 sec since session start
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | Caption text |
| `timestamp` | `str \| None` | Absolute ISO timestamp. Mutually exclusive with `time`. |
| `time` | `int \| None` | Milliseconds since session start. Resolved server-side as `startedAt + time + syncOffset`. Mutually exclusive with `timestamp`. |

**Returns:** `dict` — `{"ok": True, "requestId": "..."}` (202 Accepted)

**Raises:** `NetworkError` on HTTP failure.

---

### `send_batch(captions=None)`

Send multiple captions in one request.

```python
result = sender.send_batch([
    {"text": "Line one"},
    {"text": "Line two", "timestamp": "2024-01-01T12:00:02.000"},
    {"text": "Line three", "time": 5000},
])
```

If `captions` is `None`, drains and sends the internal queue (built with `construct()`).

| Parameter | Type | Description |
|---|---|---|
| `captions` | `list[dict] \| None` | List of caption dicts with `text`, optional `timestamp` or `time`. `None` = send queue. |

**Returns:** `dict` — `{"ok": True, "requestId": "..."}`

**Raises:** `NetworkError` on HTTP failure.

---

### `construct(text, timestamp=None, time=None)`

Add a caption to the local queue without sending.

```python
sender.construct("Caption 1")
sender.construct("Caption 2", time=3000)
sender.send_batch()  # flush the queue
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | Caption text |
| `timestamp` | `str \| None` | Optional absolute ISO timestamp |
| `time` | `int \| None` | Optional ms-since-session-start offset |

**Returns:** `int` — current queue length.

---

## Queue Management

### `get_queue()`

Return a copy of the local queue.

```python
queue = sender.get_queue()
# [{"text": "Caption 1"}, {"text": "Caption 2", "time": 3000}]
```

**Returns:** `list[dict]`

---

### `clear_queue()`

Clear the local queue.

```python
count = sender.clear_queue()  # int — items cleared
```

**Returns:** `int`

---

## Sync and Heartbeat

### `sync()`

Trigger an NTP-style clock sync on the backend. Updates the local `sync_offset`.

```python
data = sender.sync()
print(data["syncOffset"])      # ms offset
print(data["roundTripTime"])   # ms
```

**Returns:** `dict` — `{"syncOffset": int, "roundTripTime": int, "serverTimestamp": str, "statusCode": int}`

**Raises:** `NetworkError` on failure.

---

### `heartbeat()`

Check the session status on the backend. Updates local `sequence` and `sync_offset`.

```python
data = sender.heartbeat()
print(data["sequence"])
```

**Returns:** `dict` — `{"sequence": int, "syncOffset": int}`

**Raises:** `NetworkError` on failure.

---

## Getters / Setters

| Method | Returns | Description |
|---|---|---|
| `get_sequence()` | `int` | Current sequence number |
| `set_sequence(seq)` | `self` | Manually set sequence |
| `get_sync_offset()` | `int` | Current sync offset in ms |
| `set_sync_offset(offset)` | `self` | Manually set sync offset |
| `get_started_at()` | `float` | Session start timestamp (Unix epoch seconds from server) |
| `is_started` (property) | `bool` | `True` if session is active |

---

## Example: Full Workflow

```python
from lcyt.backend_sender import BackendCaptionSender
import os

sender = BackendCaptionSender(
    backend_url=os.environ["BACKEND_URL"],
    api_key=os.environ["API_KEY"],
    stream_key=os.environ["STREAM_KEY"],
    domain="https://my-app.example.com",
)

sender.start()
sender.sync()

sender.send("Welcome to the stream!")

# Queue and batch-send
sender.construct("Line one")
sender.construct("Line two", time=3000)
sender.send_batch()

sender.end()
```
