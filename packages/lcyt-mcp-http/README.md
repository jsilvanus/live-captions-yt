# lcyt-mcp-http

MCP (Model Context Protocol) server for sending live captions to YouTube Live streams — **Streamable HTTP transport**.

Exposes the same tools as [`lcyt-mcp-stdio`](../lcyt-mcp-stdio/) over the MCP Streamable HTTP transport, which allows remote AI clients to connect without spawning a local process.

## Usage

```bash
# From the monorepo root
node packages/lcyt-mcp-http/src/server.js

# With a custom port
PORT=3001 node packages/lcyt-mcp-http/src/server.js
```

Default port: **3001**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | Send a JSON-RPC message. An `initialize` request with no `Mcp-Session-Id` header opens a new session. |
| `GET` | `/mcp` | Open the server-initiated SSE stream for an existing session (`Mcp-Session-Id` header required). |
| `DELETE` | `/mcp` | Terminate a session (`Mcp-Session-Id` header required). |

Caption sessions (identified by `session_id`) survive reconnects because they are stored in a shared in-memory map for the lifetime of the server process.

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
