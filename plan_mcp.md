# Plan: Add MCP to lcyt-backend

## What is MCP?

Model Context Protocol (MCP) is an open standard from Anthropic for connecting AI assistants to external tools and data. An **MCP server** exposes **tools** (callable functions) and **resources** (readable data) over a standardized protocol, so clients like Claude Desktop or Claude Code can discover and invoke them without custom glue code.

Adding MCP to lcyt-backend means an AI assistant can directly send live captions to YouTube, manage sessions, and query status — using natural language.

---

## Scope

Both the Python and Node.js backends have the same API surface. This plan covers:

- **Primary**: Python MCP server (`python-packages/lcyt-mcp/`)
- **Secondary**: Node.js MCP server (`packages/lcyt-mcp/`) — same design, different SDK

The MCP server **wraps the `lcyt` library directly** rather than calling the backend over HTTP. This avoids an extra network hop and simplifies deployment: the MCP server *is* the backend for AI-driven use.

For deployments where a shared backend already runs, an HTTP-proxy variant can call the existing REST endpoints instead; see the extension note at the end.

---

## Architecture

```
Claude Desktop / Claude Code
        │  MCP (stdio or HTTP/SSE)
        ▼
  lcyt-mcp server
        │  Python import / Node import
        ▼
  lcyt library (YoutubeLiveCaptionSender)
        │  HTTPS POST
        ▼
  YouTube Live Caption Ingestion API
```

The MCP server owns an in-memory session store (reusing the existing `store.py` / `store.js`) and an SQLite API-key database (reusing `db.py` / `db.js`). It is **stateful** across tool calls within a single MCP session.

---

## Python MCP Server

### Package layout

```
python-packages/lcyt-mcp/
├── pyproject.toml
├── requirements.txt
├── README.md
└── lcyt_mcp/
    ├── __init__.py
    ├── server.py        # MCP server entry point
    ├── session.py       # Thin wrapper around store + lcyt
    └── tools.py         # Tool and resource definitions
```

### Dependencies

```
mcp>=1.0                 # Anthropic MCP Python SDK
lcyt>=1.1.1              # lcyt Python library (sibling package)
```

The `lcyt-backend` package (Flask) is **not** a dependency — the MCP server uses `lcyt` and the shared store/db modules directly. If the store and db modules need reuse, copy or factor them into a `lcyt-core` package (see trade-offs below).

### MCP Tools

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `register_session` | `api_key`, `stream_key`, `domain` | Start or resume a caption session. Returns `session_id`, `token`, `sequence`, `sync_offset`. |
| `send_caption` | `session_id`, `text`, `timestamp?` | Send a single caption line. `timestamp` is ISO-8601; omit to use server clock + sync offset. |
| `send_batch` | `session_id`, `captions` (array of `{text, timestamp?}`) | Send multiple captions atomically. |
| `sync_clock` | `session_id` | NTP-style round-trip to YouTube; updates `sync_offset`. Returns offset in ms. |
| `get_session_status` | `session_id` | Returns sequence, sync_offset, started_at, last_activity. |
| `teardown_session` | `session_id` | Calls `sender.end()`, removes session. |
| `health_check` | — | Returns `{ok, uptime, active_sessions}`. |
| `create_api_key` | `owner`, `expires_at?` | Admin: create a new API key. Requires `ADMIN_KEY` env var. |
| `list_api_keys` | — | Admin: list all keys. |
| `revoke_api_key` | `key`, `permanent?` | Admin: soft- or hard-delete a key. |

### MCP Resources

| URI | Description |
|-----|-------------|
| `session://{session_id}` | JSON snapshot of session state. |
| `health://status` | `{ok, uptime, active_sessions}`. |

### Authentication inside tools

- `register_session` validates `api_key` against SQLite before creating a sender.
- Admin tools (`create_api_key`, `list_api_keys`, `revoke_api_key`) check the `ADMIN_KEY` env var. If unset they return an error.
- The MCP transport itself is unauthenticated by default (stdio). For HTTP/SSE transport, add bearer-token middleware in `server.py`.

### server.py sketch

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
from .session import SessionManager

