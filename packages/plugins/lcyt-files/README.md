# lcyt-files — Caption File Storage Plugin

Storage-adapter-backed caption file I/O for lcyt-backend. Provides local filesystem (default), S3-compatible object storage, and WebDAV backends behind a common interface.

**Version:** 0.1.0  
**License:** MIT

## Overview

lcyt-files provides:
- **Storage abstraction** — Pluggable backend (local, S3, WebDAV)
- **Append-based writes** — Stream captions to file handles
- **S3 multipart upload** — Efficient large-file uploads
- **Per-key file management** — List, download, delete caption files
- **Format support** — Plain text, WebVTT, JSON
- **Storage quota enforcement** — Per-key limits

## Installation

```bash
npm install lcyt-files
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initFilesControl, createFilesRouter } from 'lcyt-files';

const { storage } = await initFilesControl(db);

// Wire storage into captions router (for file writing)
// Wire router into app for file management API
app.use('/file', createFilesRouter(db, auth, store, jwtSecret, storage));

// On session end, close file handles
store.onSessionEnd = async (session) => {
  if (session._fileHandles?.size > 0) {
    await closeFileHandles(session._fileHandles);
  }
};
```

## Storage Backends

### Local Filesystem (default)

```bash
FILE_STORAGE=local
FILES_DIR=/data/files
```

Files organized per API key:
```
/data/files/
├── key1/
│   ├── caption_2026-06-26.txt
│   └── caption_2026-06-25.vtt
├── key2/
│   └── caption_2026-06-26.json
```

### S3-Compatible (AWS, Cloudflare R2, MinIO, etc.)

```bash
FILE_STORAGE=s3
S3_BUCKET=my-captions
S3_REGION=auto
S3_ENDPOINT=https://r2.cloudflarestorage.com  # Optional
S3_PREFIX=captions
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=yyy
```

Objects stored as: `captions/key1/caption_2026-06-26.txt`

### WebDAV

```bash
FILE_STORAGE=webdav
WEBDAV_URL=https://webdav.example.com/captions
WEBDAV_USERNAME=user
WEBDAV_PASSWORD=pass
```

## API Routes

```
GET    /file
       List caption files for authenticated API key
       Query: ?format=vtt, ?date=2026-06-26, ?limit=20
       Response: [{ id, name, size, created_at, url }]

GET    /file/:id
       Download a caption file
       Query: ?format=json (convert format)
       Response: file contents (Content-Type: text/plain|application/json)

DELETE /file/:id
       Delete a caption file
       Response: 204

POST   /file?action=upload
       Upload a caption file (multipart form)
       Form: file (binary), name (optional)
       Response: 201 { id, name, url }
```

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FILE_STORAGE` | `local` | Backend: `local`, `s3`, or `webdav` |
| `FILES_DIR` | `/data/files` | Base directory (local adapter) |
| `S3_BUCKET` | — | S3 bucket name (required for S3) |
| `S3_REGION` | `auto` | AWS region or `auto` (R2) |
| `S3_ENDPOINT` | — | Custom endpoint (R2, MinIO, B2) |
| `S3_PREFIX` | `captions` | Object key prefix |
| `S3_ACCESS_KEY_ID` | — | Static credentials (optional) |
| `S3_SECRET_ACCESS_KEY` | — | Static credentials (optional) |
| `WEBDAV_URL` | — | WebDAV server URL |
| `WEBDAV_USERNAME` | — | WebDAV username |
| `WEBDAV_PASSWORD` | — | WebDAV password |

## Storage Adapter Interface

All adapters implement:

```javascript
interface StorageAdapter {
  // Get safe per-key directory prefix
  keyDir(apiKey: string): string;
  
  // Open file for appending
  openAppend(apiKey: string, filename: string): {
    storedKey: string,      // Full path/key for later retrieval
    write(chunk: Buffer): Promise<void>,
    close(): Promise<void>,
    sizeBytes(): number
  };
  
  // Open file for reading
  openRead(apiKey: string, storedKey: string, format: string): {
    stream: ReadableStream,
    contentType: string,
    size: number
  };
  
  // Delete file
  deleteFile(apiKey: string, storedKey: string): Promise<void>;
  
  // Describe adapter (for logging)
  describe(): string;
}
```

## File Writing

In the captions route, files are written per-session:

```javascript
import { writeToBackendFile } from 'lcyt-files';

const handle = await writeToBackendFile(
  context,           // { req, res, session, db }
  captionText,       // "Hello, world!"
  timestamp,         // "2026-06-26T12:00:00.000"
  db,
  storage,
  buildVttCue        // Format function
);

// Later: handle.write(chunk), handle.close()
```

Files are organized by API key and date:
- `caption_2026-06-26.txt` — Plain text (one per day)
- `caption_2026-06-26.vtt` — WebVTT (one per day)
- `caption_2026-06-26.json` — JSON array (one per day)

## Database Schema

```sql
CREATE TABLE caption_files (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  filename TEXT,            -- Adapter's storedKey (full path or S3 key)
  format TEXT,              -- 'txt', 'vtt', 'json'
  size_bytes INTEGER,
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);
```

## Format Conversion

Files can be converted on download via query param:

```
GET /file/:id?format=json       → Convert to JSON array
GET /file/:id?format=vtt        → Convert to WebVTT
GET /file/:id                   → Original format
```

## Testing

```bash
npm test -w packages/plugins/lcyt-files
```

Tests cover:
- Local adapter (read, write, delete)
- S3 adapter with mock AWS SDK
- WebDAV adapter with mock client
- `writeToBackendFile` flow
- `closeFileHandles` cleanup
- File listing and conversion

## Quotas & Limits

Per-API-key storage limits (configured per-backend):

```javascript
// Local adapter
maxFileSize: 5GB
maxStoragePerKey: 50GB

// S3 adapter
maxFileSize: 5GB (multipart limit)
maxStoragePerKey: 100GB
```

Query `/file?limit=1000` to paginate large lists.

## Performance Considerations

**Local:**
- Best for single-server setups
- File I/O limited by disk speed

**S3:**
- Multipart upload for large files
- Distributed/cloud-native
- Per-request charges (check pricing)

**WebDAV:**
- Suitable for on-prem storage
- Network latency consideration

## See Also

- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Caption format guide](../../docs/api/captions.md)
- [Storage configuration](../../docs/env-vars.md)
- [Plan: File Storage (S3)](../../docs/plans/plan_files3.md)
