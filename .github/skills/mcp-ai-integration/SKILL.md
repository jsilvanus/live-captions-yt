---
name: mcp-ai-integration
summary: |
  MCP / AI Integration skill: Model Context Protocol tooling, safe tool invocation,
  assistant-to-system integration patterns and testing harness.
---

## Purpose
Guidance for building and testing MCP servers (`lcyt-mcp-stdio`, `lcyt-mcp-sse`),
ensuring safe tool invocation and predictable behavior.

## When to use
- Adding MCP tools, designing tool manifests, or testing stdio/SSE transports.

## Checklist
- Keep tools idempotent and side-effect-limited; validate inputs strictly.
- For stdio transport, avoid writing to stdout except for MCP protocol messages.
- Test end-to-end with a simulated MCP client that opens SSE or stdio streams.
- Log to stderr for debugging in MCP contexts (set `LCYT_LOG_STDERR=1`).

## Commands
- Run MCP SSE server locally and test with a small SSE client script.

## Outputs
- Tool descriptors, safe-invocation wrappers, E2E test harness templates.
