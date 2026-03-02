---
title: "Session Resources"
stdio: true
sse: false
---

# Session Resources

The stdio server exposes MCP **resources** (in addition to tools) that clients can read directly.

**Available in:** stdio only

---

## `session://<session_id>`

Read the current state of a session as a JSON resource.

**URI pattern:** `session://<session_id>`

**Returns**

```json
{
  "sequence": 9,
  "syncOffset": 150,
  "startedAt": "2024-01-01T12:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `sequence` | `number` | Current sequence counter |
| `syncOffset` | `number` | Current clock sync offset in milliseconds |
| `startedAt` | `string` | ISO timestamp when the session was created |
