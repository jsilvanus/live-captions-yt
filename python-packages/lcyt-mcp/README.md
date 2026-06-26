# lcyt-mcp — Python MCP Server

Python implementation of the Model Context Protocol (MCP) server for LCYT. Allows AI assistants (Claude, etc.) to send captions and control production systems via MCP.

**Version:** 0.1.0 (alpha)  
**License:** MIT  
**Python:** 3.10+

## Overview

lcyt-mcp provides:
- **MCP server** — Stdio transport (can be extended to HTTP SSE)
- **Caption sending** — `send_caption`, `send_batch` tools
- **Clock sync** — `sync_clock` for NTP-style synchronization
- **Status queries** — `get_status`, `privacy` endpoints
- **Session lifecycle** — `start`, `stop` tools

## Installation

```bash
pip install lcyt-mcp
```

Or from the monorepo:

```bash
cd python-packages/lcyt-mcp
pip install -e .
```

## Quick Start

### Stdio Server

```bash
python -m lcyt_mcp.server
```

Then configure your AI assistant to use this as an MCP tool:

```json
{
  "mcp": {
    "lcyt": {
      "command": "python",
      "args": ["-m", "lcyt_mcp.server"],
      "env": {
        "BACKEND_URL": "https://api.lcyt.fi",
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

### In your AI code

```python
# The MCP server handles tool invocation
# AI calls tools like send_caption, start, sync_clock, etc.
```

## Tools Exposed

### start

Initialize a new caption session:

```
Arguments:
  stream_key: YouTube Live stream key
  backend_url: Backend base URL (optional, uses env var)
  region: Region/cue identifier (optional)

Returns:
  session_id: Session identifier
  status: Connection status
```

### send_caption

Send a single caption:

```
Arguments:
  text: Caption text
  timestamp: ISO timestamp (optional)

Returns:
  ok: Success boolean
  sequence: Sequence number assigned
  request_id: Unique request ID
```

### send_batch

Send multiple captions:

```
Arguments:
  captions: List of { text, timestamp }

Returns:
  ok: Success boolean
  count: Captions sent
  request_ids: List of request IDs
```

### sync_clock

Synchronize server clock (NTP-style):

```
Arguments:
  client_time: Client timestamp (optional)

Returns:
  server_time: Server timestamp
  offset: Clock offset (milliseconds)
```

### get_status

Query session status:

```
Arguments:
  session_id: Optional session ID (uses current if not provided)

Returns:
  connected: Connection state
  sequence: Current sequence number
  captions_sent: Count of captions sent
  last_event: Last event timestamp
```

### privacy

GDPR privacy status:

```
Returns:
  data_stored: Types of data stored
  retention: Retention policy
  contact: Contact for privacy inquiries
```

### privacy_deletion

Request data deletion:

```
Arguments:
  reason: Reason for deletion (optional)

Returns:
  ok: Success boolean
  confirmation_id: Deletion request confirmation
```

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `BACKEND_URL` | LCYT backend base URL |
| `API_KEY` | API key for authentication |
| `LOG_LEVEL` | Logging level: `debug`, `info`, `warn`, `error` |
| `LCYT_LOG_STDERR` | Route logs to stderr (MCP-friendly) |

### Per-Tool Configuration

Some tools accept configuration via tool arguments:

- `start`: Can override `backend_url` per-invocation
- `sync_clock`: Client can provide custom timestamp
- `privacy_deletion`: Can specify deletion reason

## Session Lifecycle

```
1. AI calls start() → Session initialized
2. AI calls send_caption(...) → Caption queued and sent
3. AI calls sync_clock() → Clock synchronized
4. AI queries get_status() → Session info
5. AI calls stop() → Session closed
```

Each step is independent; the server maintains state across invocations.

## Error Handling

Tool invocations return structured errors:

```python
{
  "ok": False,
  "error": "Authentication failed",
  "error_code": "AUTH_ERROR",
  "details": "Invalid API key"
}
```

**Common error codes:**
- `AUTH_ERROR` — Invalid credentials
- `NETWORK_ERROR` — Backend unreachable
- `VALIDATION_ERROR` — Invalid input (bad timestamp, etc.)
- `RATE_LIMIT` — Too many requests
- `UNKNOWN_ERROR` — Unexpected error

## Logging

All activity is logged to stderr (when `LCYT_LOG_STDERR=1`):

```
2026-06-26 12:00:00 INFO    [lcyt-mcp] Session started: sess_abc123
2026-06-26 12:00:05 DEBUG   [lcyt-mcp] Sending caption (seq=1): Hello, world!
2026-06-26 12:00:06 INFO    [lcyt-mcp] Caption delivery confirmed (req=req_xyz)
```

## Database & Persistence

The MCP server itself is stateless. All state (sessions, captions) lives on the backend:

- Session JWT stored in memory during invocation
- Backend maintains session records in SQLite
- Caption history available via backend API

## Testing

```bash
cd python-packages/lcyt-mcp
pytest
```

Tests cover:
- Tool invocation and response formatting
- Error handling and recovery
- MCP protocol compliance
- Integration with backend mock

## Compatibility

**MCP Version:** 1.0+  
**Transport:** Stdio (can be extended to SSE, HTTP)  
**Python:** 3.10, 3.11, 3.12+

## Comparison with Node.js Version

| Feature | Python | Node.js |
|---------|--------|---------|
| MCP server | ✓ Stdio | ✓ Stdio + SSE |
| Caption sending | ✓ | ✓ |
| Session management | ✓ | ✓ |
| Clock sync | ✓ | ✓ |
| Status queries | ✓ | ✓ |
| Privacy tools | ✓ | ✓ |

Both versions expose the same tools with identical semantics.

## See Also

- [Node.js MCP server](../../packages/lcyt-mcp-stdio/README.md)
- [MCP documentation](../../docs/mcp/)
- [Python library documentation](../lcyt/README.md)
- [Python backend documentation](../lcyt-backend/README.md)
- [MCP implementation plan](../../docs/plans/plan_mcp.md)

## Contributing

Python changes should maintain parity with Node.js version. When adding tools:

1. Implement in Python (`lcyt_mcp/tools/`)
2. Add tests (`tests/test_*.py`)
3. Document tool signature
4. Keep Node.js version in sync
