# Plan: MCP Tools for lcyt

---
id: plan/mcp
---

## What is MCP?

Model Context Protocol (MCP) is an open standard from Anthropic for connecting AI assistants to external tools and data. An **MCP server** exposes **tools** (callable functions) and **resources** (readable data) over a standardized protocol, so clients like Claude Desktop or Claude Code can discover and invoke them without custom glue code.

The lcyt MCP servers let an AI assistant send live captions, control production hardware (cameras, mixers), and manage DSK graphics overlays — all from natural language.

---

## Scope

Three tool groups:

1. **Caption tools** — send captions directly to YouTube (uses `YoutubeLiveCaptionSender`; no backend required)
2. **Production tools** — list cameras/mixers, trigger PTZ presets, switch mixer sources (requires lcyt-backend + admin key)
3. **Graphics/DSK tools** — manage DSK overlay templates, activate and broadcast live data to the renderer, control the RTMP stream (requires lcyt-backend + API key)

Both a Python and Node.js implementation are planned:

- **Primary**: Python MCP server (`python-packages/lcyt-mcp/`)
- **Secondary**: Node.js MCP servers (`packages/lcyt-mcp-stdio/`, `packages/lcyt-mcp-sse/`)

---

## Architecture

### Caption tools (standalone, no backend)

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

### Production and graphics tools (require lcyt-backend)

```
Claude Desktop / Claude Code
        │  MCP (stdio)
        ▼
  lcyt-mcp server
        │  HTTP REST (fetch / requests)
        ▼
  lcyt-backend Express server
        │  SQLite / TCP / Playwright
        ▼
  Cameras (AMX PTZ), Mixers (Roland/AMX), DSK renderer (Playwright + ffmpeg)
```

### Backend authentication

| Tool group | Header sent by MCP server | Backend middleware |
|---|---|---|
| Production (cameras, mixers) | `X-Admin-Key: <admin_key>` | `adminMiddleware` |
| Graphics/DSK | `X-API-Key: <api_key>` | `editorAuth` (editor auth) |

Credentials are supplied via environment variables (see Claude Desktop config below).

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `LCYT_BACKEND_URL` | production + graphics tools | Base URL of the lcyt-backend, e.g. `https://api.lcyt.fi` |
| `LCYT_API_KEY` | graphics tools | API key for DSK editor auth (`X-API-Key` header) |
| `LCYT_ADMIN_KEY` | production tools | Admin key for camera/mixer control (`X-Admin-Key` header) |

---

## MCP Tools

### Caption tools (existing)

| Tool name | Parameters | Description |
|---|---|---|
| `start` | `stream_key` | Create a `YoutubeLiveCaptionSender` and start a session. Returns `session_id`. |
| `send_caption` | `session_id`, `text`, `timestamp?` | Send a single caption. `timestamp` is ISO-8601; omit to use current time. |
| `send_batch` | `session_id`, `captions` (array of `{text, timestamp?}`) | Send multiple captions atomically. |
| `sync_clock` | `session_id` | NTP-style round-trip to YouTube; returns `sync_offset` in ms. |
| `get_status` | `session_id` | Returns current sequence number and sync offset. |
| `stop` | `session_id` | Call `sender.end()` and remove the session. |

`session_id` is a random hex string generated at `start` time.

---

### Production tools (new)

All production tools make HTTP requests to `LCYT_BACKEND_URL` with `X-Admin-Key: LCYT_ADMIN_KEY`.

| Tool name | HTTP call | Parameters | Description |
|---|---|---|---|
| `list_cameras` | `GET /production/cameras` | _(none)_ | Return all cameras with their `id`, `name`, `mixerInput`, `controlType`, and `controlConfig`. |
| `camera_preset` | `POST /production/cameras/:id/preset/:preset` | `camera_id`, `preset_id` | Trigger a PTZ preset on a camera. If the camera is assigned to a bridge agent, the command is relayed via SSE. Returns `{ ok, cameraId, presetId }`. |
| `list_mixers` | `GET /production/mixers` | _(none)_ | Return all mixers with `id`, `name`, `type`, `connected`, and `activeSource`. |
| `switch_source` | `POST /production/mixers/:id/switch/:input` | `mixer_id`, `input` (positive integer) | Switch the mixer's live program source. If the mixer is on a bridge, the command is relayed. Returns `{ ok, mixerId, activeSource }`. |

