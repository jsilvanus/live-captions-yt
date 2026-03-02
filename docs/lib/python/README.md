---
title: "Python Library — lcyt"
---

# Python Library — lcyt

`lcyt` is the Python core library for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API.

**PyPI package:** `lcyt` | **Version:** 1.2.0 | **Python 3.10+** | **stdlib-only (no external deps)**

---

## Installation

```bash
pip install lcyt
```

Or install from the monorepo in editable mode:

```bash
pip install -e python-packages/lcyt
```

---

## Modules

| Module | Purpose |
|---|---|
| `lcyt.sender` | [`YoutubeLiveCaptionSender`](./sender.md) — direct YouTube caption delivery |
| `lcyt.backend_sender` | [`BackendCaptionSender`](./backend-sender.md) — relay via lcyt-backend |
| `lcyt.config` | [Configuration utilities](./config.md) — load/save config, build ingestion URL |
| `lcyt.errors` | [Error classes](./errors.md) — typed exception hierarchy |

---

## Quick Start

### Send a caption directly to YouTube

```python
from lcyt.sender import YoutubeLiveCaptionSender

sender = YoutubeLiveCaptionSender(stream_key="xxxx-xxxx-xxxx-xxxx")
sender.start()
result = sender.send("Hello, world!")
sender.end()
```

### Send captions via the relay backend

```python
from lcyt.backend_sender import BackendCaptionSender

sender = BackendCaptionSender(
    backend_url="https://your-backend.example.com",
    api_key="your-api-key",
    stream_key="xxxx-xxxx-xxxx-xxxx",
    domain="https://your-site.example.com",
)

sender.start()
result = sender.send("Hello from the relay!")
# result['ok'] == True, result['requestId'] == '...'
sender.end()
```

---

## Timestamp Handling

> **Important difference from Node.js:** In Python, bare numeric timestamps `>= 1000` are treated as **Unix epoch seconds** (matching `time.time()` convention), whereas in Node.js they are milliseconds.

| Input | Python interpretation |
|---|---|
| `datetime` object | Used directly (naive = UTC assumed) |
| `float >= 1000` | Unix epoch in **seconds** (`time.time()` style) |
| `float < 1000` or negative | Relative seconds offset from now |
| `"YYYY-MM-DDTHH:MM:SS.mmm"` | ISO string used as-is |
| `None` | Current time (sync offset applied if enabled) |

ISO strings must not include a trailing `Z` or `+00:00` — they are stripped automatically.

---

## Reference Documents

- [YoutubeLiveCaptionSender](./sender.md)
- [BackendCaptionSender](./backend-sender.md)
- [Configuration](./config.md)
- [Errors](./errors.md)
