# `packages/lcyt-mcp-http` — MCP Server, Streamable HTTP transport (v0.1.0)

Same tools as `lcyt-mcp-stdio` plus `privacy`/`privacy_deletion`, exposed over the MCP Streamable HTTP transport for remote AI client connections.

**Entry:** `src/server.js`
**Transport:** MCP Streamable HTTP — single `/mcp` endpoint supporting `POST` (JSON-RPC messages), `GET` (server-initiated SSE stream), and `DELETE` (session termination), identified by the `Mcp-Session-Id` header.
**Port:** `process.env.PORT` (default 3001)
**Tools exposed:** `start`, `send_caption`, `send_batch`, `sync_clock`, `get_status`, `stop`, `privacy`, `privacy_deletion`

**Auth (`authenticate()`):** the `X-Api-Key` header accepts either a raw `api_keys.key` or a personal `mcp_tokens`-issued token (`lcytmcp_...`, `plan/mcp`) — `verifyMcpToken()` (from `lcyt-backend/db`) is tried first by hash; if it resolves, the underlying `api_key` is validated and used, and the log line names the token's label instead of the raw key prefix. Either credential resolves to the same per-connection `apiKey` closure every tool handler already scopes off of.

**Not wired here:** `packages/lcyt-tools`' shared tool-schema registry (`caption_target.*`/`camera.*`/`mixer.*`/`dsk_template.*`/`asset.*`, `plan/mcp`) is *not* registered on this server — this process has no in-process access to the live `DeviceRegistry`/`BridgeManager`/`AgentEngine` instances those tools need (unlike this server's existing production/graphics tools, which proxy over HTTP with a static global `X-Admin-Key`/`X-API-Key`). See root `CONSIDER.md` for the open question on where that wiring should live.

**Run:** `node packages/lcyt-mcp-http/src/server.js`

## Test Coverage

**Test files:** `test/speech.test.js` (20 tests), `test/server.test.js` (6 tests, added 2026-03-17).

**Added 2026-03-17:**
- `test/server.test.js` (6 tests) — HTTP route logic: `POST /mcp` returns 400 for unknown/missing `Mcp-Session-Id` on non-initialize requests, delegates to the transport for known sessions; `GET /mcp` returns 200 with `text/event-stream` when auth not required, 401 when `REQUIRE_API_KEY` is set; transport session isolation.

**Gaps (Low):**
- Full MCP tool-call flow (start → send_caption → stop) via Streamable HTTP requires a real MCP client harness and is better covered by E2E tests.
- `authenticate()`'s `mcp_tokens` branch (accepting a `lcytmcp_...` token alongside a raw `api_keys.key`) has no dedicated test in this package — `verifyMcpToken()` itself is covered in `lcyt-backend/test/mcp-tokens.test.js`, but this server's `authenticate()` wiring around it isn't exercised here.
