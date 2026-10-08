# Plan: `lcyt-files` Plugin â€” Storage-Adapter Caption & Stream File I/O

**Status:** Implemented
**Date:** 2026-04-02
**Context:** Extracted from `plan_backend_split.md` â€” plugin splitting section.

---

## Motivation

Caption files were originally written directly to a local filesystem path inside `lcyt-backend`. This blocked:

- **Horizontal scaling** â€” two backend instances cannot share a local volume without NFS.
- **Cloud-native deployments** â€” S3-compatible object storage (R2, MinIO, Backblaze B2, Wasabi) is the natural target for user-generated files.
- **Long-term retention** â€” local volumes are tied to server lifecycle; object storage survives server replacement.
- **Per-user isolation** â€” a single operator-level S3 config is too coarse; power users may want to store their own files in their own bucket with their own credentials.

---

## Implemented Architecture

### Package structure

```
packages/plugins/lcyt-files/
â”œâ”€â”€ package.json                    â† workspace member, optional AWS SDK deps
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ api.js                      â† initFilesControl(db) + re-exports
â”‚   â”œâ”€â”€ storage.js                  â† createStorageAdapter() + createStorageResolver()
â”‚   â”œâ”€â”€ db.js                       â† key_storage_config table migration + CRUD
â”‚   â”œâ”€â”€ caption-files.js            â† writeToBackendFile() + closeFileHandles()
â”‚   â”œâ”€â”€ routes/
â”‚   â”‚   â””â”€â”€ files.js                â† GET/DELETE /file, GET/PUT/DELETE /file/storage-config
â”‚   â””â”€â”€ adapters/
â”‚       â”œâ”€â”€ key-segment.js          â† keySegment(): shared per-project path-segment sanitizer
â”‚       â”œâ”€â”€ local.js                â† local FS adapter
â”‚       â”œâ”€â”€ s3.js                   â† S3-compatible adapter (AWS, R2, MinIO, B2)
â”‚       â””â”€â”€ webdav.js               â† WebDAV adapter (remote file storage)
â””â”€â”€ test/
    â”œâ”€â”€ local-adapter.test.js       â† adapter methods, writeToBackendFile, closeFileHandles
    â”œâ”€â”€ key-segment.test.js         â† path sanitization + collision-resistance
    â”œâ”€â”€ s3-adapter.test.js          â† full S3 adapter coverage vs. a mock node:http S3 server
    â”œâ”€â”€ vtt.test.js                 â† shiftVttContent() cue-time shifting
    â”œâ”€â”€ storage-resolver.cache.test.js
    â”œâ”€â”€ caption-files.error-handling.test.js
    â””â”€â”€ migrate-keys.test.js
```

### Storage adapter interface

Both adapters implement the same interface:

```js
{
  // Caption file I/O (session-lifetime handles)
  keyDir(apiKey)                                       â†’ string
  openAppend(apiKey, filename)                         â†’ AppendHandle
  openRead(apiKey, storedKey, format)                  â†’ { stream, contentType, size }
  deleteFile(apiKey, storedKey)                        â†’ Promise<void>

  // Discrete object writes â€” for future HLS segment/playlist publishing (see below)
  putObject(apiKey, objectKey, buffer, contentType?)   â†’ Promise<{ storedKey }>
  publicUrl(apiKey, objectKey)                         â†’ string | null

  describe()                                           â†’ string
}
```

`AppendHandle`: `{ storedKey, write(chunk), close(), sizeBytes() }`

- **Local:** `storedKey` = full filesystem path. `openRead` calls `statSync` synchronously before creating the ReadStream so ENOENT throws before headers are sent.
- **S3:** `storedKey` = S3 object key. `openAppend` keeps a multipart upload open for the session lifetime; `close()` completes it. AWS SDK is imported dynamically so it is never loaded in local-only deployments.
- **WebDAV:** per-key only (no build-time/global mode). `createWebdavAdapter({ url, username, password })` wraps a WebDAV client for remote file storage.

### Four storage modes

`initFilesControl(db)` returns `{ storage, resolveStorage, invalidateStorageCache }`.

