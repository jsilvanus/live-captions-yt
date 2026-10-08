---
id: mcp/tools
title: "MCP Tools Reference"
---

# MCP Tools Reference

`lcyt` exposes MCP tools across two server transports. Most tools are available on both; a few are exclusive to one transport.

## Tool Availability

| Tool | stdio | SSE | Reference |
|---|:---:|:---:|---|
| `start` | âœ… | âœ… | [start.md](#tools-start) |
| `send_caption` | âœ… | âœ… | [send-caption.md](#tools-send-caption) |
| `send_batch` | âœ… | âœ… | [send-batch.md](#tools-send-batch) |
| `sync_clock` | âœ… | âœ… | [sync-clock.md](#tools-sync-clock) |
| `get_status` | âœ… | âœ… | [get-status.md](#tools-get-status) |
| `stop` | âœ… | âœ… | [stop.md](#tools-stop) |
| `privacy` | âŒ | âœ… | [privacy.md](#tools-privacy) |
| `privacy_deletion` | âŒ | âœ… | [privacy-deletion.md](#tools-privacy-deletion) |

See also: [Session Resources (stdio only)](#tools-session-resources)

---

## Typical AI Workflow

```
1. start(stream_key)           â†’ session_id
2. sync_clock(session_id)      â†’ syncOffset (optional but recommended)
3. send_caption(session_id, text)           (repeat as needed)
   or send_batch(session_id, captions)
4. get_status(session_id)      â†’ current sequence / offset
5. stop(session_id)            â†’ session closed
```


