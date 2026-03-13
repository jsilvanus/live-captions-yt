---
id: api/images
title: "/images — DSK Image Management"
methods: [POST, GET, DELETE]
auth: [bearer, none]
---

# /images — DSK Image Management

Upload, list, serve, and delete images used for the **Downstream Keyer (DSK)** overlay system. Images are referenced in caption metadata with their shorthand label and displayed in the DSK overlay page.

Images are stored on the server filesystem under `$GRAPHICS_DIR/<apiKey>/`.

**Requires `GRAPHICS_ENABLED=1`** on the server to upload images.  
**Requires `graphics_enabled = true`** on the API key (set by an admin via `PATCH /keys/:key`).

---

## `POST /images` — Upload an Image

Upload a PNG, WebP, or SVG image. Uses `multipart/form-data` encoding.

**Authentication:** Bearer JWT

**Request**

```http
POST /images
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

Form fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | Image file. Accepted MIME types: `image/png`, `image/webp`, `image/svg+xml`. Maximum file size: 5 MB (configurable via `GRAPHICS_MAX_FILE_BYTES`). |
| `shorthand` | string | Yes | A short label (1–32 characters: letters, digits, hyphens, underscores; must start with a letter or digit) used to reference this image in caption metadata. Must be unique per API key. |

**Response — `201 Created`**

```json
{
  "ok": true,
  "image": {
    "id": 1,
    "shorthand": "logo",
    "filename": "a1b2c3d4-...-uuid.png",
    "mimeType": "image/png",
    "sizeBytes": 204800
  }
}
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Missing or invalid `shorthand`, unsupported MIME type, or invalid multipart |
| `401` | Missing or invalid JWT |
| `403` | `graphics_enabled` not set for this API key |
| `409` | Shorthand already in use for this key |
| `413` | File exceeds size limit, or per-key storage quota exceeded (50 MB default) |
| `503` | `GRAPHICS_ENABLED` not set on the server |

---

## `GET /images` — List Images

Return all images for the authenticated API key.

**Authentication:** Bearer JWT

**Request**

```http
GET /images
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "images": [
    {
      "id": 1,
      "shorthand": "logo",
      "filename": "a1b2c3d4-...-uuid.png",
      "mimeType": "image/png",
      "sizeBytes": 204800,
      "createdAt": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

---

## `GET /images/:id` — Serve an Image (Public)

Serve the raw image bytes for the given image ID. This endpoint is **public** (no authentication) so the DSK page can load images without a JWT.

**Authentication:** None

**Request**

```http
GET /images/1
```

**Response — `200 OK`**

```
Content-Type: image/png   (or image/webp, image/svg+xml)
Cache-Control: public, max-age=86400
Access-Control-Allow-Origin: *
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid image id |
| `404` | Image not found in database or on disk |

---

## `DELETE /images/:id` — Delete an Image

Delete an image record and its file from disk.

**Authentication:** Bearer JWT

**Request**

```http
DELETE /images/1
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{ "ok": true }
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid image id |
| `401` | Missing or invalid JWT |
| `404` | Image not found or does not belong to this API key |

---

## DSK Metadata Integration

Reference an image in caption text using the `graphics` metadata comment. The value is a comma-separated list of shorthand labels:

```
<!-- graphics: logo,banner -->
Hello, welcome to the stream!
```

When this caption is processed, the DSK overlay page receives a `graphics` SSE event with `names: ["logo", "banner"]` and displays those images as layers over the green-screen background.

To clear all overlays:

```
<!-- graphics: -->
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GRAPHICS_ENABLED` | unset | Set to `1` to enable the `POST /images` upload endpoint. Listing and serving images works regardless. |
| `GRAPHICS_DIR` | `/data/images` | Base directory for image storage. Each API key gets its own subdirectory. |
| `GRAPHICS_MAX_FILE_BYTES` | `5242880` (5 MB) | Maximum size per uploaded image. |
| `GRAPHICS_MAX_STORAGE_BYTES` | `52428800` (50 MB) | Maximum total image storage per API key. |
