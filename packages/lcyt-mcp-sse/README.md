# lcyt-mcp-sse

MCP (Model Context Protocol) server for sending live captions to YouTube Live streams — **HTTP SSE transport**.

Exposes the same tools as [`lcyt-mcp-stdio`](../lcyt-mcp-stdio/) over HTTP Server-Sent Events, which allows remote AI clients to connect without spawning a local process.

## Usage

```bash
# From the monorepo root
node packages/lcyt-mcp-sse/src/server.js

# With a custom port
PORT=3001 node packages/lcyt-mcp-sse/src/server.js
```

Default port: **3001**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sse` | Open an SSE stream. MCP clients connect here. |
| `POST` | `/messages?sessionId=<id>` | Send a message to an active SSE session. |

Caption sessions (identified by `session_id`) survive SSE reconnects because they are stored in a shared in-memory map for the lifetime of the server process.

## Tools

| Tool | Description |
|------|-------------|
| `start` | Create a caption session. Accepts `stream_key`. Returns `session_id`. |
| `send_caption` | Send a single caption. Accepts `session_id`, `text`, optional `timestamp`. |
| `send_batch` | Send multiple captions in one request. Accepts `session_id`, `captions[]`. |
| `sync_clock` | NTP-style clock synchronisation with YouTube's server. Accepts `session_id`. |
| `status` | Return sequence number and sync offset for a session. Accepts `session_id`. |

## License

MIT