app = Server("lcyt-mcp")
manager = SessionManager()   # wraps store + db

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [...]   # one Tool descriptor per row in the table above

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.Content]:
    match name:
        case "register_session":
            result = await manager.register(**arguments)
            return [types.TextContent(type="text", text=str(result))]
        case "send_caption":
            result = await manager.send_caption(**arguments)
            return [types.TextContent(type="text", text=str(result))]
        # ... etc.

@app.list_resources()
async def list_resources() -> list[types.Resource]:
    return [types.Resource(uri="health://status", name="Health status", ...)]

@app.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "health://status":
        return str(manager.health())
    if uri.startswith("session://"):
        session_id = uri.removeprefix("session://")
        return str(manager.get_status(session_id))

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

### pyproject.toml

```toml
[project]
name = "lcyt-mcp"
version = "1.0.0"
dependencies = ["mcp>=1.0", "lcyt>=1.1.1"]

[project.scripts]
lcyt-mcp = "lcyt_mcp.server:main"
```

---

## Node.js MCP Server

### Package layout

```
packages/lcyt-mcp/
├── package.json
├── README.md
└── src/
    ├── server.js        # MCP server entry point
    ├── session.js       # SessionManager wrapping store + lcyt
    └── tools.js         # Tool and resource definitions
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "lcyt": "workspace:*",
    "better-sqlite3": "^9.0.0"
  }
}
```

### server.js sketch

```js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionManager } from "./session.js";

const server = new Server({ name: "lcyt-mcp", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} } });
const manager = new SessionManager();

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const { name, arguments: args } = params;
  // dispatch to manager methods
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Transport options

| Transport | When to use |
|-----------|-------------|
| **stdio** (default) | Claude Desktop or Claude Code local config — zero network setup. |
| **HTTP + SSE** | Shared server deployment where multiple clients connect. Add bearer-token middleware. |

---

## Implementation steps

1. **Factor shared code** (optional but clean): extract `store.py` and `db.py` from `lcyt-backend` into a `lcyt-core` internal package so both `lcyt-backend` and `lcyt-mcp` can import them without duplication.

2. **Create `python-packages/lcyt-mcp/`** with the layout above. Copy (or import) the session store logic. Implement `SessionManager` wrapping `YoutubeLiveCaptionSender`.

3. **Implement all tools and resources** in `tools.py`, wire them in `server.py`.

4. **Write tests** using `mcp`'s in-process test client. Mirror the existing pytest suite pattern in `python-packages/lcyt-backend/tests/`.

5. **Create `packages/lcyt-mcp/`** (Node.js mirror) following the same structure with `@modelcontextprotocol/sdk`.

6. **Add workspace config**: register both new packages in `package.json` workspaces and `pyproject.toml` as needed.

7. **Document Claude Desktop setup** in each package's README:
   ```json
   {
     "mcpServers": {
       "lcyt": {
         "command": "lcyt-mcp",
         "env": {
           "ADMIN_KEY": "...",
           "DB_PATH": "/path/to/lcyt-backend.db"
         }
       }
     }
   }
   ```

---

## Trade-offs and alternatives

| Option | Pro | Con |
|--------|-----|-----|
| MCP server wraps `lcyt` directly (this plan) | No extra HTTP hop; simpler deployment | Duplicates session/db logic unless factored out |
| MCP server calls existing REST backend | No code duplication; backend already tested | Requires running backend; extra latency; needs auth token management |
| Embed MCP transport inside existing Flask/Express app | Single process | Mixes concerns; Flask is not async-native |

For most users, **this plan (direct `lcyt` wrapping)** is the right choice. The HTTP-proxy variant is better when a backend is already running and shared by web clients.

---

## Files to create

```
python-packages/lcyt-mcp/
  pyproject.toml
  requirements.txt
  lcyt_mcp/__init__.py
  lcyt_mcp/server.py
  lcyt_mcp/session.py
  lcyt_mcp/tools.py
  tests/test_tools.py

packages/lcyt-mcp/
  package.json
  src/server.js
  src/session.js
  src/tools.js
```

No changes required to the existing `lcyt-backend` packages for the default (direct) approach.
