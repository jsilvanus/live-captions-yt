# Plan: `lcyt-files` Plugin — Storage-Adapter Caption & Stream File I/O

**Status:** Implemented
**Date:** 2026-04-02
**Context:** Extracted from `plan_backend_split.md` — plugin splitting section.

---

## Motivation

Caption files were originally written directly to a local filesystem path inside `lcyt-backend`. This blocked:

- **Horizontal scaling** — two backend instances cannot share a local volume without NFS.
- **Cloud-native deployments** — S3-compatible object storage (R2, MinIO, Backblaze B2, Wasabi) is the natural target for user-generated files.
- **Long-term retention** — local volumes are tied to server lifecycle; object storage survives server replacement.
- **Per-user isolation** — a single operator-level S3 config is too coarse; power users may want to store their own files in their own bucket with their own credentials.

---

## Implemented Architecture

### Package structure

```
packages/plugins/lcyt-files/
├── package.json                    ← workspace member, optional AWS SDK deps
├── src/
│   ├── api.js                      ← initFilesControl(db) + re-exports
│   ├── storage.js                  ← createStorageAdapter() + createStorageResolver()
│   ├── db.js                       ← key_storage_config table migration + CRUD
│   ├── caption-files.js            ← writeToBackendFile() + closeFileHandles()
│   ├── routes/
│   │   └── files.js                ← GET/DELETE /file, GET/PUT/DELETE /file/storage-config
│   └── adapters/
│       ├── local.js                ← local FS adapter
│       └── s3.js                   ← S3-compatible adapter (AWS, R2, MinIO, B2)
└── test/
    └── local-adapter.test.js       ← 17 tests (real tmp dir, no mocking)
```

### Storage adapter interface

Both adapters implement the same interface:

```js
{
  // Caption file I/O (session-lifetime handles)
  keyDir(apiKey)                                       → string
  openAppend(apiKey, filename)                         → AppendHandle
  openRead(apiKey, storedKey, format)                  → { stream, contentType, size }
  deleteFile(apiKey, storedKey)                        → Promise<void>

  // Discrete object writes — for future HLS segment/playlist publishing (see below)
  putObject(apiKey, objectKey, buffer, contentType?)   → Promise<{ storedKey }>
  publicUrl(apiKey, objectKey)                         → string | null

  describe()                                           → string
}
```

`AppendHandle`: `{ storedKey, write(chunk), close(), sizeBytes() }`

- **Local:** `storedKey` = full filesystem path. `openRead` calls `statSync` synchronously before creating the ReadStream so ENOENT throws before headers are sent.
- **S3:** `storedKey` = S3 object key. `openAppend` keeps a multipart upload open for the session lifetime; `close()` completes it. AWS SDK is imported dynamically so it is never loaded in local-only deployments.

### Three storage modes

`initFilesControl(db)` returns `{ storage, resolveStorage, invalidateStorageCache }`.

| Mode | Selected when | Config |
|---|---|---|
| **1 — Local** (default) | `FILE_STORAGE` absent or `local` | `FILES_DIR` env var |
| **2 — Build-time S3** | `FILE_STORAGE=s3` | `S3_*` env vars (operator-level) |
| **3 — User-defined S3** | Per-key row in `key_storage_config` | Set via `PUT /file/storage-config`; requires `custom-storage` project feature |

`resolveStorage(apiKey)` checks the DB for a per-key config; creates and caches a per-key S3 adapter if found; falls back to the global adapter otherwise. `invalidateStorageCache(apiKey)` clears the cache entry after a config change.

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
GET    /file                  — list caption files for the authenticated key (Bearer token)
GET    /file/:id              — download a file (Bearer token or ?token= for direct links)
DELETE /file/:id              — delete a file (DB row + storage object)

GET    /file/storage-config   — get current per-key S3 config (credentials masked)
PUT    /file/storage-config   — set per-key S3 config (requires "custom-storage" project feature)
DELETE /file/storage-config   — remove per-key config (reverts to global default)
```

`PUT /file/storage-config` enforces the `custom-storage` project feature flag via `hasFeature(db, apiKey, 'custom-storage')`. The admin grants this flag.

### Write path

```
POST /captions
  └─ resolveStorage(session.apiKey)        ← per-key or global adapter
       └─ writeToBackendFile(ctx, text, ts, db, fileStorage, buildVttCue)
            └─ fileStorage.openAppend(apiKey, filename)   ← first call per session
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
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | — |
| `S3_REGION` | AWS region (or `auto` for Cloudflare R2) | `auto` |
| `S3_ENDPOINT` | Custom endpoint URL (R2, MinIO, Backblaze B2) | — |
| `S3_PREFIX` | Object key prefix within the bucket | `captions` |
| `S3_ACCESS_KEY_ID` | Static credentials access key | — (uses AWS credential chain) |
| `S3_SECRET_ACCESS_KEY` | Static credentials secret | — |

