---
title: "get_status — Session Status"
stdio: true
sse: true
---

# `get_status` — Session Status

Retrieve the current state of a caption session.

**Available in:** stdio, SSE

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |

## Returns

```json
{
---
id: mcp/tools/get-status
---
  "sequence": 9,
  "syncOffset": 150
}
```

| Field | Type | Description |
|---|---|---|
| `syncOffset` | `number` | Current clock sync offset |
