# `packages/lcyt-worker-daemon` — Worker Daemon (v0.0.0, private)

Minimal ESM Express service that runs on worker VMs. Receives job lifecycle commands from the orchestrator (or directly from `lcyt-backend`), spawns placeholder/ffmpeg subprocesses, and optionally uploads HLS output to S3.

**Entry:** `src/index.js` (`startServer(port)`)
**Port:** `process.env.PORT` (default 5000)

**Source files (`src/`):**
- `index.js` — `createApp()` (returns Express app) + `startServer(port)`. In-memory `jobs` map. `POST /jobs` branches on `plan.type`: `'perception'` (see below) is a distinct job type handled entirely by `perception-job.js`, no ffmpeg subprocess/fifo/uploader involved; every other/absent type keeps the original ffmpeg path unchanged, including its `NODE_ENV=test` no-op-spawn short-circuit (perception jobs run for real even under `NODE_ENV=test` — no subprocess is spawned, only in-process timers + `fetch`, so tests exercise the real code path and must explicitly `DELETE /jobs/:id` to stop them, or leave dangling timers). Optional `X-Worker-Auth` header authentication via `WORKER_AUTH_TOKEN`.
- `uploader.js` — `createUploader({ watchDir, prefix, uploadFn })`: watches a directory for new files and uploads them via `uploadFn`.
- `s3-uploader.js` — `createS3UploadFn({ baseKey })`: creates an upload function using `@aws-sdk/client-s3`.
- `perception-job.js` — `createPerceptionJob(plan, jobId, { onJobError })`: wires `perception/frame-source.js` + `perception/stub-backend.js` into `perception/runner.js`, POSTing each detection to `plan.callbackUrl` (`X-Internal-Auth: plan.internalToken` if set). One job per dedicated-feed camera (`plan_video_perception.md` Phase 2 Stream B). `onJobError(kind, err)` (`kind: 'detect'|'callback'`) is called on every tick/callback failure — the runner retries forever by design (a camera/backend outage is often transient), so `index.js` uses this hook to increment the `worker_perception_job_errors_total{kind}` Prometheus counter and set `record.errorCount`/`lastError`/`lastErrorAt` (surfaced on `GET /_jobs`) rather than relying on `finishJob()`'s terminal accounting, which a perpetually-retrying job never reaches on its own (code-review fix — a permanently-failing job was previously invisible: still `status:'running'`, zero metric signal).
- `perception/runner.js` — `createPerceptionRunner(cameraId, frameSource, { emitIntervalMs, backend, onDetection, onError })`: the fps30 tracker subsystem's swappable runner interface (`start()`/`stop()`, bounded-rate `{cameraId, ts, objects, framing, visible}` emission). **Process-boundary decision, documented in the module itself:** in-process Node, not a subprocess/sidecar — Phase 2 ships only a stub detector (no real CV model in this repo yet), so there's nothing to isolate into its own process; a real model backend is a follow-on task that can relocate the process boundary without changing this contract.
- `perception/frame-source.js` — `createHttpFrameSource(frameUrl)`: polls a JPEG URL (the existing public `GET /preview/:key/incoming` route, keyed by a camera's `camera_key` rather than the project `api_key`); `getFrame()` returns `null` only on a 404 (camera not currently publishing — expected, not a failure); any other non-ok status or a network-level error now **throws** instead (code-review fix — previously collapsed into the same `null`, indistinguishable from "camera off"), which `runner.js`'s `tick()` already catches and routes to `onError()`.
- `perception/stub-backend.js` — `createStubDetector()`: deterministic fake detections (one "person" object with a slowly-oscillating bbox) — no real ML, see `runner.js`'s module doc.

**API routes:**
```
POST   /jobs           — create job; spawns subprocess (or no-op in test mode) for the default/ffmpeg type; plan.type: 'perception' starts a perception job instead (real in every mode, see above)
DELETE /jobs/:id       — stop job (kills the ffmpeg subprocess, or calls the perception runner's stop())
POST   /jobs/:id/caption — append caption payload to job record
GET    /stats          — running/total job counts
GET    /health         — status + workerId
GET    /_jobs          — debug: list all jobs (perception jobs also carry errorCount/lastError/lastErrorAt)
```

**Env vars:**
| Variable | Purpose |
|---|---|
| `WORKER_ID` | This worker's identifier (default `worker-0`) |
| `WORKER_AUTH_TOKEN` / `BACKEND_INTERNAL_TOKEN` | Optional auth token for all `/jobs` endpoints |

**Tests:** `test/daemon.basic.test.js`, `test/perception.test.js` (frame-source/stub-backend/runner unit tests + a `POST /jobs`+`DELETE /jobs/:id` route test with `fetch` mocked for the frame/callback URLs, plus a regression test for a permanently-failing callback: job stays `status:'running'` but `errorCount`/`lastError` on `GET /_jobs` and `worker_perception_job_errors_total` on `GET /metrics` both surface it).

## Test Coverage

~200 source LOC / ~150 test LOC — Moderate coverage, Low priority.

**Gaps:** `uploader.js`, S3 upload errors.

---

Dispatched to by `packages/lcyt-orchestrator` (see its `CLAUDE.md`) and, when `FFMPEG_RUNNER=worker`, directly by `packages/lcyt-backend/src/ffmpeg/worker-runner.js`.
