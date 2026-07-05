# `packages/lcyt-worker-daemon` — Worker Daemon (v0.0.0, private)

Minimal ESM Express service that runs on worker VMs. Receives job lifecycle commands from the orchestrator (or directly from `lcyt-backend`), spawns placeholder/ffmpeg subprocesses, and optionally uploads HLS output to S3.

**Entry:** `src/index.js` (`startServer(port)`)
**Port:** `process.env.PORT` (default 5000)

**Source files (`src/`):**
- `index.js` — `createApp()` (returns Express app) + `startServer(port)`. In-memory `jobs` map. `NODE_ENV=test` skips real subprocess spawning. Optional `X-Worker-Auth` header authentication via `WORKER_AUTH_TOKEN`.
- `uploader.js` — `createUploader({ watchDir, prefix, uploadFn })`: watches a directory for new files and uploads them via `uploadFn`.
- `s3-uploader.js` — `createS3UploadFn({ baseKey })`: creates an upload function using `@aws-sdk/client-s3`.

**API routes:**
```
POST   /jobs           — create job; spawns subprocess (or no-op in test mode)
DELETE /jobs/:id       — stop job, kill subprocess
POST   /jobs/:id/caption — append caption payload to job record
GET    /stats          — running/total job counts
GET    /health         — status + workerId
GET    /_jobs          — debug: list all jobs
```

**Env vars:**
| Variable | Purpose |
|---|---|
| `WORKER_ID` | This worker's identifier (default `worker-0`) |
| `WORKER_AUTH_TOKEN` / `BACKEND_INTERNAL_TOKEN` | Optional auth token for all `/jobs` endpoints |

**Tests:** `test/daemon.basic.test.js`.

## Test Coverage

~200 source LOC / ~150 test LOC — Moderate coverage, Low priority.

**Gaps:** `uploader.js`, S3 upload errors.

---

Dispatched to by `packages/lcyt-orchestrator` (see its `CLAUDE.md`) and, when `FFMPEG_RUNNER=worker`, directly by `packages/lcyt-backend/src/ffmpeg/worker-runner.js`.
