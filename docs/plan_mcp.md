# Plan: Add MCP to lcyt-backend

## What is MCP?

Model Context Protocol (MCP) is an open standard from Anthropic for connecting AI assistants to external tools and data. An **MCP server** exposes **tools** (callable functions) and **resources** (readable data) over a standardized protocol, so clients like Claude Desktop or Claude Code can discover and invoke them without custom glue code.

Adding MCP to lcyt-backend means an AI assistant can directly send live captions to a YouTube Live stream using natural language.

---

## Scope

No authentication, API keys, admin tools, or database — just the core captioning functionality. Auth can be layered on later if needed.

Both a Python and Node.js implementation are planned:

- **Primary**: Python MCP server (`python-packages/lcyt-mcp/`)
- **Secondary**: Node.js MCP server (`packages/lcyt-mcp/`)

---

## Architecture

```
Claude Desktop / Claude Code
        │  MCP (stdio)
        ▼
  lcyt-mcp server
        │  Python / Node import
        ▼
  lcyt library (YoutubeLiveCaptionSender)
        │  HTTPS POST
        ▼
  YouTube Live Caption Ingestion API
```

The MCP server holds a single `YoutubeLiveCaptionSender` instance (or a small dict of them keyed by stream key). No database, no JWT, no session store — just the sender and its state.

---

## MCP Tools

| Tool name | Parameters | Description |
|-----------|-----------|-------------|
| `start` | `stream_key` | Create a sender, call `sender.start()`. Returns `session_id`. |
| `send_caption` | `session_id`, `text`, `timestamp?` | Send a single caption. `timestamp` is ISO-8601; omit to use current time. |
| `send_batch` | `session_id`, `captions` (array of `{text, timestamp?}`) | Send multiple captions atomically. |
| `sync_clock` | `session_id` | NTP-style round-trip to YouTube; returns `sync_offset` in ms. |
| `get_status` | `session_id` | Returns current sequence number and sync offset. |
| `stop` | `session_id` | Call `sender.end()` and remove the session. |

`session_id` is just a random string generated at `start` time — no hashing or determinism needed without auth.

---

## MCP Resources

| URI | Description |
|-----|-------------|
| `session://{session_id}` | JSON snapshot: `{sequence, syncOffset, startedAt}`. |

---

## Python MCP Server

### Package layout

```
python-packages/lcyt-mcp/
├── pyproject.toml
├── requirements.txt
└── lcyt_mcp/
    ├── __init__.py
    └── server.py
```

Single file is enough — no session manager abstraction needed at this scale.

### Dependencies

```
mcp>=1.0
lcyt>=1.1.1
```

### server.py sketch

```python
import asyncio, secrets
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
from lcyt import YoutubeLiveCaptionSender

app = Server("lcyt-mcp")
sessions: dict[str, YoutubeLiveCaptionSender] = {}

@app.list_tools()
async def list_tools():
    return [
        types.Tool(name="start",        inputSchema={"type":"object","properties":{"stream_key":{"type":"string"}},"required":["stream_key"]}),
        types.Tool(name="send_caption", inputSchema={"type":"object","properties":{"session_id":{"type":"string"},"text":{"type":"string"},"timestamp":{"type":"string"}},"required":["session_id","text"]}),
        types.Tool(name="send_batch",   inputSchema={"type":"object","properties":{"session_id":{"type":"string"},"captions":{"type":"array"}},"required":["session_id","captions"]}),
        types.Tool(name="sync_clock",   inputSchema={"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}),
        types.Tool(name="get_status",   inputSchema={"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}),
        types.Tool(name="stop",         inputSchema={"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}),
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    match name:
        case "start":
            sender = YoutubeLiveCaptionSender(stream_key=arguments["stream_key"])
            await sender.start()
            sid = secrets.token_hex(8)
            sessions[sid] = sender
            return [types.TextContent(type="text", text=f'{{"session_id":"{sid}"}}')]
        case "send_caption":
            sender = sessions[arguments["session_id"]]
            ts = arguments.get("timestamp")
            await sender.send(arguments["text"], ts)
            return [types.TextContent(type="text", text='{"ok":true}')]
        case "send_batch":
            sender = sessions[arguments["session_id"]]
            await sender.send_batch(arguments["captions"])
            return [types.TextContent(type="text", text='{"ok":true}')]
        case "sync_clock":
            sender = sessions[arguments["session_id"]]
            offset = await sender.sync()
            return [types.TextContent(type="text", text=f'{{"syncOffset":{offset}}}')]
        case "get_status":
            sender = sessions[arguments["session_id"]]
            return [types.TextContent(type="text", text=f'{{"sequence":{sender.sequence}}}')]
        case "stop":
            sender = sessions.pop(arguments["session_id"])
            await sender.end()
            return [types.TextContent(type="text", text='{"ok":true}')]

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
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
└── src/
    └── server.js
```

### Dependencies

```json
{
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "lcyt": "workspace:*"
  }
}
```

### server.js sketch

```js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { YoutubeLiveCaptionSender } from "lcyt";
import { randomBytes } from "node:crypto";

const server = new Server({ name: "lcyt-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
const sessions = new Map();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "start",        inputSchema: { type: "object", properties: { stream_key: { type: "string" } }, required: ["stream_key"] } },
    { name: "send_caption", inputSchema: { type: "object", properties: { session_id: { type: "string" }, text: { type: "string" }, timestamp: { type: "string" } }, required: ["session_id", "text"] } },
    { name: "send_batch",   inputSchema: { type: "object", properties: { session_id: { type: "string" }, captions: { type: "array" } }, required: ["session_id", "captions"] } },
    { name: "sync_clock",   inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
    { name: "get_status",   inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
    { name: "stop",         inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
  switch (name) {
    case "start": {
      const sender = new YoutubeLiveCaptionSender({ streamKey: args.stream_key });
      await sender.start();
      const sid = randomBytes(8).toString("hex");
      sessions.set(sid, sender);
      return { content: [{ type: "text", text: JSON.stringify({ session_id: sid }) }] };
    }
    case "send_caption": {
      await sessions.get(args.session_id).send(args.text, args.timestamp);
      return { content: [{ type: "text", text: '{"ok":true}' }] };
    }
    case "send_batch": {
      await sessions.get(args.session_id).sendBatch(args.captions);
      return { content: [{ type: "text", text: '{"ok":true}' }] };
    }
    case "sync_clock": {
      const offset = await sessions.get(args.session_id).sync();
      return { content: [{ type: "text", text: JSON.stringify({ syncOffset: offset }) }] };
    }
    case "get_status": {
      const sender = sessions.get(args.session_id);
      return { content: [{ type: "text", text: JSON.stringify({ sequence: sender.sequence }) }] };
    }
    case "stop": {
      const sender = sessions.get(args.session_id);
      sessions.delete(args.session_id);
      await sender.end();
      return { content: [{ type: "text", text: '{"ok":true}' }] };
    }
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Claude Desktop config

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "lcyt-mcp"
    }
  }
}
```

No env vars needed.

---

## Implementation steps

1. Create `python-packages/lcyt-mcp/` with `pyproject.toml` and `lcyt_mcp/server.py`.
2. Create `packages/lcyt-mcp/` with `package.json` and `src/server.js`.
3. Register both in the root `package.json` workspaces array.
4. Write a minimal smoke test for each (start → send → stop).

---

## Files to create

```
python-packages/lcyt-mcp/
  pyproject.toml
  requirements.txt
  lcyt_mcp/__init__.py
  lcyt_mcp/server.py

packages/lcyt-mcp/
  package.json
  src/server.js
```
