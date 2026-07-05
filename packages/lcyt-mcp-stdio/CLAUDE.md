# `packages/lcyt-mcp-stdio` — MCP Server, stdio transport (v0.1.0)

Model Context Protocol server enabling AI assistants (e.g. Claude) to send live captions via stdio.

**Entry:** `src/server.js`
**Transport:** stdio (no HTTP port)
**Tools exposed:** `start`, `send_caption`, `send_batch`, `sync_clock`, `status`

**Run:** `node packages/lcyt-mcp-stdio/src/server.js`

## Test Coverage

**Test files:** `test/server.test.js` (~15 tests) — tool invocation, session lifecycle, send/batch/sync/status.

**Gaps (Low):** Invalid input handling, tool descriptor validation, special-character captions.
