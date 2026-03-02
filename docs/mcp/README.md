---
title: "MCP Servers — Overview"
---

# MCP Servers — Overview

`lcyt` provides two Model Context Protocol (MCP) servers that allow AI assistants (such as Claude) to send live captions to YouTube Live.

Both servers share a common set of caption tools; the SSE server adds two additional tools for privacy and GDPR data deletion. They differ in their transport mechanism.

| Package | Transport | Best for |
|---|---|---|
| [`lcyt-mcp-stdio`](./stdio.md) | stdio | Claude Desktop, subprocess MCP clients |
| [`lcyt-mcp-sse`](./sse.md) | HTTP + SSE | Remote/web MCP clients, shared sessions |

---

## stdio vs SSE — Detailed Comparison

| Feature | stdio (`lcyt-mcp-stdio`) | SSE (`lcyt-mcp-sse`) |
|---|---|---|
| **Transport** | stdin/stdout pipes | HTTP + Server-Sent Events |
| **Port** | None — runs as subprocess | `PORT` env var (default `3001`) |
| **Sessions** | One session per process | Multiple concurrent sessions shared across clients |
| **Client support** | Claude Desktop, any MCP stdio client | Any HTTP-capable MCP client |
| **Tools available** | `start`, `send_caption`, `send_batch`, `sync_clock`, `get_status`, `stop` | All stdio tools + `privacy`, `privacy_deletion` |
| **MCP Resources** | `session://<id>` resource exposed | Resources not available |
| **Auth** | None — process-level isolation | Optional API key enforcement |
| **GDPR tools** | Not available | `privacy`, `privacy_deletion` |
| **Log routing** | Requires `LCYT_LOG_STDERR=1` | Requires `LCYT_LOG_STDERR=1` |
| **Typical use** | Single user, local AI assistant | Shared service, multiple users |

See the [Tools Reference](./tools.md) for full per-tool transport availability.

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

- [Tools Reference](./tools.md) — all tools with per-tool transport availability (stdio / SSE)
- [Stdio Transport](./stdio.md) — configuration and integration guide
- [SSE Transport](./sse.md) — configuration and integration guide