**Error handling**: 503 means the bridge/TCP connection is unavailable; 400 means bad input; 404 means device not found.

---

### Graphics / DSK tools (new)

All DSK tools make HTTP requests to `LCYT_BACKEND_URL` with `X-API-Key: LCYT_API_KEY`.

| Tool name | HTTP call | Parameters | Description |
|---|---|---|---|
| `list_dsk_templates` | `GET /dsk/:apikey/templates` | _(none)_ | List all saved DSK overlay templates for the API key. Returns `[{ id, name, updated_at }]`. |
| `activate_dsk_template` | `POST /dsk/:apikey/templates/:id/activate` | `template_id` | Load a template into the Playwright renderer. The overlay updates immediately on the DSK page. Returns `{ ok, id, name }`. |
| `broadcast_dsk_data` | `POST /dsk/:apikey/broadcast` | `updates` (array of `{selector, text}`) | Inject live text into the renderer via `page.evaluate()` without reloading the page. Animations keep running. Accepts a single `{selector, text}` shorthand too. |
| `dsk_renderer_status` | `GET /dsk/:apikey/renderer/status` | _(none)_ | Return renderer running state for the API key: `{ running, rtmpUrl? }`. |
| `start_dsk_renderer` | `POST /dsk/:apikey/renderer/start` | _(none)_ | Start Playwright capture loop → ffmpeg → nginx-rtmp. Returns `{ ok, rtmpUrl }`. |
| `stop_dsk_renderer` | `POST /dsk/:apikey/renderer/stop` | _(none)_ | Stop capture loop and ffmpeg. Returns `{ ok }`. |

**Note:** `LCYT_API_KEY` doubles as the `:apikey` path segment in DSK routes — the same key that scopes template storage and renderer state.

---

## MCP Resources

| URI | Description |
|-----|-------------|
| `session://{session_id}` | JSON snapshot: `{ sequence, syncOffset, startedAt }`. |

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

### Dependencies

```
mcp>=1.0
lcyt>=1.1.1
httpx>=0.25          # async HTTP for backend calls (production + graphics tools)
```

### server.py sketch