| Mode | Selected when | Config |
|---|---|---|
| **1 â€” Local** (default) | `FILE_STORAGE` absent or `local` | `FILES_DIR` env var |
| **2 â€” Build-time S3** | `FILE_STORAGE=s3` | `S3_*` env vars (operator-level) |
| **3 â€” User-defined S3** | Per-key row in `key_storage_config` (`storage_type='s3'`) | Set via `PUT /file/storage-config`; requires the `files-custom-bucket` project feature |
| **4 â€” User-defined WebDAV** | Per-key row in `key_storage_config` (`storage_type='webdav'`) | Set via `PUT /file/storage-config`; requires the `files-webdav` project feature |

`resolveStorage(apiKey)` checks the DB for a per-key config; creates and caches a per-key S3 or WebDAV adapter if found; falls back to the global adapter otherwise. `invalidateStorageCache(apiKey)` clears the cache entry after a config change.

### Per-key S3 config DB table

```sql
CREATE TABLE IF NOT EXISTS key_storage_config (
  api_key           TEXT PRIMARY KEY NOT NULL,
  bucket            TEXT NOT NULL,
  region            TEXT NOT NULL DEFAULT 'auto',
  endpoint          TEXT,
  prefix            TEXT NOT NULL DEFAULT 'captions',
  access_key_id     TEXT,
  secret_access_key TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
)
```

Migration runs idempotently inside `createFilesRouter` on every startup.

### API routes

```
GET    /file                  â€” list caption files for the authenticated key (Bearer token)
GET    /file/:id              â€” download a file (Bearer token or ?token= for direct links)
DELETE /file/:id              â€” delete a file (DB row + storage object)

GET    /file/storage-config   â€” get current per-key S3 config (credentials masked)
PUT    /file/storage-config   â€” set per-key S3/WebDAV config (requires "files-custom-bucket" or "files-webdav" project feature)
DELETE /file/storage-config   â€” remove per-key config (reverts to global default)
```

`PUT /file/storage-config` enforces the `files-custom-bucket` project feature flag (for `storage_type='s3'`) or `files-webdav` (for `storage_type='webdav'`) via `hasFeature(db, apiKey, ...)`. The admin grants these flags.

### Write path

```
POST /captions
  â””â”€ resolveStorage(session.apiKey)        â† per-key or global adapter
       â””â”€ writeToBackendFile(ctx, text, ts, db, fileStorage, buildVttCue)
            â””â”€ fileStorage.openAppend(apiKey, filename)   â† first call per session
               fileStorage (handle cached in session._fileHandles)
```

### Session teardown

```js
store.onSessionEnd = async (session) => {
  await closeFileHandles(session._fileHandles);  // completes S3 multipart uploads
  // ... stats write ...
};
```

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `FILE_STORAGE` | Storage backend: `local` or `s3` | `local` |
| `FILES_DIR` | Base directory for local adapter | `/data/files` |
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | â€” |
| `S3_REGION` | AWS region (or `auto` for Cloudflare R2) | `auto` |
| `S3_ENDPOINT` | Custom endpoint URL (R2, MinIO, Backblaze B2) | â€” |
| `S3_PREFIX` | Object key prefix within the bucket | `captions` |
| `S3_ACCESS_KEY_ID` | Static credentials access key | â€” (uses AWS credential chain) |
| `S3_SECRET_ACCESS_KEY` | Static credentials secret | â€” |

Per-key S3 config (mode 3) is stored in `key_storage_config` and managed via the API. The same fields apply: `bucket`, `region`, `endpoint`, `prefix`, `access_key_id`, `secret_access_key`.

---

## HLS / Live Stream Storage â€” Groundwork

The adapter interface now includes two methods designed for future HLS segment and playlist publishing. They are implemented on both adapters but not yet wired to any route or manager.

### `putObject(apiKey, objectKey, buffer, contentType?)`

Overwrite semantics (contrast with `openAppend` which keeps one upload open). Suitable for:

- HLS playlists (same object key, new content every few seconds)
- HLS segments (written once, then deleted when outside the rolling window)
- JPEG thumbnails

`objectKey` may include path components: `'hls/playlist.m3u8'`, `'hls/segment-001.ts'`.

- **Local:** writes to `baseDir/keyDir(apiKey)/objectKey`; creates subdirectories automatically.
- **S3:** single `PutObjectCommand` (no multipart â€” segments are small enough).

### `publicUrl(apiKey, objectKey)`

Returns the HTTP URL where the object can be fetched by an HLS player.

