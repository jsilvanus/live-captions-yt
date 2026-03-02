# MCP SSE Transport

`lcyt-mcp-sse` is an MCP server that communicates over **HTTP with Server-Sent Events**. It is suitable for web-based MCP clients, remote AI agents, and scenarios where multiple clients share caption sessions.

**Package:** `packages/lcyt-mcp-sse`

---

## How It Works

The server listens for HTTP connections on a configurable port (default `3001`).

- `GET /sse` — client opens an SSE stream; the server assigns a `sessionId` for the connection
- `POST /messages?sessionId=<id>` — client sends MCP messages to the server

Caption sessions are held in a **shared in-memory pool** accessible to all SSE connections. A caption session (identified by `session_id` returned from the `start` tool) survives HTTP reconnects as long as the server process is running.

---

## Running the Server

```bash
node packages/lcyt-mcp-sse/src/server.js
```

With options:

```bash
PORT=3001 LCYT_LOG_STDERR=1 node packages/lcyt-mcp-sse/src/server.js
```

With optional database logging:

```bash
PORT=3001 DB_PATH=./lcyt.db LCYT_LOG_STDERR=1 node packages/lcyt-mcp-sse/src/server.js
```

---

## HTTP Endpoints

### `GET /sse`

Open an SSE stream. The server returns MCP protocol messages as SSE events.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | No | API key for usage logging (requires `DB_PATH` to be configured) |

**Response headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

The first SSE event contains the `sessionId` needed for `POST /messages`:
```
event: endpoint
data: /messages?sessionId=abc123
```

---

### `POST /messages`

Send an MCP JSON-RPC message to the server.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | SSE connection session ID (from the `endpoint` SSE event) |

**Body:** MCP JSON-RPC message

**Response:** `202 Accepted` or error

The server processes the message and sends the response on the SSE stream.

---

## Available Tools

| Tool | Description |
|---|---|
| [`start`](./tools.md#start--start-caption-session) | Create a new caption session |
| [`send_caption`](./tools.md#send_caption--send-a-single-caption) | Send a single caption |
| [`send_batch`](./tools.md#send_batch--send-multiple-captions) | Send multiple captions at once |
| [`sync_clock`](./tools.md#sync_clock--synchronise-clock) | Synchronise clock with YouTube |
| [`get_status`](./tools.md#get_status--session-status) | Query session state |
| [`stop`](./tools.md#stop--stop-caption-session) | End a session |
| [`privacy`](./tools.md#privacy--privacy-notice) | Return privacy notice |
| [`privacy_deletion`](./tools.md#privacy_deletion--request-data-deletion) | Request GDPR data erasure |

See the [Tools Reference](./tools.md) for full parameter and return value documentation.

---

## Authentication & API Keys

Authentication is optional by default. When `DB_PATH` is configured, passing an `apiKey` query parameter to `GET /sse` enables usage logging and limits enforcement.

**Enforce authentication:**

Set `MCP_REQUIRE_API_KEY=1` to reject connections that do not supply a valid API key:

```bash
MCP_REQUIRE_API_KEY=1 DB_PATH=./lcyt.db node packages/lcyt-mcp-sse/src/server.js
```

When `MCP_REQUIRE_API_KEY=1` is set and no valid API key is provided, `GET /sse` returns `401 Unauthorized`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `DB_PATH` | none | Path to SQLite database. Enables usage logging and API key validation when set. |
| `MCP_REQUIRE_API_KEY` | unset | Set to `1` to require a valid API key on all SSE connections |
| `LCYT_LOG_STDERR` | unset | Set to `1` to route lcyt logs to stderr (recommended) |

---

## Architecture

```
MCP Client A ──GET /sse──────────────────┐
MCP Client B ──GET /sse──────────────────┤
                                         ▼
                              lcyt-mcp-sse (HTTP server)
                                         │
                              Shared caption session pool
                              (in-memory Map<session_id, Sender>)
                                         │
                              YoutubeLiveCaptionSender instances
                                         │
                                         ▼
                              YouTube Live Ingestion API

MCP Client A ──POST /messages?sessionId=a──► SSE server processes, responds via SSE
MCP Client B ──POST /messages?sessionId=b──► SSE server processes, responds via SSE
```

- Multiple SSE clients can co-exist in the same server process
- Caption sessions (`session_id`) are independent of SSE connections (`sessionId`)
- A caption session started by Client A can be used by Client B if they share the `session_id`

---

## Example: Connecting with curl

```bash
# 1. Open SSE stream (in a separate terminal)
curl -N http://localhost:3001/sse
# → event: endpoint
# → data: /messages?sessionId=abc123

# 2. Start a caption session
curl -X POST 'http://localhost:3001/messages?sessionId=abc123' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"start","arguments":{"stream_key":"xxxx-xxxx-xxxx-xxxx"}}}'

# 3. Send a caption
curl -X POST 'http://localhost:3001/messages?sessionId=abc123' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"send_caption","arguments":{"session_id":"<session_id>","text":"Hello!"}}}'
```

---

## Troubleshooting

**`401 Unauthorized` on `GET /sse`**
- `MCP_REQUIRE_API_KEY=1` is set but no `?apiKey=` was supplied
- Provide a valid API key: `GET /sse?apiKey=your-key`

**Messages not received on SSE stream**
- Ensure the `sessionId` in `POST /messages?sessionId=...` matches the value from the `endpoint` SSE event
- The SSE connection may have been closed; reconnect and use the new `sessionId`

**Session not found errors**
- Caption sessions (`session_id`) are in-memory; they are lost if the server restarts
- Call the `start` tool again to create a new session
