---
title: "MCP Tools Reference"
---

# MCP Tools Reference

`lcyt` exposes MCP tools across two server transports. Most tools are available on both; a few are exclusive to one transport.

## Tool Availability

| Tool | stdio | SSE | Reference |
|---|:---:|:---:|---|
| `start` | ✅ | ✅ | [start.md](./tools/start.md) |
| `send_caption` | ✅ | ✅ | [send-caption.md](./tools/send-caption.md) |
| `send_batch` | ✅ | ✅ | [send-batch.md](./tools/send-batch.md) |
| `sync_clock` | ✅ | ✅ | [sync-clock.md](./tools/sync-clock.md) |
| `get_status` | ✅ | ✅ | [get-status.md](./tools/get-status.md) |
| `stop` | ✅ | ✅ | [stop.md](./tools/stop.md) |
| `privacy` | ❌ | ✅ | [privacy.md](./tools/privacy.md) |
| `privacy_deletion` | ❌ | ✅ | [privacy-deletion.md](./tools/privacy-deletion.md) |

See also: [Session Resources (stdio only)](./tools/session-resources.md)

---

## Typical AI Workflow

```
1. start(stream_key)           → session_id
2. sync_clock(session_id)      → syncOffset (optional but recommended)
3. send_caption(session_id, text)           (repeat as needed)
   or send_batch(session_id, captions)
4. get_status(session_id)      → current sequence / offset
5. stop(session_id)            → session closed
```

