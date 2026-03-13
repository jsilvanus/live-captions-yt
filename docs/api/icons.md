---
id: api/icons
title: "/icons — Viewer Branding Icons"
methods: [POST, GET, DELETE]
auth: [bearer, none]
---

# /icons — Viewer Branding Icons

Upload, list, serve, and delete branding icons (PNG or SVG) associated with an API key. Icons are used to brand viewer pages — the streamer uploads a logo in Settings → Icons, then chooses it for a viewer target in CC → Targets.

Icons are stored on the server filesystem under `$ICONS_DIR/<apiKey>/`.

All `/icons` routes are **rate-limited to 60 requests per minute per IP**.

> **Important:** The `/icons` router is mounted **before** the global JSON body parser. The upload endpoint uses its own 400 KB body parser to support base64-encoded images.

---

## `POST /icons` — Upload an Icon

Upload a PNG or SVG icon using a JSON body with base64-encoded image data.

**Authentication:** Bearer JWT

**Request**

```http
POST /icons
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "filename": "logo.png",
  "mimeType": "image/png",
  "data": "<base64-encoded image data>"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | `string` | Yes | Original filename (used for display only; up to 255 characters). |
| `mimeType` | `string` | Yes | `image/png` or `image/svg+xml`. |
| `data` | `string` | Yes | Base64-encoded image content. Maximum decoded size: 200 KB. |

**Validation:**
- PNG files are validated against the PNG magic bytes (`89 50 4E 47`).
- SVG files are checked for `<svg` or `<?xml` in the first 512 bytes.

**Response — `201 Created`**

```json
{
  "ok": true,
  "id": 1,
  "filename": "logo.png",
  "mimeType": "image/png",
  "sizeBytes": 12345
}
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Missing or invalid `filename`, `mimeType`, or `data`; file fails format validation |
| `401` | Missing or invalid JWT |
| `404` | Session not found |
| `413` | Decoded icon exceeds 200 KB |
| `429` | Rate limit exceeded |

---

## `GET /icons` — List Icons

Return all icons for the authenticated API key.

**Authentication:** Bearer JWT

**Request**

```http
GET /icons
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "icons": [
    {
      "id": 1,
      "filename": "logo.png",
      "mimeType": "image/png",
      "createdAt": "2024-01-01T12:00:00.000Z",
      "sizeBytes": 12345
    }
  ]
}
```

---

## `GET /icons/:id` — Serve an Icon (Public)

Serve the raw icon bytes. **Public** (no authentication) so viewer pages can load icons without a JWT.

**Authentication:** None

**Request**

```http
GET /icons/1
```

**Response — `200 OK`**

```
Content-Type: image/png   (or image/svg+xml)
Cache-Control: public, max-age=3600
Access-Control-Allow-Origin: *
Content-Length: <size>
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid icon id |
| `404` | Icon not found in database or on disk |
| `429` | Rate limit exceeded |

---

## `DELETE /icons/:id` — Delete an Icon

Delete an icon record and its file from disk.

**Authentication:** Bearer JWT

**Request**

```http
DELETE /icons/1
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{ "ok": true }
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid icon id |
| `401` | Missing or invalid JWT |
| `404` | Icon not found or does not belong to this API key |
| `429` | Rate limit exceeded |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ICONS_DIR` | `/data/icons` | Base directory for icon storage. Each API key gets its own subdirectory. |
