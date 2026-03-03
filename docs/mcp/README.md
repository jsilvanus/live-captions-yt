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

## Configuration Examples

### Claude Desktop — stdio

The stdio server integrates directly with Claude Desktop. Add the following block to your `claude_desktop_config.json` (location: `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "node",
      "args": ["/absolute/path/to/packages/lcyt-mcp-stdio/src/server.js"],
      "env": {
        "LCYT_LOG_STDERR": "1"
      }
    }
  }
}
```

If you installed `lcyt-mcp-stdio` via npm globally you can also use:

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "npx",
      "args": ["lcyt-mcp-stdio"],
      "env": {
        "LCYT_LOG_STDERR": "1"
      }
    }
  }
}
```

After restarting Claude Desktop, the tools (`start`, `send_caption`, `send_batch`, `sync_clock`, `get_status`, `stop`) will be available. You can prompt Claude with:

> _"Start a YouTube Live caption session with stream key xxxx-xxxx-xxxx-xxxx and send 'Hello, world!'"_

### Claude Desktop — SSE (via reverse proxy or local port)

When the MCP SSE server is running locally (e.g. bound to `127.0.0.1:3001` behind nginx), you can connect to it from Claude Desktop using an HTTP-based MCP client config:

```json
{
  "mcpServers": {
    "lcyt-sse": {
      "type": "sse",
      "url": "http://127.0.0.1:3001/sse"
    }
  }
}
```

With an API key (when `MCP_REQUIRE_API_KEY=1` is set on the server):

```json
{
  "mcpServers": {
    "lcyt-sse": {
      "type": "sse",
      "url": "http://127.0.0.1:3001/sse?apiKey=your-api-key"
    }
  }
}
```

### Docker / production (SSE server behind nginx)

The included `docker-compose.yml` binds both ports to loopback so they are not directly reachable from the public internet. Configure your host nginx to reverse-proxy from HTTPS to the local ports:

```nginx
# API backend (port 3000)
server {
    listen 443 ssl;
    server_name api.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# MCP SSE server (port 3001)
server {
    listen 443 ssl;
    server_name mcp.example.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';   # required for SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then configure your MCP client to use the public HTTPS endpoint:

```json
{
  "mcpServers": {
    "lcyt-sse": {
      "type": "sse",
      "url": "https://mcp.example.com/sse?apiKey=your-api-key"
    }
  }
}
```

---

## Important: Log Routing

Both MCP servers must **not** write logs to `stdout` because the MCP protocol uses `stdout` for its message stream. Set the environment variable `LCYT_LOG_STDERR=1` to route all `lcyt` logs to `stderr`.

```bash
LCYT_LOG_STDERR=1 node packages/lcyt-mcp-stdio/src/server.js
```

---

## Deployment & security

- **Bind SSE to loopback when possible**: for single-host deployments bind the SSE server to `127.0.0.1` and expose it via a secure reverse proxy only when necessary.
- **Set a stable `JWT_SECRET`** in production if you persist session tokens or expect tokens to survive server restarts.
- **Ensure DB volume ownership** when using `DB_PATH` with Docker; chown the volume to the runtime UID (e.g., `1000:1000`) to avoid read-only SQLite errors.
 - **SSE DB-backed persistence**: when `DB_PATH` is configured the SSE server can persist session metadata and will rehydrate sessions on startup (this will start sender instances for persisted sessions). See `sse.md` for details and operational notes.

## Reference

- [Tools Reference](./tools.md) — all tools with per-tool transport availability (stdio / SSE)
- [Stdio Transport](./stdio.md) — configuration and integration guide
- [SSE Transport](./sse.md) — configuration and integration guide
