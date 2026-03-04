---
id: api/files
title: "/file — Caption File Management"
methods: [GET, DELETE]
auth: [bearer]
---

# /file — Caption File Management

List, download, and delete caption and translation files that were saved on the backend during a session.

Backend file saving is only active for API keys that have `backend_file_enabled = true`. By default this is disabled (free-tier keys). An admin can enable it via `PATCH /keys/:key` with `{ "backend_file_enabled": true }`.

All `/file` routes are rate-limited to **60 requests per minute** per IP.

---

## `GET /file` — List Files

Return all caption files stored for the authenticated API key.

**Authentication:** Bearer JWT

**Request**

```http
GET /file
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "files": [
    {
      "id": 1,
      "filename": "2024-01-01-a1b2c3d4-fi_FI.txt",
      "lang": "fi-FI",
      "format": "youtube",
      "type": "captions",
      "createdAt": "2024-01-01T12:00:00",
      "updatedAt": "2024-01-01T12:05:30",
      "sizeBytes": 1024
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `number` | Unique file identifier |
| `filename` | `string` | Filename as stored on the server |
| `lang` | `string \| null` | BCP-47 language code of the content, or `null` for the original language |
| `format` | `string` | `"youtube"` (plain text) or `"vtt"` (WebVTT) |
| `type` | `string` | `"captions"` |
| `createdAt` | `string` | ISO datetime when the file entry was created |
| `updatedAt` | `string` | ISO datetime of the last write |
| `sizeBytes` | `number` | Approximate file size in bytes |

**Error responses**

| Status | Reason |
|---|---|
| `401` | Missing or invalid JWT |
| `404` | Session not found |
| `429` | Rate limit exceeded |

---

## `GET /file/:id` — Download File

Download a specific caption file. Supports the `?token=` query parameter for use in direct download links (e.g. `<a href="/file/1?token=...">Download</a>`).

**Authentication:** Bearer JWT **or** `?token=<jwt>` query parameter

**Request**

```http
GET /file/1
Authorization: Bearer <token>
```

Or as a direct link:

```
GET /file/1?token=<jwt>
```

**Response — `200 OK`**

The file is returned as a file download with the appropriate `Content-Type`:

| Format | Content-Type |
|---|---|
| `youtube` | `text/plain; charset=utf-8` |
| `vtt` | `text/vtt; charset=utf-8` |

The `Content-Disposition` header is set to `attachment; filename="<filename>"`.

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid file id |
| `401` | Missing or invalid token |
| `404` | File not found (in database or on disk) |
| `429` | Rate limit exceeded |

---

## `DELETE /file/:id` — Delete File

Delete a caption file. Removes both the database record and the file from disk.

**Authentication:** Bearer JWT

**Request**

```http
DELETE /file/1
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{ "ok": true }
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid file id |
| `401` | Missing or invalid JWT |
| `404` | File not found or does not belong to this API key |
| `429` | Rate limit exceeded |

---

## File Naming

Files are stored under `$FILES_DIR/<sanitised-api-key>/` on the server. The filename format is:

```
<YYYY-MM-DD>-<session8chars>-<lang>.<ext>
```

For example:
- `2024-01-01-a1b2c3d4-fi_FI.txt` — Finnish translation in YouTube format
- `2024-01-01-a1b2c3d4-original.txt` — Original language in YouTube format
- `2024-01-01-a1b2c3d4-en_US.vtt` — English in WebVTT format

Files are appended as captions arrive during the session. A new file is created for each unique combination of session, language, and format.

---

## Enabling Backend File Saving

Backend file saving is controlled by the `backend_file_enabled` flag on each API key. It is disabled by default.

To enable for a specific key (admin only):

```http
PATCH /keys/my-api-key
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{ "backend_file_enabled": true }
```

The `backend_file_enabled` field is included in all key read responses (`GET /keys` and `GET /keys/:key`).

See [`/keys`](./keys.md) for full API key management reference.

---

## Server Configuration

| Variable | Default | Description |
|---|---|---|
| `FILES_DIR` | `/data/files` | Base directory where caption files are stored. Each API key gets its own subdirectory. |
