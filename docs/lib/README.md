# lcyt — Core Library Reference

---
id: lib/readme
---

`lcyt` is available as both a **Node.js** library (npm) and a **Python** library (PyPI). Both provide the same core abstractions: direct caption delivery to YouTube and relay-based delivery via the lcyt-backend.

---

## Node.js Library

**npm package:** `lcyt` | **Version:** 2.3.0 | **ESM + CJS dual package**

### Installation

```bash
npm install lcyt
```

### Modules

| Import path | Purpose |
|---|---|
| `lcyt` | [`YoutubeLiveCaptionSender`](#sender) — direct YouTube caption delivery |
| `lcyt/backend` | [`BackendCaptionSender`](#backend-sender) — relay via lcyt-backend |
| `lcyt/config` | [Configuration utilities](#config) — load/save config, build ingestion URL |
| `lcyt/logger` | [Logger](#logger) — pluggable structured logger |
| `lcyt/errors` | [Error classes](#errors) — typed error hierarchy |

---

## Quick Start

### Node.js — Send a caption directly to YouTube

```js
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({ streamKey: 'xxxx-xxxx-xxxx-xxxx' });
await sender.start();
await sender.send('Hello, world!');
await sender.end();
```

### Node.js — Send captions via the relay backend

```js
import { BackendCaptionSender } from 'lcyt/backend';

const sender = new BackendCaptionSender({
  backendUrl: 'https://your-backend.example.com',
  apiKey: 'your-api-key',
  streamKey: 'xxxx-xxxx-xxxx-xxxx',
  domain: 'https://your-site.example.com',
});

await sender.start();
const result = await sender.send('Hello from the relay!');
// result.ok === true, result.requestId === '...'
await sender.end();
```

---

## Python Library

**PyPI package:** `lcyt` | **Version:** 1.2.0 | **Python 3.10+** | **stdlib-only**

### Installation

```bash
pip install lcyt
```

### Modules

| Module | Purpose |
|---|---|
| `lcyt.sender` | [`YoutubeLiveCaptionSender`](#python-sender) — direct YouTube caption delivery |
| `lcyt.backend_sender` | [`BackendCaptionSender`](#python-backend-sender) — relay via lcyt-backend |
| `lcyt.config` | [Configuration utilities](#python-config) — load/save config, build ingestion URL |
| `lcyt.errors` | [Error classes](#python-errors) — typed exception hierarchy |

### Python — Send a caption directly to YouTube

```python
from lcyt.sender import YoutubeLiveCaptionSender

sender = YoutubeLiveCaptionSender(stream_key="xxxx-xxxx-xxxx-xxxx")
sender.start()
sender.send("Hello, world!")
sender.end()
```

### Python — Send captions via the relay backend

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
sender.end()
```

> **Timestamp note:** In Python, bare numeric timestamps `>= 1000` are **Unix epoch seconds** (not milliseconds as in Node.js).

---

## Reference Documents

### Node.js
- [YoutubeLiveCaptionSender](#sender)
- [BackendCaptionSender](#backend-sender)
- [Configuration](#config)
- [Logger](#logger)
- [Errors](#errors)

### Python
- [YoutubeLiveCaptionSender](#python-sender)
- [BackendCaptionSender](#python-backend-sender)
- [Configuration](#python-config)
- [Errors](#python-errors)
