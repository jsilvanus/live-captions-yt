# `packages/plugins/lcyt-files` — Caption File Storage Plugin (v0.1.0)

Storage-adapter–backed caption file I/O for lcyt-backend. Provides local filesystem (default), S3-compatible object storage, and WebDAV backends behind a common interface, in three modes: **local** (`FILES_DIR`), **operator-configured S3** (`S3_*` env vars), and **user-defined (runtime) per-key S3** — credentials stored in the plugin-owned `key_storage_config` table, gated on the `custom-storage` project feature. Imported by `lcyt-backend` as `lcyt-files`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initFilesControl, createFilesRouter, writeToBackendFile, closeFileHandles } from 'lcyt-files';

const { storage, resolveStorage, invalidateStorageCache } = await initFilesControl(db);
// resolveStorage(apiKey) picks the per-key adapter (falls back to the global one);
// wire it into captions.js (via createSessionRouters) and content.js (via createContentRouters).
// Close handles on session end:
store.onSessionEnd = async (session) => {
  if (session._fileHandles?.size > 0) await closeFileHandles(session._fileHandles);
};
```

**Source files (`src/`):**
- `api.js` — `initFilesControl(db)` → `{ storage, resolveStorage, invalidateStorageCache }`: runs the plugin's DB migrations, creates the global adapter, and creates the per-key resolver (logs adapter type at startup). Exports `writeToBackendFile`, `closeFileHandles`, `createFilesRouter`.
- `storage.js` — `createStorageAdapter()` factory (reads `FILE_STORAGE` env var) + `createStorageResolver(db, globalAdapter)` → `{ resolveStorage, invalidateCache }` for per-key adapter resolution with caching.
- `db.js` — `key_storage_config` table migrations + per-key storage config read/write helpers (bucket, region, endpoint, prefix, credentials, `storage_type`).
- `caption-files.js` — `writeToBackendFile(context, text, timestamp, db, storage, buildVttCue)` + `closeFileHandles(fileHandles)`. `context.format` is per-file (`'text' | 'youtube' | 'vtt'`; the caption POST's per-language `fileFormats` field selects it — see `packages/lcyt-backend/src/routes/captions.js`). For `format: 'vtt'`, cue times are session-relative: `context.sessionStartMs` (epoch ms; `captions.js` passes `session.startedAt`) anchors them to the session start, falling back to the first caption written to the file when absent; timestamps before the anchor clamp to `00:00:00.000`.
- `vtt.js` — `shiftVttContent(content, offsetMs)`: pure cue-time shifter for aligning archived VTT to a VOD timeline (clamps at zero, leaves non-timing lines untouched). Used by the download route's `?offsetMs=` and exported from the plugin entry for future post-broadcast upload work.
- `routes/files.js` — `createFilesRouter(db, auth, store, jwtSecret, resolveStorage, invalidateStorageCache)` → `GET /file`, `GET /file/:id` (supports `?offsetMs=±N` on `vtt` files to shift cue times on the fly; 400 on non-vtt or out-of-range values, bound ±24h), `DELETE /file/:id`, `GET/PUT/DELETE /file/storage-config`.
- `adapters/local.js` — `createLocalAdapter(baseDir)`: wraps `fs.WriteStream` (append) and `fs.ReadStream`. `storedKey` is the full filesystem path.
- `adapters/s3.js` — `createS3Adapter({ bucket, prefix, region, endpoint, credentials })`: multipart upload via `@aws-sdk/lib-storage`. `storedKey` is the S3 object key.
- `adapters/webdav.js` — `createWebdavAdapter({ url, username, password })`: WebDAV client adapter for remote file storage.

**Storage adapter interface:**
```
keyDir(apiKey)                                  → string (safe per-key prefix)
openAppend(apiKey, filename)                    → AppendHandle { storedKey, write(chunk), close(), sizeBytes() }
openRead(apiKey, storedKey, format)             → { stream, contentType, size }  (throws ENOENT if missing)
deleteFile(apiKey, storedKey)                   → Promise<void>
describe()                                      → string (startup log message)
```

**Environment variables** (see also `packages/lcyt-backend/CLAUDE.md`):
| Variable | Purpose | Default |
|---|---|---|
| `FILE_STORAGE` | Storage backend: `local`, `s3`, or `webdav` | `local` |
| `FILES_DIR` | Base directory for local adapter | `/data/files` |
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | — |
| `S3_REGION` | AWS region (or `auto` for R2) | `auto` |
| `S3_ENDPOINT` | Custom endpoint (R2, MinIO, Backblaze B2) | — |
| `S3_PREFIX` | Object key prefix | `captions` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Static credentials | — (uses AWS chain) |

**Notes:**
- The `caption_files` DB table is owned by `lcyt-backend/src/db/schema.js` (unchanged).
- The `filename` column stores the adapter's `storedKey` — a full filesystem path for local, an S3 object key for S3. `basename()` is applied in list responses for display.
- For S3: the multipart upload streams data as it is written; `close()` (called in `onSessionEnd`) completes the upload.
- `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` are optional dependencies; not required when `FILE_STORAGE=local`.

**Tests:** `packages/plugins/lcyt-files/test/local-adapter.test.js` — 17 tests covering adapter methods, `writeToBackendFile`, and `closeFileHandles`.
