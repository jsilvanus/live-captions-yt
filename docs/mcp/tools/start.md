---
title: "start — Start Caption Session"
stdio: true
sse: true
---

# `start` — Start Caption Session

Create a new `YoutubeLiveCaptionSender` session identified by a unique `session_id`. The session is held in memory on the server.

**Available in:** stdio, SSE

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `stream_key` | `string` | Yes | YouTube Live stream key |

## Returns

```json
{
  "session_id": "a1b2c3d4e5f6g7h8"
}
```

| Field | Type | Description |
|---|---|---|
| `session_id` | `string` | 16-character hex identifier for this session. Pass this to all other tools. |

**Example prompt:** _"Start a caption session with stream key xxxx-xxxx-xxxx-xxxx"_
