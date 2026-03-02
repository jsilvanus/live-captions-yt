# MCP Tools Reference

`lcyt` exposes MCP tools across two server transports. Most tools are available on both; a few are exclusive to one transport.

## Tool Availability

| Tool | stdio | SSE |
|---|:---:|:---:|
| [`start`](#start--start-caption-session) | ✅ | ✅ |
| [`send_caption`](#send_caption--send-a-single-caption) | ✅ | ✅ |
| [`send_batch`](#send_batch--send-multiple-captions) | ✅ | ✅ |
| [`sync_clock`](#sync_clock--synchronise-clock) | ✅ | ✅ |
| [`get_status`](#get_status--session-status) | ✅ | ✅ |
| [`stop`](#stop--stop-caption-session) | ✅ | ✅ |
| [`privacy`](#privacy--privacy-notice) | ❌ | ✅ |
| [`privacy_deletion`](#privacy_deletion--request-data-deletion) | ❌ | ✅ |

See also: [Session Resources (stdio only)](#session-resources-stdio-only)

---

## `start` — Start Caption Session

> **Available in:** stdio, SSE

Create a new `YoutubeLiveCaptionSender` session identified by a unique `session_id`. The session is held in memory on the server.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `stream_key` | `string` | Yes | YouTube Live stream key |

**Returns**

```json
{
  "session_id": "a1b2c3d4e5f6g7h8"
}
```

| Field | Type | Description |
|---|---|---|
| `session_id` | `string` | 16-character hex identifier for this session. Pass this to all other tools. |

**Example prompt:** _"Start a caption session with stream key xxxx-xxxx-xxxx-xxxx"_

---

## `send_caption` — Send a Single Caption

> **Available in:** stdio, SSE

Send one caption to YouTube for an active session.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |
| `text` | `string` | Yes | Caption text to deliver |
| `timestamp` | `string` | No | ISO timestamp (`YYYY-MM-DDTHH:MM:SS.mmm`). Defaults to current time. |

**Returns**

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

---

## `send_batch` — Send Multiple Captions

> **Available in:** stdio, SSE

Send an array of captions in a single HTTP request to YouTube.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |
| `captions` | `array` | Yes | Array of caption objects |
| `captions[].text` | `string` | Yes | Caption text |
| `captions[].timestamp` | `string` | No | ISO timestamp for this caption |

**Returns**

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

---

## `sync_clock` — Synchronise Clock

> **Available in:** stdio, SSE

Perform an NTP-style clock sync for the session. This compensates for clock drift between the MCP server and YouTube, improving timestamp accuracy.

Call this once after `start` and periodically during long sessions.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |

**Returns**

```json
{
  "syncOffset": 150
}
```

| Field | Type | Description |
|---|---|---|
| `syncOffset` | `number` | Clock offset in milliseconds. Positive means YouTube's clock is ahead. |

---

## `get_status` — Session Status

> **Available in:** stdio, SSE

Retrieve the current state of a caption session.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID from `start` |

**Returns**

```json
{
  "sequence": 9,
  "syncOffset": 150
}
```

| Field | Type | Description |
|---|---|---|
| `sequence` | `number` | Current sequence counter |
| `syncOffset` | `number` | Current clock sync offset |

---

## `stop` — Stop Caption Session

> **Available in:** stdio, SSE

End a caption session and release its resources.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | `string` | Yes | Session ID to stop |

**Returns**

```json
{
  "ok": true
}
```

---

## Session Resources (stdio only)

The stdio server also exposes MCP **resources** that clients can read:

### `session://<session_id>`

Read the current state of a session as JSON.

```json
{
  "sequence": 9,
  "syncOffset": 150,
  "startedAt": "2024-01-01T12:00:00.000Z"
}
```

---

## `privacy` — Privacy Notice

> **Available in:** SSE only

Return the service privacy notice as plain text. No parameters required.

**Returns:** Plain text privacy statement.

---

## `privacy_deletion` — Request Data Deletion

> **Available in:** SSE only

Submit a GDPR right-to-erasure request. Requires a configured database (`DB_PATH`) and a valid API key.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `api_key` | `string` | Yes | API key to anonymise and delete |

**Returns**

```json
{
  "ok": true,
  "message": "Your data has been anonymised and deleted."
}
```

**Side effects:**
- Terminates any active session for the key
- Anonymises owner name and email in the database
- Deletes associated session stats, caption errors, and auth events

**Requires:** `DB_PATH` environment variable set on the SSE server.

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
