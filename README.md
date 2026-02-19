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
| [`lcyt`](python/) | PyPI | `pip install lcyt` | Core Python library |

### Breaking change in lcyt v2.0.0

The `lcyt` npm package no longer includes the CLI. The CLI has been moved to a separate [`lcyt-cli`](https://www.npmjs.com/package/lcyt-cli) package.

**If you were using the CLI**, switch to:
```bash
npm install -g lcyt-cli   # Global install
# or
npx lcyt-cli              # One-off usage
```

**If you were using the library**, no changes needed — `import { YoutubeLiveCaptionSender } from 'lcyt'` still works.

### Current status of lcyt-cli

There is currently some bugs in the -f version of lcyt-cli. Please use -i.

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

See the [Python package documentation](python/README.md) for full API reference.

## Development

This project uses npm workspaces. To get started:

```bash
npm install          # Install all dependencies
npm test             # Run tests across all packages
npm run build        # Build CJS output for core library
```

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

The libraries accept multiple timestamp forms — see the [lcyt package docs](packages/lcyt/) (Node.js) and [Python package docs](python/README.md) for the full list including `Date`/`datetime` objects, epoch numbers, and relative second offsets.

### Body Format
```
YYYY-MM-DDTHH:MM:SS.mmm region:reg1#cue1
CAPTION TEXT
YYYY-MM-DDTHH:MM:SS.mmm
ANOTHER CAPTION
```

> **Important Requirements:**
> - **Timestamps must be within 60 seconds** of the server's current time
> - **Body must end with a trailing newline** (`\n`)
> - Region/cue identifier after timestamp is optional (`region:reg1#cue1`). The effects of the regions and cues is not documented and has not been tested.

## YouTube Setup

To get your YouTube Live caption ingestion URL and key:

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Create** → **Go Live**
3. Set up your stream settings
4. Look for **Closed captions** in the stream settings
5. Enable **POST captions to URL**
6. Copy the ingestion URL (this is usually stable and has been added as a default) and stream key

## Contributing

You are welcome to contribute by opening issues and contributing code.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Copyright

Juha Itäleino (@jsilvanus), <jsilvanus@gmail.com>

## License

MIT
