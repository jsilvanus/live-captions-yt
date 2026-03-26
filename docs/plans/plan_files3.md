# Plan: S3-Compatible Caption File Storage (`lcyt-files` plugin)

**Status:** Draft
**Date:** 2026-03-26
**Context:** Extracted from `plan_backend_split.md` — plugin splitting section.

---

## Motivation

Caption files are currently written to a local filesystem path (`FILES_DIR`, defaulting to `/data/files`). This works on single-node Docker deployments but blocks:

- **Horizontal scaling** — two backend instances cannot share a local volume without NFS, making scale-out difficult with the compute orchestrator.
- **Cloud-native deployments** — S3 (or any S3-compatible store: R2, MinIO, Backblaze B2, Wasabi) is the natural target for user-generated files in cloud infrastructure.
- **Long-term retention** — local volumes are tied to the server lifecycle; object storage survives server replacement.

The goal is a thin plugin (`lcyt-files`) that wraps caption file I/O behind a storage-adapter interface, keeping the local-FS adapter as the default and adding an S3 adapter behind a `FILE_STORAGE=s3` env var. No breaking changes to the existing DB schema or API surface.

---

## Current Architecture

### Write path (`captions.js` → `caption-files.js`)

```
POST /captions
  └─ session._sendQueue (serialised per session)
       ├─ writeToBackendFile(ctx, text, ts, db)   ← original text
       └─ writeToBackendFile(ctx, lang, ts, db)   ← each translation
```

`writeToBackendFile` in `src/caption-files.js`:
1. Opens a `fs.WriteStream` (append mode) on first use; caches the handle in `session._fileHandles` Map.
2. Calls `registerCaptionFile(db, ...)` to create the DB row on first use.
3. Writes the caption as plain text or VTT cue.
4. Calls `updateCaptionFileSize(db, id, size)` after each write (via `statSync`).

The handle map key is `${langKey}:${format}`.

### Read/download path (`routes/files.js`)

```
GET /file        → listCaptionFiles(db, apiKey)
GET /file/:id    → getCaptionFile(db, id, apiKey)  → res.download(filepath)
DELETE /file/:id → deleteCaptionFile(db, id, apiKey) + fs.unlink(filepath)
```

`FILES_BASE_DIR` is `resolve(process.env.FILES_DIR || '/data/files')`.

### DB schema (`db/files.js`)

```sql
CREATE TABLE caption_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key     TEXT NOT NULL,
  session_id  TEXT,
  filename    TEXT NOT NULL,
  lang        TEXT,
  format      TEXT DEFAULT 'youtube',
  type        TEXT DEFAULT 'captions',
  size_bytes  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

The `filename` column currently stores a bare filename; the full path is reconstructed from `FILES_BASE_DIR + safe(apiKey) + filename`. For S3 the same column stores the **object key** (full S3 path).

---

## Proposed Design

### 1. Storage adapter interface

Create `packages/plugins/lcyt-files/src/adapters/storage-adapter.js` as a JSDoc interface (no class, just documentation):

```js
/**
 * @typedef {object} StorageAdapter
 *
 * @property {(apiKey: string, filename: string) => Promise<string>} getWritePath
 *   Returns a local tmp path (local adapter) or pre-signed PUT URL (S3 adapter).
 *   Called once when a new file handle is opened.
 *
 * @property {(apiKey: string, filename: string) => AppendHandle} openAppend
 *   Returns an object with .write(chunk) and .close() methods.
 *   For local: wraps fs.WriteStream.
 *   For S3: buffers in a tmp file; on close() uploads to S3 via multipart or PutObject.
 *
 * @property {(apiKey: string, filename: string) => Promise<{ stream, contentType, size }>} openRead
 *   Returns a Readable stream for download.
 *
 * @property {(apiKey: string, filename: string) => Promise<void>} delete
 *   Deletes the object/file.
 *
 * @property {(apiKey: string) => string} keyDir
 *   Returns a safe per-key prefix/directory string.
 */
```

### 2. Local filesystem adapter (default)

`packages/plugins/lcyt-files/src/adapters/local.js`

Thin wrapper around existing `caption-files.js` logic:

```js
import { createWriteStream, createReadStream, mkdirSync, statSync, unlink } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const unlinkAsync = promisify(unlink);

