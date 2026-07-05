# MCP support in LCYT

MCP support is now implemented in the repository. The current implementation is split across three packages:

- `python-packages/lcyt-mcp/` — Python MCP server for stdio transport.
- `packages/lcyt-mcp-stdio/` — Node.js MCP server for stdio transport.
- `packages/lcyt-mcp-http/` — Node.js MCP server for Streamable HTTP transport.

These servers expose tools for:

- caption delivery to YouTube Live
- production control (cameras and mixers) against the backend
- DSK graphics/template control against the backend

## Current layout

- Caption tools work standalone with `YoutubeLiveCaptionSender`.
- Production and graphics tools call the backend over HTTP and use the same admin/API key headers used elsewhere in the repo.
- The stdio servers are intended for local assistants, while the HTTP server is intended for remote or hosted integrations.

## Where to look

- `python-packages/lcyt-mcp/`
- `packages/lcyt-mcp-stdio/`
- `packages/lcyt-mcp-http/`
- `packages/lcyt-backend/` for the backend endpoints that the non-caption tools call
