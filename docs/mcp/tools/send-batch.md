---
title: "send_batch — Send Multiple Captions"
stdio: true
sse: true
---

# `send_batch` — Send Multiple Captions

Send an array of captions in a single HTTP request to YouTube.

**Available in:** stdio, SSE

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |
| `captions` | `array` | Yes | Array of caption objects |
| `captions[].text` | `string` | Yes | Caption text |
| `captions[].timestamp` | `string` | No | ISO timestamp for this caption |

## Returns

```json
{
  "ok": true,
  "sequence": 9,
  "count": 3
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` on success |
| `sequence` | `number` | Sequence number of the last caption in the batch |
| `count` | `number` | Number of captions delivered |
