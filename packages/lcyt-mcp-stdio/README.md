# lcyt-mcp-stdio

MCP (Model Context Protocol) server for sending live captions to YouTube Live streams — **stdio transport**.

Enables AI assistants such as Claude to send captions by exposing the `lcyt` caption sender as MCP tools over standard input/output.

> For the HTTP SSE variant, see [`lcyt-mcp-sse`](../lcyt-mcp-sse/).

## Usage

```bash
# From the monorepo root
node packages/lcyt-mcp-stdio/src/server.js
```

The server communicates over stdio. Configure your MCP host (e.g. Claude Desktop) to launch this command.

## Tools

| Tool | Description |
|------|-------------|
| `start` | Create a caption session. Accepts `stream_key`. Returns `session_id`. |
| `send_caption` | Send a single caption. Accepts `session_id`, `text`, optional `timestamp`. |
| `send_batch` | Send multiple captions in one request. Accepts `session_id`, `captions[]`. |
| `sync_clock` | NTP-style clock synchronisation with YouTube's server. Accepts `session_id`. |
| `status` | Return sequence number and sync offset for a session. Accepts `session_id`. |

## Resources

The server also exposes an MCP resource listing all active sessions.

## Example (Claude Desktop config)

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "node",
      "args": ["/path/to/live-captions-yt/packages/lcyt-mcp-stdio/src/server.js"]
    }
  }
}
```

## License

MIT
