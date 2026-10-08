# lcyt â€” Core Library Reference

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
| `lcyt` | [`YoutubeLiveCaptionSender`](#sender) â€” direct YouTube caption delivery |
| `lcyt/backend` | [`BackendCaptionSender`](#backend-sender) â€” relay via lcyt-backend |
| `lcyt/config` | [Configuration utilities](#config) â€” load/save config, build ingestion URL |
| `lcyt/logger` | [Logger](#logger) â€” pluggable structured logger |
| `lcyt/errors` | [Error classes](#errors) â€” typed error hierarchy |

---

## Quick Start

### Node.js â€” Send a caption directly to YouTube

```js
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({ streamKey: 'xxxx-xxxx-xxxx-xxxx' });
await sender.start();
await sender.send('Hello, world!');
await sender.end();
```

### Node.js â€” Send captions via the relay backend

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
| `lcyt.sender` | [`YoutubeLiveCaptionSender`](#python-sender) â€” direct YouTube caption delivery |
| `lcyt.backend_sender` | [`BackendCaptionSender`](#python-backend-sender) â€” relay via lcyt-backend |
| `lcyt.config` | [Configuration utilities](#python-config) â€” load/save config, build ingestion URL |
| `lcyt.errors` | [Error classes](#python-errors) â€” typed exception hierarchy |

### Python â€” Send a caption directly to YouTube

```python
from lcyt.sender import YoutubeLiveCaptionSender

sender = YoutubeLiveCaptionSender(stream_key="xxxx-xxxx-xxxx-xxxx")
sender.start()
sender.send("Hello, world!")
sender.end()
```

### Python â€” Send captions via the relay backend

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

