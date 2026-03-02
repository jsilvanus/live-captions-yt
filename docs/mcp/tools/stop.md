---
title: "stop — Stop Caption Session"
stdio: true
sse: true
---

# `stop` — Stop Caption Session

End a caption session and release its resources.

**Available in:** stdio, SSE

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID to stop |

## Returns

```json
{
  "ok": true
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` on success |