export function createLocalAdapter(baseDir) {
  function keyDir(apiKey) {
    const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const dir = join(baseDir, safe);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function openAppend(apiKey, filename) {
    const dir = keyDir(apiKey);
    const filepath = join(dir, filename);
    const stream = createWriteStream(filepath, { flags: 'a' });
    return {
      filepath,
      write(chunk) {
        return new Promise((resolve, reject) => stream.write(chunk, err => err ? reject(err) : resolve()));
      },
      close() {
        return new Promise((resolve, reject) => stream.end(err => err ? reject(err) : resolve()));
      },
      sizeBytes() {
        try { return statSync(filepath).size; } catch { return 0; }
      },
    };
  }

  function openRead(apiKey, filename) {
    const filepath = join(keyDir(apiKey), filename);
    const { size } = statSync(filepath);
    return { stream: createReadStream(filepath), contentType: 'text/plain', size };
  }

  async function deleteFile(apiKey, filename) {
    const filepath = join(keyDir(apiKey), filename);
    await unlinkAsync(filepath).catch(() => {});
  }

  return { keyDir, openAppend, openRead, deleteFile };
}
```

### 3. S3 adapter

`packages/plugins/lcyt-files/src/adapters/s3.js`

Uses `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` (multipart upload for streaming):

```js
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { PassThrough } from 'node:stream';

export function createS3Adapter({ bucket, prefix = 'captions', region, endpoint, credentials }) {
  const client = new S3Client({ region, endpoint, credentials, forcePathStyle: !!endpoint });

  function keyDir(apiKey) {
    const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    return `${prefix}/${safe}`;
  }

  function openAppend(apiKey, filename) {
    const objectKey = `${keyDir(apiKey)}/${filename}`;
    // Buffer via PassThrough → multipart upload
    const pass = new PassThrough();
    let totalBytes = 0;
    const upload = new Upload({ client, params: { Bucket: bucket, Key: objectKey, Body: pass } });
    const done = upload.done();

    return {
      filepath: objectKey,           // used as "filename" for DB storage
      write(chunk) {
        totalBytes += Buffer.byteLength(chunk);
        return new Promise((resolve, reject) => pass.write(chunk, err => err ? reject(err) : resolve()));
      },
      async close() {
        pass.end();
        await done;
      },
      sizeBytes() { return totalBytes; },
    };
  }

  async function openRead(apiKey, filename) {
    const objectKey = `${keyDir(apiKey)}/${filename}`;
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    return {
      stream: res.Body,
      contentType: res.ContentType || 'text/plain',
      size: res.ContentLength,
    };
  }

  async function deleteFile(apiKey, filename) {
    const objectKey = `${keyDir(apiKey)}/${filename}`;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => {});
  }

  return { keyDir, openAppend, openRead, deleteFile };
}
```

**Note on append semantics:** S3 has no native append. Two approaches:
- **Session-level buffering (recommended):** Keep the multipart upload open for the entire session; `write()` sends parts as the session proceeds; `close()` completes the upload when the session ends. The `session._fileHandles` map already tracks open handles per session, so close can be called in `store.onSessionEnd`.
- **Re-upload on each write (not recommended):** Download existing object, append, re-upload. Expensive and not atomic.

The multipart approach requires handles to be properly closed at session end. See § Migration: session teardown below.

### 4. Plugin package structure

```
packages/plugins/lcyt-files/
├── package.json
├── src/
│   ├── api.js               ← initFilesControl(db, opts?) + createFilesRouters(db, auth, storage)
│   ├── storage.js           ← createStorageAdapter() — reads FILE_STORAGE env var
│   ├── adapters/
│   │   ├── local.js
│   │   └── s3.js
│   ├── caption-files.js     ← writeToBackendFile() rewritten to use adapter
│   └── db.js                ← re-exports from lcyt-backend db/files.js (or duplicates)
└── test/
    ├── local-adapter.test.js
    └── s3-adapter.test.js   ← uses mock S3 (e.g. @smithy/util-test or localstack)
```

**`src/storage.js`** — factory that reads env vars and returns the right adapter:

```js
import { createLocalAdapter } from './adapters/local.js';
import { createS3Adapter }    from './adapters/s3.js';
import { resolve } from 'node:path';

export function createStorageAdapter() {
  const mode = process.env.FILE_STORAGE || 'local';

  if (mode === 's3') {
    const bucket   = process.env.S3_BUCKET;
    const region   = process.env.S3_REGION   || 'auto';
    const endpoint = process.env.S3_ENDPOINT;          // for R2, MinIO, etc.
    const prefix   = process.env.S3_PREFIX    || 'captions';
    const credentials = process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined;                                     // falls through to standard AWS credential chain
    if (!bucket) throw new Error('S3_BUCKET must be set when FILE_STORAGE=s3');
    return createS3Adapter({ bucket, region, endpoint, prefix, credentials });
  }

  const baseDir = resolve(process.env.FILES_DIR || '/data/files');
  return createLocalAdapter(baseDir);
}
```

### 5. Rewriting `caption-files.js` to use the adapter

`writeToBackendFile` becomes adapter-aware. The signature stays compatible:

```js
export function writeToBackendFile(context, text, timestamp, db, storage) {
  // ... (same key computation, VTT vs plain logic) ...
  // Replace:  createWriteStream(filepath, { flags: 'a' })
  // With:     storage.openAppend(apiKey, filename)
  // Replace:  statSync(handle.filepath).size
  // With:     handle.sizeBytes()
}
```

The `storage` argument is injected by `createCaptionsRouter(store, auth, db, relayManager, dskProcessor, storage)`.

### 6. Rewriting `routes/files.js` to use the adapter

```js
// GET /file/:id — download
const row = getCaptionFile(db, id, apiKey);
const { stream, contentType, size } = await storage.openRead(apiKey, row.filename);
res.set('Content-Type', contentType);
if (size) res.set('Content-Length', String(size));
res.set('Content-Disposition', `attachment; filename="${row.filename}"`);
stream.pipe(res);

