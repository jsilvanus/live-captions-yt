---
id: plan/mcp
title: "MCP Tools for lcyt"
status: implemented
summary: "Model Context Protocol servers for stdio and Streamable HTTP transports exposing caption, production, and DSK graphics tools to AI assistants."
---

## Current implementation

MCP support is implemented in the repository and is no longer a planned feature. The current surface area is:

- `python-packages/lcyt-mcp/` — Python server
- `packages/lcyt-mcp-stdio/` — Node.js stdio server
- `packages/lcyt-mcp-http/` — Node.js Streamable HTTP server

### Tool groups

1. Caption tools — start, send, sync, and stop caption sessions directly with `YoutubeLiveCaptionSender`.
2. Production tools — list cameras and mixers, trigger presets, and switch sources through the backend.
3. Graphics/DSK tools — manage templates and renderer state through the backend.

## Transport and authentication

- Stdio transports are intended for local AI clients.
- Streamable HTTP is intended for remote integrations.
- Production and graphics tools use the backend URL plus the existing admin/API key headers:
  - `X-Admin-Key` for production tools
  - `X-API-Key` for DSK tools

## Primary integration points

- `python-packages/lcyt-mcp/`
- `packages/lcyt-mcp-stdio/`
- `packages/lcyt-mcp-http/`
- `packages/lcyt-backend/` for the routes used by the non-caption tools
