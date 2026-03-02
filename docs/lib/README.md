# lcyt — Core Library Reference

`lcyt` is the Node.js core library for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API.

**npm package:** `lcyt` | **Version:** 2.3.0 | **ESM + CJS dual package**

---

## Installation

```bash
npm install lcyt
```

---

## Modules

| Import path | Purpose |
|---|---|
| `lcyt` | [`YoutubeLiveCaptionSender`](./sender.md) — direct YouTube caption delivery |
| `lcyt/backend` | [`BackendCaptionSender`](./backend-sender.md) — relay via lcyt-backend |
| `lcyt/config` | [Configuration utilities](./config.md) — load/save config, build ingestion URL |
| `lcyt/logger` | [Logger](./logger.md) — pluggable structured logger |
| `lcyt/errors` | [Error classes](./errors.md) — typed error hierarchy |

---

## Quick Start

### Send a caption directly to YouTube

```js
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({ streamKey: 'xxxx-xxxx-xxxx-xxxx' });
await sender.start();
await sender.send('Hello, world!');
await sender.end();
```

### Send captions via the relay backend

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

## Reference Documents

- [YoutubeLiveCaptionSender](./sender.md)
- [BackendCaptionSender](./backend-sender.md)
- [Configuration](./config.md)
- [Logger](./logger.md)
- [Errors](./errors.md)
