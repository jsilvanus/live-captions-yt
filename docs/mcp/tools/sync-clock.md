---
title: "sync_clock — Synchronise Clock"
stdio: true
sse: true
---

# `sync_clock` — Synchronise Clock

Perform an NTP-style clock sync for the session. This compensates for clock drift between the MCP server and YouTube, improving timestamp accuracy.

Call this once after `start` and periodically during long sessions.

**Available in:** stdio, SSE

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |

## Returns

```json
{
  "syncOffset": 150
}
```

| Field | Type | Description |
|---|---|---|
| `syncOffset` | `number` | Clock offset in milliseconds. Positive means YouTube's clock is ahead. |
