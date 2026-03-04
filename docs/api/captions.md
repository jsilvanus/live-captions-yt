---
id: api/captions
title: "/captions — Send Captions"
methods: [POST]
auth: [bearer]
---

# /captions — Send Captions

Queue one or more captions for delivery to YouTube. Returns `202 Accepted` immediately; the actual YouTube delivery result arrives on the SSE event stream (`GET /events`).

---

## `POST /captions` — Send Captions

Queue one or more captions for delivery to YouTube. Returns `202 Accepted` immediately; the actual YouTube delivery result arrives on the SSE event stream (`GET /events`).

**Authentication:** Bearer JWT

Captions are serialised per session (using an internal send queue) to keep sequence numbers monotonic, even if multiple `POST /captions` requests arrive concurrently.

**Request**

```http
POST /captions
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "captions": [
    { "text": "Hello, world!" },
    { "text": "Second line", "timestamp": "2024-01-01T12:00:02.000" },
    { "text": "Third line",  "time": 5000 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `captions` | `array` | Yes | Array of caption objects (at least one required) |
| `captions[].text` | `string` | Yes | Caption text (original language) |
| `captions[].timestamp` | `string \| number` | No | ISO string (`YYYY-MM-DDTHH:MM:SS.mmm`) or Unix milliseconds. Defaults to current server time. |
| `captions[].time` | `number` | No | Milliseconds since session `startedAt`. Resolved by the server as `startedAt + time + syncOffset`. Cannot be combined with `timestamp`. |
| `captions[].translations` | `object` | No | Map of BCP-47 language code → translated text, e.g. `{ "fi-FI": "Hei maailma!" }`. Used for backend file saving and caption composition. |
| `captions[].captionLang` | `string` | No | BCP-47 code of the translation to use as the YouTube caption text. The backend will look up this code in `translations`. |
| `captions[].showOriginal` | `boolean` | No | When `true` and `captionLang` is set, the caption sent to YouTube is `"original<br>translated"` instead of just the translation. |

### Caption text composition

The backend composes the final text sent to YouTube as follows:

| `captionLang` set | `translations[captionLang]` exists | `showOriginal` | Result sent to YouTube |
|---|---|---|---|
| No | — | — | `text` (original) |
| Yes | No | — | `text` (original, fallback) |
| Yes | Yes | `false` | `translations[captionLang]` |
| Yes | Yes | `true` | `text + "<br>" + translations[captionLang]` |

If `backend_file_enabled` is set on the API key, the original text and all translations are also written to per-session files under `$FILES_DIR/<apiKey>/`. See [File Saving](#file-saving) and [`GET /file`](./file.md).

**Response — `202 Accepted`**

```json
{
  "ok": true,
  "requestId": "a1b2c3d4e5f6..."
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | Always `true` for a 202 response |
| `requestId` | `string` | Correlates to a `caption_result` or `caption_error` SSE event |

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid or empty captions array |
| `401` | Missing or invalid JWT |
| `429` | Daily or lifetime usage limit exceeded |

---

## File Saving

When `backend_file_enabled` is enabled on an API key (set via `PATCH /keys/:key`), each caption delivery also appends the text to files in `$FILES_DIR/<apiKey>/`:

- One file per language (including the original), in YouTube plaintext format (one line per caption).
- Files are named `<date>-<session8chars>-<lang>.<ext>` (e.g. `2024-01-01-a1b2c3d4-fi_FI.txt`).
- File metadata is recorded in the `caption_files` database table.
- Use [`GET /file`](./file.md) to list, download, or delete stored files.

Free-tier API keys have `backend_file_enabled = false` (the default). Enable it per-key via the admin `PATCH /keys/:key` endpoint.