Per-key S3 config (mode 3) is stored in `key_storage_config` and managed via the API. The same fields apply: `bucket`, `region`, `endpoint`, `prefix`, `access_key_id`, `secret_access_key`.

---

## HLS / Live Stream Storage — Groundwork

The adapter interface now includes two methods designed for future HLS segment and playlist publishing. They are implemented on both adapters but not yet wired to any route or manager.

### `putObject(apiKey, objectKey, buffer, contentType?)`

Overwrite semantics (contrast with `openAppend` which keeps one upload open). Suitable for:

- HLS playlists (same object key, new content every few seconds)
- HLS segments (written once, then deleted when outside the rolling window)
- JPEG thumbnails

`objectKey` may include path components: `'hls/playlist.m3u8'`, `'hls/segment-001.ts'`.

- **Local:** writes to `baseDir/keyDir(apiKey)/objectKey`; creates subdirectories automatically.
- **S3:** single `PutObjectCommand` (no multipart — segments are small enough).

### `publicUrl(apiKey, objectKey)`

Returns the HTTP URL where the object can be fetched by an HLS player.

- **Local:** `null` — local files need a static-file server layer (Express `express.static`, nginx alias) on top. The HLS manager is responsible for constructing the URL from its own base URL config.
- **S3 standard AWS:** `https://{bucket}.s3.{region}.amazonaws.com/{fullKey}`
- **S3 custom endpoint (R2, MinIO, B2):** `{endpoint}/{bucket}/{fullKey}` (path style)

**CDN substitution:** `publicUrl()` always returns the storage origin URL. In production, HLS players should be pointed at a CDN URL, not directly at S3. The HLS manager layer (future `lcyt-rtmp` component) is responsible for swapping the origin for the CDN domain using a configured `CDN_URL` prefix. For R2 + Cloudflare CDN, the public custom domain differs from the R2 API endpoint stored in `key_storage_config`.

### `listObjects(apiKey, prefix)` — **Implemented**

Implemented on all three adapters (local, S3, WebDAV). Returns:

```js
listObjects(apiKey, prefix?)   → AsyncIterable<{ objectKey, storedKey, size, lastModified }>
```

- `objectKey` — path relative to the key’s directory (suitable for `putObject`)
- `storedKey` — the value to pass directly to `deleteFile(apiKey, storedKey)`
- `size` — file size in bytes
- `lastModified` — Unix epoch milliseconds

**Per-adapter details:**

- **Local:** recursive `fs.readdirSync` walk; works on all Node 18+ without the `{ recursive }` option.
- **S3:** `ListObjectsV2Command` with `ContinuationToken` pagination; async iterable hides pagination from callers.
- **WebDAV:** `client.getDirectoryContents(path, { deep: true })` for a single recursive listing call.

### GDPR erasure for storage objects — **Implemented**

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
| Wire `putObject`/`publicUrl` into HLS manager | Medium | New `lcyt-rtmp` component; uses `resolveStorage` the same way captions do. |
| CDN URL config field | Low | Add optional `cdn_url` to `key_storage_config` so `publicUrl()` can return the CDN URL directly. |
| S3 adapter tests | Low | Requires mock S3 (e.g. localstack or custom HTTP mock). |
| Local FS → S3 migration script | Low | `scripts/migrate-files-to-s3.mjs` — walk `FILES_DIR`, upload each file, update DB `filename` column. |

---

## Migration Path (operator)

Switching an existing deployment from local to S3 mid-operation:

1. Old DB rows point to local file paths that won't resolve against the S3 adapter.
2. Upload existing `FILES_DIR` contents: `aws s3 sync /data/files s3://bucket/captions/`
3. Bulk-update `filename` column: strip base dir prefix, leaving only the object key.
4. Set `FILE_STORAGE=s3` and restart.

A migration script (`scripts/migrate-files-to-s3.mjs`) is listed as low-priority future work above.
