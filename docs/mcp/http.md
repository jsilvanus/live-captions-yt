---
id: mcp/http
---

# MCP Streamable HTTP Transport

`lcyt-mcp-http` is an MCP server that communicates over the **MCP Streamable HTTP** transport. It is suitable for web-based MCP clients, remote AI agents, and scenarios where multiple clients share caption sessions.

**Package:** `packages/lcyt-mcp-http`

---

## How It Works

The server listens for HTTP connections on a configurable port (default `3001`), exposing a single `/mcp` endpoint that supports three HTTP methods:

- `POST /mcp` — send an MCP JSON-RPC message. An `initialize` request with no `Mcp-Session-Id` header opens a new session; the server returns the new session id in the `Mcp-Session-Id` response header.
- `GET /mcp` — open the server-initiated SSE stream for an existing session (`Mcp-Session-Id` header required).
- `DELETE /mcp` — terminate a session (`Mcp-Session-Id` header required).

Caption sessions are held in a **shared in-memory pool** accessible to all HTTP connections. A caption session (identified by `session_id` returned from the `start` tool) survives HTTP reconnects as long as the server process is running, and is independent of the MCP transport session (`Mcp-Session-Id`).

---

## Running the Server

```bash
node packages/lcyt-mcp-http/src/server.js
```

With options:

```bash
PORT=3001 LCYT_LOG_STDERR=1 node packages/lcyt-mcp-http/src/server.js
```

With optional database logging:

```bash
PORT=3001 DB_PATH=./lcyt.db LCYT_LOG_STDERR=1 node packages/lcyt-mcp-http/src/server.js
```

---

## HTTP Endpoints

### `POST /mcp`

Send an MCP JSON-RPC message to the server.

**Request headers**

| Header | Type | Required | Description |
|---|---|---|---|
| `Mcp-Session-Id` | `string` | No (required after the initial `initialize` call) | Identifies an existing MCP transport session |
| `X-Api-Key` | `string` | No | API key for usage logging (requires `DB_PATH` to be configured). Required when `MCP_REQUIRE_API_KEY=1` |

**Body:** MCP JSON-RPC message. The first message on a new connection must be an `initialize` request (no `Mcp-Session-Id` header) — the server creates a new transport and session, returning the assigned id in the `Mcp-Session-Id` response header.

**Response:** JSON-RPC result, or `400 Bad Request` if no session id is provided and the request is not an `initialize` request.

---

### `GET /mcp`

Open the server-initiated SSE stream for an existing session.

**Request headers**

| Header | Type | Required | Description |
|---|---|---|---|
| `Mcp-Session-Id` | `string` | Yes | Session id obtained from the `initialize` response |

**Response:** `400 Bad Request` if the session id is missing or unknown; otherwise opens a `text/event-stream` connection.

---

### `DELETE /mcp`

Terminate a session.

**Request headers**

| Header | Type | Required | Description |
|---|---|---|---|
| `Mcp-Session-Id` | `string` | Yes | Session id to terminate |

**Response:** `400 Bad Request` if the session id is missing or unknown; otherwise the session and its transport are closed.

---

## Available Tools