```python
import asyncio, os, secrets
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
from lcyt import YoutubeLiveCaptionSender

app = Server("lcyt-mcp")
sessions: dict[str, YoutubeLiveCaptionSender] = {}

BACKEND_URL = os.environ.get("LCYT_BACKEND_URL", "").rstrip("/")
API_KEY     = os.environ.get("LCYT_API_KEY", "")
ADMIN_KEY   = os.environ.get("LCYT_ADMIN_KEY", "")


def _admin_headers():
    return {"X-Admin-Key": ADMIN_KEY}


def _editor_headers():
    return {"X-API-Key": API_KEY}


@app.list_tools()
async def list_tools():
    return [
        # ── Caption tools ──────────────────────────────────────────────────────
        types.Tool(name="start",        inputSchema={"type":"object","properties":{"stream_key":{"type":"string"}},"required":["stream_key"]}),
        types.Tool(name="send_caption", inputSchema={"type":"object","properties":{"session_id":{"type":"string"},"text":{"type":"string"},"timestamp":{"type":"string"}},"required":["session_id","text"]}),
        types.Tool(name="send_batch",   inputSchema={"type":"object","properties":{"session_id":{"type":"string"},"captions":{"type":"array"}},"required":["session_id","captions"]}),
        types.Tool(name="sync_clock",   inputSchema={"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}),
        types.Tool(name="get_status",   inputSchema={"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}),
        types.Tool(name="stop",         inputSchema={"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}),
        # ── Production tools ───────────────────────────────────────────────────
        types.Tool(name="list_cameras",   inputSchema={"type":"object","properties":{}}),
        types.Tool(name="camera_preset",  inputSchema={"type":"object","properties":{"camera_id":{"type":"string"},"preset_id":{"type":"string"}},"required":["camera_id","preset_id"]}),
        types.Tool(name="list_mixers",    inputSchema={"type":"object","properties":{}}),
        types.Tool(name="switch_source",  inputSchema={"type":"object","properties":{"mixer_id":{"type":"string"},"input":{"type":"integer","minimum":1}},"required":["mixer_id","input"]}),
        # ── Graphics / DSK tools ───────────────────────────────────────────────
        types.Tool(name="list_dsk_templates",    inputSchema={"type":"object","properties":{}}),
        types.Tool(name="activate_dsk_template", inputSchema={"type":"object","properties":{"template_id":{"type":"integer"}},"required":["template_id"]}),
        types.Tool(name="broadcast_dsk_data",    inputSchema={"type":"object","properties":{"updates":{"type":"array","items":{"type":"object","properties":{"selector":{"type":"string"},"text":{"type":"string"}},"required":["selector","text"]}}},"required":["updates"]}),
        types.Tool(name="dsk_renderer_status",   inputSchema={"type":"object","properties":{}}),
        types.Tool(name="start_dsk_renderer",    inputSchema={"type":"object","properties":{}}),
        types.Tool(name="stop_dsk_renderer",     inputSchema={"type":"object","properties":{}}),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict):
    async with httpx.AsyncClient() as client:
        match name:
            # ── Caption tools ──────────────────────────────────────────────
            case "start":
                sender = YoutubeLiveCaptionSender(stream_key=arguments["stream_key"])
                await sender.start()
                sid = secrets.token_hex(8)
                sessions[sid] = sender
                return [types.TextContent(type="text", text=f'{{"session_id":"{sid}"}}')]
            case "send_caption":
                sender = sessions[arguments["session_id"]]
                await sender.send(arguments["text"], arguments.get("timestamp"))
                return [types.TextContent(type="text", text='{"ok":true}')]
            case "send_batch":
                sender = sessions[arguments["session_id"]]
                await sender.send_batch(arguments["captions"])
                return [types.TextContent(type="text", text='{"ok":true}')]
            case "sync_clock":
                offset = await sessions[arguments["session_id"]].sync()
                return [types.TextContent(type="text", text=f'{{"syncOffset":{offset}}}')]
            case "get_status":
                sender = sessions[arguments["session_id"]]
                return [types.TextContent(type="text", text=f'{{"sequence":{sender.sequence}}}')]
            case "stop":
                sender = sessions.pop(arguments["session_id"])
                await sender.end()
                return [types.TextContent(type="text", text='{"ok":true}')]

            # ── Production tools ───────────────────────────────────────────
            case "list_cameras":
                r = await client.get(f"{BACKEND_URL}/production/cameras", headers=_admin_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "camera_preset":
                cid, pid = arguments["camera_id"], arguments["preset_id"]
                r = await client.post(f"{BACKEND_URL}/production/cameras/{cid}/preset/{pid}", headers=_admin_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "list_mixers":
                r = await client.get(f"{BACKEND_URL}/production/mixers", headers=_admin_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "switch_source":
                mid, inp = arguments["mixer_id"], arguments["input"]
                r = await client.post(f"{BACKEND_URL}/production/mixers/{mid}/switch/{inp}", headers=_admin_headers())
                return [types.TextContent(type="text", text=r.text)]

            # ── Graphics / DSK tools ───────────────────────────────────────
            case "list_dsk_templates":
                r = await client.get(f"{BACKEND_URL}/dsk/{API_KEY}/templates", headers=_editor_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "activate_dsk_template":
                tid = arguments["template_id"]
                r = await client.post(f"{BACKEND_URL}/dsk/{API_KEY}/templates/{tid}/activate", headers=_editor_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "broadcast_dsk_data":
                r = await client.post(
                    f"{BACKEND_URL}/dsk/{API_KEY}/broadcast",
                    headers=_editor_headers(),
                    json={"updates": arguments["updates"]},
                )
                return [types.TextContent(type="text", text=r.text)]
            case "dsk_renderer_status":
                r = await client.get(f"{BACKEND_URL}/dsk/{API_KEY}/renderer/status", headers=_editor_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "start_dsk_renderer":
                r = await client.post(f"{BACKEND_URL}/dsk/{API_KEY}/renderer/start", headers=_editor_headers())
                return [types.TextContent(type="text", text=r.text)]
            case "stop_dsk_renderer":
                r = await client.post(f"{BACKEND_URL}/dsk/{API_KEY}/renderer/stop", headers=_editor_headers())
                return [types.TextContent(type="text", text=r.text)]


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
dependencies = ["mcp>=1.0", "lcyt>=1.1.1", "httpx>=0.25"]

[project.scripts]
lcyt-mcp = "lcyt_mcp.server:main"
```