- **Local:** `null` â€” local files need a static-file server layer (Express `express.static`, nginx alias) on top. The HLS manager is responsible for constructing the URL from its own base URL config.
- **S3 standard AWS:** `https://{bucket}.s3.{region}.amazonaws.com/{fullKey}`
- **S3 custom endpoint (R2, MinIO, B2):** `{endpoint}/{bucket}/{fullKey}` (path style)

**CDN substitution:** `publicUrl()` always returns the storage origin URL. In production, HLS players should be pointed at a CDN URL, not directly at S3. The HLS manager layer (future `lcyt-rtmp` component) is responsible for swapping the origin for the CDN domain using a configured `CDN_URL` prefix. For R2 + Cloudflare CDN, the public custom domain differs from the R2 API endpoint stored in `key_storage_config`.

### `listObjects(apiKey, prefix)` â€” **Implemented**

Implemented on all three adapters (local, S3, WebDAV). Returns:

```js
listObjects(apiKey, prefix?)   â†’ AsyncIterable<{ objectKey, storedKey, size, lastModified }>
```

- `objectKey` â€” path relative to the keyâ€™s directory (suitable for `putObject`)
- `storedKey` â€” the value to pass directly to `deleteFile(apiKey, storedKey)`
- `size` â€” file size in bytes
- `lastModified` â€” Unix epoch milliseconds

**Per-adapter details:**

- **Local:** recursive `fs.readdirSync` walk; works on all Node 18+ without the `{ recursive }` option.
- **S3:** `ListObjectsV2Command` with `ContinuationToken` pagination; async iterable hides pagination from callers.
- **WebDAV:** `client.getDirectoryContents(path, { deep: true })` for a single recursive listing call.

### GDPR erasure for storage objects â€” **Implemented**

`DELETE /stats` now deletes physical storage objects before anonymising the DB record:

1. `resolveStorage(apiKey)` resolves the per-key (or global) adapter.
2. `storage.listObjects(apiKey)` enumerates all objects under the key prefix.
3. Each object is deleted via `storage.deleteFile(apiKey, obj.storedKey)` (best-effort; failures are logged but do not abort the request).
4. `deleteAllCaptionFiles(db, apiKey)` removes all `caption_files` DB rows.
5. `anonymizeKey(db, apiKey)` anonymises usage/stats data as before.

`resolveStorage` is threaded from `createContentRouters` into `createStatsRouter` via a new `opts` parameter.

---

## Remaining / Future Work

| Item | Priority | Notes |
|---|---|---|
| ~~Wire `putObject`/`publicUrl` into HLS manager~~ | ~~Medium~~ | **Done** (`tmp_plan_tier3.md` Item 1) â€” `HlsManager` (`lcyt-rtmp`) polls its output directory and pushes new/changed HLS files via `resolveStorage`, injected from `lcyt-backend/src/server.js`'s `initFilesControl()`. |
| CDN URL config field | Low | Add optional `cdn_url` to `key_storage_config` so `publicUrl()` can return the CDN URL directly. |
| ~~S3 adapter tests~~ | ~~Low~~ | **Done** (`tmp_plan_tier3.md` Item 7) â€” `test/s3-adapter.test.js` against a lightweight custom `node:http` mock (`test/helpers/mock-s3-server.js`), not localstack, matching the repo's no-external-service test convention. |
| ~~Local FS â†’ S3 migration script~~ | ~~Low~~ | **Done** â€” `scripts/migrate-files-to-s3.mjs`: copy-only, verifies each upload, `--dry-run`, idempotent re-runs. |

---

## Migration Path (operator)

Switching an existing deployment from local to S3 mid-operation:

1. Old DB rows point to local file paths that won't resolve against the S3 adapter.
2. Upload existing `FILES_DIR` contents: `aws s3 sync /data/files s3://bucket/captions/`
3. Bulk-update `filename` column: strip base dir prefix, leaving only the object key.
4. Set `FILE_STORAGE=s3` and restart.

A migration script now exists at `scripts/migrate-files-to-s3.mjs` and automates steps 2â€“3 above: it uploads each `caption_files` row's local file to S3, verifies the upload, and updates that row's `filename` column to the new S3 object key â€” copy-only (local files are never deleted), supports `--dry-run`, and skips rows already migrated on re-run.