| Tool | Description |
|---|---|
| [`start`](#tools-start) | Create a new caption session |
| [`send_caption`](#tools-send-caption) | Send a single caption |
| [`send_batch`](#tools-send-batch) | Send multiple captions at once |
| [`sync_clock`](#tools-sync-clock) | Synchronise clock with YouTube |
| [`get_status`](#tools-get-status) | Query session state |
| [`stop`](#tools-stop) | End a session |
| [`privacy`](#tools-privacy) | Return privacy notice |
| [`privacy_deletion`](#tools-privacy-deletion) | Request GDPR data erasure |

See the [Tools Reference](#tools) for full parameter and return value documentation.

---

## Authentication & API Keys

Authentication is optional by default. When `DB_PATH` is configured, sending an `X-Api-Key` request header on the `initialize` call enables usage logging and limits enforcement.

**Enforce authentication:**

Set `MCP_REQUIRE_API_KEY=1` to reject connections that do not supply a valid API key:

```bash
MCP_REQUIRE_API_KEY=1 DB_PATH=./lcyt.db node packages/lcyt-mcp-http/src/server.js
```

When `MCP_REQUIRE_API_KEY=1` is set and no valid API key is provided, the `initialize` request returns `401 Unauthorized`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `DB_PATH` | none | Path to SQLite database. Enables usage logging and API key validation when set. |
| `MCP_REQUIRE_API_KEY` | unset | Set to `1` to require a valid API key on session initialization |
| `LCYT_LOG_STDERR` | unset | Set to `1` to route lcyt logs to stderr (recommended) |

---

## Architecture

```
MCP Client A ──POST /mcp (initialize)────┐
MCP Client B ──POST /mcp (initialize)────┤
                                         ▼
                              lcyt-mcp-http (HTTP server)
                                         │
                              Shared caption session pool
                              (in-memory Map<session_id, Sender>)
                                         │
                              YoutubeLiveCaptionSender instances
                                         │
                                         ▼
                              YouTube Live Ingestion API

MCP Client A ──POST /mcp (Mcp-Session-Id: a)──► server processes, returns JSON-RPC response
MCP Client B ──POST /mcp (Mcp-Session-Id: b)──► server processes, returns JSON-RPC response
MCP Client A ──GET  /mcp (Mcp-Session-Id: a)──► server-initiated SSE notifications
```

- Multiple HTTP clients can co-exist in the same server process
- Caption sessions (`session_id`) are independent of MCP transport sessions (`Mcp-Session-Id`)
- A caption session started by Client A can be used by Client B if they share the `session_id`

---

## Example: Connecting with curl

```bash
# 1. Initialize a new MCP session
curl -i -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
# → look for the Mcp-Session-Id response header, e.g. Mcp-Session-Id: abc123

# 2. Start a caption session
curl -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Mcp-Session-Id: abc123' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"start","arguments":{"stream_key":"xxxx-xxxx-xxxx-xxxx"}}}'

# 3. Send a caption
curl -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Mcp-Session-Id: abc123' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send_caption","arguments":{"session_id":"<session_id>","text":"Hello!"}}}'
```

---

## Troubleshooting

**`401 Unauthorized` on `POST /mcp` (initialize)**
- `MCP_REQUIRE_API_KEY=1` is set but no `X-Api-Key` header was supplied
- Add the header to your request: `X-Api-Key: your-key`

**`400 Bad Request: No valid session ID provided`**
- The request did not include a `Mcp-Session-Id` header and was not a valid `initialize` request
- Ensure the first request on a new connection is `initialize`, then reuse the `Mcp-Session-Id` returned in the response header for all subsequent requests

**Session not found errors**
- Caption sessions (`session_id`) are in-memory; they are lost if the server restarts
- Call the `start` tool again to create a new session

---

## Deployment & security notes

- **Bind to loopback for safety**: the HTTP server is network-accessible by default. For single-host deployments prefer binding to loopback (e.g. `127.0.0.1:3001`) and expose it only via a secure reverse proxy (nginx) if external access is required.

- **Reverse-proxy recommended**: if you must expose the MCP HTTP server to the public internet, put an authenticated TLS-terminating reverse proxy in front of it and restrict access with firewall rules.

- **Stable `JWT_SECRET`**: when using persistent sessions or token persistence, set a stable `JWT_SECRET` in your environment (don't rely on autogenerated secrets) so issued tokens remain valid across restarts.

- **DB volume ownership**: if you enable `DB_PATH` and use a Docker volume for persistence, ensure the container runtime user can write the SQLite file. If you see `SqliteError: attempt to write a readonly database`, chown the volume to the runtime UID (e.g., `1000:1000`) before starting the container.

- **Reconnection behaviour**: sessions stored in SQLite are rehydrated on server start without an active sender. Clients should re-register (POST `/live` or call the `start` tool) to obtain a fresh token and re-open the MCP session after a backend restart.

## Persistence (DB-backed sessions)

When `DB_PATH` is set to a writable SQLite path, `lcyt-mcp-http` will persist session metadata to the `sessions` table and will automatically rehydrate those sessions on server start. Key points:

- **How to enable**: set `DB_PATH` to the desired SQLite file (or volume) and restart the server. Example:

```bash
DB_PATH=./lcyt.db node packages/lcyt-mcp-http/src/server.js
```

- **Behaviour**: persisted sessions are loaded on startup and `YoutubeLiveCaptionSender` instances are started for each rehydrated session so their `session_id`s remain usable without manual `start` calls.

- **Lifecycle**: calling the `stop` tool will end the session and remove the persisted row. The `privacy_deletion` tool will also erase session records for the authenticated API key.

- **Operational notes**:
  - Rehydration starts sender instances at boot — this uses network and CPU resources proportional to the number of persisted sessions. If you prefer a lazy approach (restore metadata but start senders only when a client attaches), request the lazy option and we can update the server to support it.
  - Ensure the SQLite file is writable by the runtime user (see README chown example) to avoid `readonly` errors.

- **Security**: persist only on trusted hosts; stream keys are persisted in the `sessions` table and should be protected accordingly.
