# `packages/plugins/lcyt-files` — Caption File Storage Plugin (v0.1.0)

Storage-adapter–backed caption file I/O for lcyt-backend. Provides local filesystem (default), S3-compatible object storage, and WebDAV backends behind a common interface. Imported by `lcyt-backend` as `lcyt-files`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initFilesControl, createFilesRouter, writeToBackendFile, closeFileHandles } from 'lcyt-files';

const { storage } = await initFilesControl(db);
// Wire storage into captions.js (via createSessionRouters) and files route (via createContentRouters).
// Close handles on session end:
store.onSessionEnd = async (session) => {
  if (session._fileHandles?.size > 0) await closeFileHandles(session._fileHandles);
};
```

**Source files (`src/`):**
- `api.js` — `initFilesControl(db)` → `{ storage }` (logs adapter type at startup). Exports `writeToBackendFile`, `closeFileHandles`, `createFilesRouter`.
- `storage.js` — `createStorageAdapter()` factory; reads `FILE_STORAGE` env var.
- `caption-files.js` — `writeToBackendFile(context, text, timestamp, db, storage, buildVttCue)` + `closeFileHandles(fileHandles)`.
- `routes/files.js` — `createFilesRouter(db, auth, store, jwtSecret, storage)` → `GET /file`, `GET /file/:id`, `DELETE /file/:id`.
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