---

## Node.js MCP Servers

Both `lcyt-mcp-stdio` and `lcyt-mcp-sse` share the same tool handler logic via `createHandlers()` in `packages/lcyt-mcp-stdio/src/server.js`. The new production and graphics tools are added to the `TOOLS` array and the `handleCallTool` switch.

### Package layout

```
packages/lcyt-mcp-stdio/
├── package.json
└── src/
    └── server.js

packages/lcyt-mcp-sse/
├── package.json
└── src/
    └── server.js   (imports createHandlers from lcyt-mcp-stdio)
```

### Dependencies (additional)

No new npm packages needed — `fetch` is built into Node 18+.

### server.js additions sketch

```js
// ── Backend helpers ────────────────────────────────────────────────────────

const BACKEND_URL = (process.env.LCYT_BACKEND_URL ?? "").replace(/\/$/, "");
const API_KEY     = process.env.LCYT_API_KEY  ?? "";
const ADMIN_KEY   = process.env.LCYT_ADMIN_KEY ?? "";

async function backendGet(path, headers) {
  const res = await fetch(`${BACKEND_URL}${path}`, { headers });
  return res.text();
}

async function backendPost(path, headers, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.text();
}

// ── New tools added to the TOOLS array ────────────────────────────────────

// Production tools
{ name: "list_cameras",   description: "List all cameras.", inputSchema: { type: "object", properties: {} } },
{ name: "camera_preset",  description: "Trigger a PTZ preset on a camera.", inputSchema: { type: "object", properties: { camera_id: { type: "string" }, preset_id: { type: "string" } }, required: ["camera_id","preset_id"] } },
{ name: "list_mixers",    description: "List all mixers with connection status.", inputSchema: { type: "object", properties: {} } },
{ name: "switch_source",  description: "Switch mixer live program source.", inputSchema: { type: "object", properties: { mixer_id: { type: "string" }, input: { type: "integer", minimum: 1 } }, required: ["mixer_id","input"] } },

// Graphics / DSK tools
{ name: "list_dsk_templates",    description: "List saved DSK overlay templates.", inputSchema: { type: "object", properties: {} } },
{ name: "activate_dsk_template", description: "Load a DSK template into the renderer.", inputSchema: { type: "object", properties: { template_id: { type: "integer" } }, required: ["template_id"] } },
{ name: "broadcast_dsk_data",    description: "Inject live text into renderer DOM without page reload.", inputSchema: { type: "object", properties: { updates: { type: "array", items: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector","text"] } } }, required: ["updates"] } },
{ name: "dsk_renderer_status",   description: "Get DSK renderer running state.", inputSchema: { type: "object", properties: {} } },
{ name: "start_dsk_renderer",    description: "Start DSK capture loop → ffmpeg → RTMP.", inputSchema: { type: "object", properties: {} } },
{ name: "stop_dsk_renderer",     description: "Stop DSK capture loop and ffmpeg.", inputSchema: { type: "object", properties: {} } },

// ── New cases added to handleCallTool ──────────────────────────────────────

case "list_cameras":
  return { content: [{ type: "text", text: await backendGet("/production/cameras", { "X-Admin-Key": ADMIN_KEY }) }] };
case "camera_preset":
  return { content: [{ type: "text", text: await backendPost(`/production/cameras/${args.camera_id}/preset/${args.preset_id}`, { "X-Admin-Key": ADMIN_KEY }) }] };
case "list_mixers":
  return { content: [{ type: "text", text: await backendGet("/production/mixers", { "X-Admin-Key": ADMIN_KEY }) }] };
case "switch_source":
  return { content: [{ type: "text", text: await backendPost(`/production/mixers/${args.mixer_id}/switch/${args.input}`, { "X-Admin-Key": ADMIN_KEY }) }] };

case "list_dsk_templates":
  return { content: [{ type: "text", text: await backendGet(`/dsk/${API_KEY}/templates`, { "X-API-Key": API_KEY }) }] };
case "activate_dsk_template":
  return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/templates/${args.template_id}/activate`, { "X-API-Key": API_KEY }) }] };