// DELETE /file/:id
await storage.deleteFile(apiKey, row.filename);
deleteCaptionFile(db, id, apiKey);
```

### 7. Session teardown: closing file handles

S3 multipart uploads must be completed or aborted. Add a close step to `store.onSessionEnd`:

```js
// In server.js, after store.onSessionEnd is defined:
const _origOnSessionEnd = store.onSessionEnd;
store.onSessionEnd = async (session) => {
  // Close all open file handles (no-op for local WriteStreams that auto-close)
  if (session._fileHandles) {
    for (const handle of session._fileHandles.values()) {
      await handle.close().catch(() => {});
    }
    session._fileHandles.clear();
  }
  _origOnSessionEnd?.(session);
};
```

Currently `_fileHandles` are `fs.WriteStream`s which close automatically when the process exits. Making close explicit is good hygiene regardless of the adapter.

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

For **Cloudflare R2**:
```
FILE_STORAGE=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=lcyt-captions
S3_REGION=auto
S3_ACCESS_KEY_ID=<r2-key>
S3_SECRET_ACCESS_KEY=<r2-secret>
```

For **AWS S3** (IAM role on EC2/ECS — no static keys needed):
```
FILE_STORAGE=s3
S3_BUCKET=my-lcyt-captions
S3_REGION=eu-west-1
```

---

## DB Schema Changes

None required. The `caption_files.filename` column already stores arbitrary strings. For local FS it stores `2026-01-01-abc12345-fi-FI.vtt`; for S3 it stores the full object key `captions/apikey_safe/2026-01-01-abc12345-fi-FI.vtt`.

The `size_bytes` column update is already async (`updateCaptionFileSize`). For S3 it is updated at `close()` time (end of session) rather than after every write, which is acceptable.

---

## Migration Path

### Existing deployments (local FS → S3)

There is no automatic migration of existing files. Operators who switch `FILE_STORAGE=s3` mid-deployment will:
1. Have old DB rows pointing to local filenames that no longer exist on the read path.
2. Need to upload existing `FILES_DIR` contents to S3 manually (`aws s3 sync /data/files s3://bucket/captions/`).
3. Update existing DB rows if they want existing downloads to resolve (low priority — most operators will just start fresh with S3 or keep local).

A one-off migration script (`scripts/migrate-files-to-s3.mjs`) would be a nice-to-have but is not in scope here.

### In-code migration guard

Log a clear startup message:
```
✓ File storage: S3 (bucket: my-lcyt-captions, prefix: captions)
```
or
```
✓ File storage: local (dir: /data/files)
```

---

## Implementation Steps

1. **Create `packages/plugins/lcyt-files/`** — package.json, src/ skeleton.
2. **Move `src/caption-files.js`** from lcyt-backend into lcyt-files, adding the `storage` parameter.
3. **Move `src/db/files.js`** re-exports into lcyt-files (or keep in lcyt-backend and import from there — less churn).
4. **Implement `createLocalAdapter`** — wraps existing WriteStream logic; add `.sizeBytes()` / explicit `.close()`.
5. **Implement `createS3Adapter`** — multipart upload via `@aws-sdk/lib-storage`.
6. **Implement `createStorageAdapter`** factory.
7. **Wire into `createCaptionsRouter`** — add `storage` parameter, pass to `writeToBackendFile`.
8. **Wire into `routes/files.js`** — replace `res.download(filepath)` and `fs.unlink` with adapter calls.
9. **Wire into `server.js`** — `initFilesControl(db)` returns `{ storage }`, close handles in `onSessionEnd`.
10. **Tests** — local adapter (temp dir), S3 adapter (mock or localstack).
11. **Update `CLAUDE.md`** — new env vars, plugin entry.

---

## Considerations

- **Streaming download:** `res.download()` works only for local files. For S3 the object body is a `Readable` stream; pipe it directly to `res` with `Content-Disposition` set manually. This is cleaner than downloading to a temp file first.
- **Large files:** Multipart upload minimum part size is 5 MB. For small caption files (< 5 MB) a single `PutObject` is cheaper. The `@aws-sdk/lib-storage` `Upload` class handles this transparently.
- **Concurrent sessions:** Each session has its own `_fileHandles` Map, so adapter instances are not shared between requests — no locking needed.
- **GDPR erasure (`DELETE /stats`):** Currently calls `deleteAllCaptionFiles(db, apiKey)` which deletes DB rows. It does **not** delete the physical files (only rows). The same gap exists today. For S3 it would require listing and deleting all objects under the key prefix — worth adding in the same PR.
- **Cost:** S3 egress costs can add up if files are downloaded frequently. CDN fronting (CloudFront, R2 public buckets) is out of scope here.
