---
title: "send_caption — Send a Single Caption"
stdio: true
sse: true
---

# `send_caption` — Send a Single Caption

Send one caption to YouTube for an active session.

**Available in:** stdio, SSE

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |
| `text` | `string` | Yes | Caption text to deliver |
| `timestamp` | `string` | No | ISO timestamp (`YYYY-MM-DDTHH:MM:SS.mmm`). Defaults to current time. |

## Returns

```json
{
  "ok": true,
  "sequence": 7
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` on success |
| `sequence` | `number` | Sequence number used for this caption |

**Throws** if the session is not found or YouTube returns an error.