case "broadcast_dsk_data":
  return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/broadcast`, { "X-API-Key": API_KEY }, { updates: args.updates }) }] };
case "dsk_renderer_status":
  return { content: [{ type: "text", text: await backendGet(`/dsk/${API_KEY}/renderer/status`, { "X-API-Key": API_KEY }) }] };
case "start_dsk_renderer":
  return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/renderer/start`, { "X-API-Key": API_KEY }) }] };
case "stop_dsk_renderer":
  return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/renderer/stop`, { "X-API-Key": API_KEY }) }] };
```

---

## Claude Desktop Config

### Caption tools only (no backend)

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "lcyt-mcp"
    }
  }
}
```

### With production + graphics tools

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "lcyt-mcp",
      "env": {
        "LCYT_BACKEND_URL": "https://api.lcyt.fi",
        "LCYT_API_KEY":     "your-api-key-here",
        "LCYT_ADMIN_KEY":   "your-admin-key-here"
      }
    }
  }
}
```

Production and graphics tools are silently skipped (return an error message) when `LCYT_BACKEND_URL` is not set, so the caption tools still work standalone without a backend.

---

## Tool availability guards

When `LCYT_BACKEND_URL` is empty:
- Production and graphics tools are still listed (so the AI knows they exist)
- Calling them returns `{ "error": "LCYT_BACKEND_URL is not configured" }` instead of crashing

---

## Implementation Steps

1. **Python**: Update `python-packages/lcyt-mcp/lcyt_mcp/server.py` — add `httpx` dependency, add 10 new tool definitions, add 10 new `case` branches.
2. **Node.js stdio**: Update `packages/lcyt-mcp-stdio/src/server.js` — add backend helpers, add tools to `TOOLS` array, add cases to `handleCallTool`.
3. **Node.js SSE**: `packages/lcyt-mcp-sse/src/server.js` imports `createHandlers` from `lcyt-mcp-stdio`, so no changes needed there unless it pins the TOOLS export separately.
4. **Tests**:
   - Node.js: extend `packages/lcyt-mcp-stdio/test/server.test.js` — mock `fetch` globally; test each new tool against a mock backend.
   - Python: extend `python-packages/lcyt-mcp/tests/test_server.py` — mock `httpx.AsyncClient`; test each new tool.

---

## Files to change

```
python-packages/lcyt-mcp/
  lcyt_mcp/server.py          ← add 10 tools + httpx calls
  pyproject.toml              ← add httpx>=0.25 dependency

packages/lcyt-mcp-stdio/
  src/server.js               ← add backend helpers + 10 tools
  test/server.test.js         ← extend with production + graphics tool tests

packages/lcyt-mcp-sse/
  src/server.js               ← verify it re-exports createHandlers correctly
                                (no changes needed if it imports from lcyt-mcp-stdio)
```
