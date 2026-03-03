# LCYT - Live Captions for YouTube

[![npm version](https://img.shields.io/npm/v/lcyt.svg)](https://www.npmjs.com/package/lcyt)
[![npm version](https://img.shields.io/npm/v/lcyt-cli.svg)](https://www.npmjs.com/package/lcyt-cli)
[![PyPI version](https://img.shields.io/pypi/v/lcyt.svg)](https://pypi.org/project/lcyt/)

Send live captions to YouTube live streams using Google's official closed caption ingestion url (HTTP POST).

To use this package, you first need to:
1. Set up a live in Youtube, set it to 30 second delay and to receive captions via HTTP POST requests.
2. Start the live and then send the captions with the stream key (and in correct sequence).

## Packages

This is a monorepo containing the following packages:

| Package | Platform | Installation | Description |
|---------|----------|--------------|-------------|
| [`lcyt`](packages/lcyt/) | npm | `npm install lcyt` | Core Node.js library |
| [`lcyt-cli`](packages/lcyt-cli/) | npm | `npm install -g lcyt-cli` | CLI tool |
| [`lcyt-backend`](packages/lcyt-backend/) | — | — | Node.js Express backend relay |
| [`lcyt-mcp-stdio`](packages/lcyt-mcp-stdio/) | — | `node packages/lcyt-mcp-stdio/src/server.js` | MCP server (stdio transport) |
| [`lcyt-mcp-sse`](packages/lcyt-mcp-sse/) | — | `node packages/lcyt-mcp-sse/src/server.js` | MCP server (HTTP SSE transport) |
| [`lcyt`](python-packages/lcyt/) | PyPI | `pip install lcyt` | Core Python library |
| [`lcyt-backend`](python-packages/lcyt-backend/) | pip | `pip install lcyt-backend` | Python/Flask backend relay (cPanel/Passenger) |

### Breaking change in lcyt v2.0.0

The `lcyt` npm package no longer includes the CLI. The CLI has been moved to a separate [`lcyt-cli`](https://www.npmjs.com/package/lcyt-cli) package. There is currently some bugs in the -f version of lcyt-cli. Please use -i.

## Quick Start with CLI

```bash
npx lcyt-cli                          # Launch full-screen mode
npx lcyt-cli --stream-key "YOUR_KEY"  # Set stream key
npx lcyt-cli "Hello, world!"          # Send a caption
npx lcyt-cli -i                       # Interactive mode
npx lcyt-cli -f                       # Full-screen mode
npx lcyt-cli --heartbeat              # Test connection
```

See the [lcyt-cli package](packages/lcyt-cli/) for full CLI documentation.

## Logging to stderr (MCP friendliness)

When running `lcyt-cli` under MCP or other protocol parsers, human-friendly log lines must not appear on stdout (they can break parsers). Use the `--log-stderr` flag or the `LCYT_LOG_STDERR=1` environment variable to route human logs to `stderr` while keeping protocol messages on `stdout`:

```bash
# using flag
npx lcyt-cli --heartbeat --log-stderr --stream-key YOUR_KEY

# using environment variable
LCYT_LOG_STDERR=1 npx lcyt-cli --heartbeat --stream-key YOUR_KEY
```

## Library Usage (Node.js)

Both ESM and CJS are provided.

```bash
npm install lcyt
```

```javascript
import { YoutubeLiveCaptionSender } from 'lcyt';

const sender = new YoutubeLiveCaptionSender({
  streamKey: 'YOUR_STREAM_KEY'
});

sender.start();
await sender.send('Hello, world!');
sender.end();
```

See the [lcyt package](packages/lcyt/) for full API documentation.

## Library Usage (Python)

```bash
pip install lcyt
```

```python
from lcyt import YoutubeLiveCaptionSender

sender = YoutubeLiveCaptionSender(stream_key="YOUR_STREAM_KEY")
sender.start()
sender.send("Hello, world!")
sender.end()
```

See the [Python package documentation](python-packages/lcyt/README.md) for full API reference.

## Development

This project uses npm workspaces. To get started:

```bash
npm install          # Install all dependencies
npm test             # Run tests across all packages
npm run build        # Build CJS output for core library
```

## Deployment notes

- **Set a stable `JWT_SECRET`**: for production, set `JWT_SECRET` in your environment so session tokens remain valid across restarts. Example in `docker-compose.yml`:

```yaml
environment:
  - JWT_SECRET=replace-with-a-secure-random-value
```

- **DB volume ownership**: the SQLite file is stored in a named Docker volume (e.g. `live-captions-yt_lcyt-db`). If you see `SqliteError: attempt to write a readonly database`, ensure the volume is owned by the runtime user (typical `node` UID 1000). One-off fix:

```bash
# on the host (alpine image used for chown)
docker run --rm -v live-captions-yt_lcyt-db:/data alpine chown -R 1000:1000 /data
```

- **MCP SSE network exposure**: the MCP SSE service is sensitive — bind it to loopback on the host and reverse-proxy from nginx if you need external access. The included `docker-compose.yml` binds port 3001 to `127.0.0.1:3001:3001` by default so it's not externally reachable. If you expose it, ensure you use a secure reverse proxy and firewall rules.

- **Reconnection behavior**: when the backend restarts, sessions persisted in SQLite are rehydrated without an active sender. When a client POSTs `/live` to re-register, the server will issue a fresh JWT for the rehydrated session so the client can obtain a usable token and open the SSE stream.

- **Optional: persist tokens**: if you prefer tokens to survive restarts without client re-registration, modify the server to persist issued tokens and ensure `JWT_SECRET` is stable. The current default behaviour is to re-issue tokens on re-register.


## Google Caption Format

LCYT implements Google's official YouTube Live caption format:

### Request Format
- **Method:** POST
- **Content-Type:** `text/plain`
- **URL params:** `cid=<stream_key>&seq=N`

Note: Do not to try to add charset in the Content-Type!

### Timestamp Format

Timestamps use the format:

```
YYYY-MM-DDTHH:MM:SS.mmm
```

- No trailing `Z`, no UTC offset — millisecond precision
- Example: `2024-01-15T12:00:00.000`
- Must be within 60 seconds of the server's current time

The libraries accept multiple timestamp forms — see the [lcyt package docs](packages/lcyt/) (Node.js) and [Python package docs](python-packages/lcyt/README.md) for the full list including `Date`/`datetime` objects, epoch numbers, and relative second offsets.

### Region and Cue information

A region/cue identifier may follow the timestamp on the same line. It is optional. It's format is (`region:reg1#cue1`). The effects of the regions and cues is not well documented and has not been tested. Some indication has been given that cue means possible places for advertisement breaks.

### Complete body Format
```
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

> **Important Requirements:**
> - **Timestamps must be within 60 seconds** of the server's current time
> - **Body must end with a trailing newline** (`\n`)
> - Region/cue identifier after timestamp is optional . 

> **Note on numeric epoch values:** The Node.js library treats numbers >= 1000 as **milliseconds** (`Date.now()` convention); the Python library treats them as **seconds** (`time.time()` convention).

## YouTube Setup

To get your YouTube Live caption ingestion URL and key:

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** → **Schelude a broadcast**
3. Set up your stream settings
4. Set a **30 second delay** for the broadcast (important!)
5. Look for **Closed captions** in settings, enable it
6. Enable **POST captions to URL** for closed captions
7. Copy the ingestion URL (usually stable, default in the library) and stream key

## Motivation

YouTube already has English transcription for live videos, why bother? Well, there are other languages as well, and you might want to have another model do the transcription! This project was initially founded to serve as accessibility feature for the (Evangelical Lutheran Church of Finland)[evl.fi], but was created from the beginning as a general tool for anyone to use.

## Contributing

You are welcome to contribute by opening issues and contributing code. Just fork and do a pull request when your feature is ready.

## Copyright

Juha Itäleino (@jsilvanus), <jsilvanus@gmail.com>

## License

MIT
