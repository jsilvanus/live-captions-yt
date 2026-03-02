# MCP Servers — Overview

`lcyt` provides two Model Context Protocol (MCP) servers that allow AI assistants (such as Claude) to send live captions to YouTube Live.

Both servers expose the same set of [tools](./tools.md) and differ only in their transport mechanism.

| Package | Transport | Best for |
|---|---|---|
| [`lcyt-mcp-stdio`](./stdio.md) | stdio | Claude Desktop, subprocess MCP clients |
| [`lcyt-mcp-sse`](./sse.md) | HTTP + SSE | Remote/web MCP clients, shared sessions |

---

## Quick Start

### Stdio (Claude Desktop)

```bash
node packages/lcyt-mcp-stdio/src/server.js
```

Add to your Claude Desktop config:
```json
{
  "mcpServers": {
    "lcyt": {
      "command": "node",
      "args": ["/path/to/packages/lcyt-mcp-stdio/src/server.js"],
      "env": { "LCYT_LOG_STDERR": "1" }
    }
  }
}
```

### SSE (HTTP)

```bash
PORT=3001 node packages/lcyt-mcp-sse/src/server.js
```

Connect your MCP client to:
- `GET http://localhost:3001/sse` — open SSE stream
- `POST http://localhost:3001/messages?sessionId=<id>` — send messages

---

## Important: Log Routing

Both MCP servers must **not** write logs to `stdout` because the MCP protocol uses `stdout` for its message stream. Set the environment variable `LCYT_LOG_STDERR=1` to route all `lcyt` logs to `stderr`.

```bash
LCYT_LOG_STDERR=1 node packages/lcyt-mcp-stdio/src/server.js
```

---

## Reference

- [Tools Reference](./tools.md) — all tools, parameters, and return values
- [Stdio Transport](./stdio.md) — configuration and integration guide
- [SSE Transport](./sse.md) — configuration and integration guide
