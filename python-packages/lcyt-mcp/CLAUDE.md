# `python-packages/lcyt-mcp` — Python MCP Server (v0.1.0, alpha)

Python MCP server with the same tool interface as the Node.js version.

- `lcyt_mcp/server.py` — entry point
- Entry point script: `lcyt_mcp = "lcyt_mcp.server:main"`

## Test Coverage

**Test files:** `tests/test_server.py` (~15 tests).

**Gaps (Low):** Error handling for malformed requests, concurrent session limits.

---

See `packages/lcyt-mcp-stdio/CLAUDE.md` and `packages/lcyt-mcp-http/CLAUDE.md` for the Node.js equivalents this mirrors.
