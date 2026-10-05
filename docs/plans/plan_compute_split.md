---
title: Compute Split — lcyt-compute Library + Job Contract v1
status: phase 1 implemented; the fffleet runner (`FFMPEG_RUNNER=fleet`) implemented 2026-10-04; see "Status after fffleet"
design doc: https://claude.ai/code/artifact/a512e3d1-5ef2-40ce-9b1c-60d1c5aaa5f2
---

# Compute split: `lcyt-compute` and job contract v1

The full proposal (findings, architecture diagram, contract, Saarnavideo usage, open decisions) is the design doc linked above. This file is the in-repo record of the plan and its status.

## Why

- A worker job that ends by itself is never reported: the orchestrator decrements `jobCount` only on `DELETE`, and `WorkerFfmpegRunner` never emits `close`, so `rtmp-manager.js` keeps a dead remote relay as running.
- `lcyt-worker-daemon` depended on all of `lcyt-backend` for the runners. `lcyt-backend` is not on npm, so the standalone `npm install` (CI `standalone-tests`) and the worker Docker build resolved `"lcyt-backend": "*"` against the registry and got a 404.
- Three dispatch clients and three env names for one orchestrator (`COMPUTE_ORCHESTRATOR_URL`, `ORCHESTRATOR_URL` twice); see `CONSIDER.md`.
- Only long-running stream jobs exist: no exit status, progress, outputs or timeouts, so finite work (Saarnavideo renders) cannot be dispatched.
- Workers assume shared Docker volumes with the backend; a Hetzner burst VM has none. `cloud-init-worker.yaml` still installs a placeholder daemon.
- Orchestrator state is in memory; a restart forgets running jobs.
- `hls-manager`, `stt-manager`, `music-manager`, `pcm-extractor` and the DSK renderer spawn ffmpeg directly and cannot be offloaded.

## Contract v1 (summary)

One job resource at `/v1/jobs`, served identically by the orchestrator and every worker:

- **Spec:** `{ contract: 1, id, kind: 'stream'|'batch', type: 'ffmpeg'|'perception', owner, purpose, priority, class, requires[], resources, timeoutMs, inputs[{name, uri}], outputs[{name, uri, contentType}], ffmpeg: { args with {{input:x}}/{{output:x}} placeholders, durationMs }, callbackUrl }`. Client-chosen `id` makes submission idempotent (same spec 200, different spec 409).
- **States:** `queued → assigned → staging → running → uploading → succeeded`, plus `failed` and `cancelled`; final exactly once, with `exitCode`, `error.code`, outputs and the stderr tail.
- **Events:** `{ jobId, seq, at, state, progress: { pct, outTimeMs, speed, fps }, error?, outputs? }`, worker → orchestrator → `callbackUrl`, or SSE at `GET /v1/jobs/:id/events`.
- **API:** `POST /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/events`, `DELETE /v1/jobs/:id`, `POST /v1/jobs/:id/stdin` (replaces the caption FIFO endpoint), `GET /v1/capabilities`. Control plane: `/v1/workers/register`, `/heartbeat` (carries running job ids for reconciliation), `/events`.
- **Auth:** `Authorization: Bearer`, consumer and worker token roles; old headers accepted until the pre-v1 routes go.
- **Classes and concurrency:** each job has a `class` (e.g. `render`, `upload`, `relay`) and workers declare slots per class, so a long upload never blocks renders.

## Phases

1. **Extract the library** — done. `packages/lcyt-compute` holds the runners, FIFO helpers and accounting; `lcyt-backend/ffmpeg*` re-export; worker daemon and `lcyt-rtmp` import `lcyt-compute`; worker Dockerfile builds from the repo root.
2. One dispatch client used by `WorkerFfmpegRunner` and `perception-manager.js`; `COMPUTE_URL`/`COMPUTE_TOKEN` with the old names as deprecated aliases; settings registry updated.
3. Contract v1 routes beside the old ones; events and heartbeat reconciliation (fixes the capacity leak and the missing `close`).
4. Batch jobs: input staging (`file:`, `s3:`, `https:`), output upload, `-progress` parsing, timeouts, capability matching.
5. Durable orchestrator store (SQLite) behind an interface.
6. Saarnavideo adopts the client behind `RENDER_EXECUTOR=local|compute`.
7. Move the direct `spawn('ffmpeg')` sites onto the runner; remove pre-v1 routes.


## Status after fffleet (2026-10-04)

The orchestrator and worker became the generic library [fffleet](https://github.com/jsilvanus/fffleet) (contract v1, batch and stream jobs, S3 staging, logins, autoscaling with Hetzner/Docker/process pools). That covers phases 2 to 5 of the list above for ffmpeg work:

- **LCYT side:** `FFMPEG_RUNNER=fleet` (`FleetFfmpegRunner` in `lcyt-compute`) submits stream jobs to fffleet. It reports the end of a job that finishes by itself (the old runner never emitted `close`) and exposes ffmpeg's stdin as a Writable for CEA-708 cues. No URL or an unreachable fleet means ffmpeg runs on this machine.
- **Saarnavideo side:** `RENDER_EXECUTOR=fffleet`, batch jobs with S3 staging.
- **Direct ffmpeg sites (2026-10-05):** STT (rtmp/whep input), music analysis (rtmp input), HLS-segment PCM decoding and the DSK renderer now start ffmpeg through `spawnFfmpeg` (`lcyt-compute/ffmpeg`), which is `child_process.spawn` unless `FFMPEG_RUNNER=fleet`, then an fffleet stream job with a ChildProcess look-alike (`stdout` carries raw PCM from the worker via fffleet's `stdout: true`, `stdin` frames and EOF via `/stdin` and `/stdin/close`). Needs fffleet >= 1.1. Remote workers must reach the stream URLs in the arguments (RTMP base, DSK RTMP target), so `HLS_LOCAL_RTMP` etc. cannot be `127.0.0.1` there. `stderr` is empty on the fleet. The HLS manager stays local on purpose: it re-muxes the local RTMP ingest (`-c copy`) into files this machine serves, so a remote worker would only add a round trip. The ffprobe/`-version` probes stay local too.
- **Perception jobs (2026-10-05):** they are plain Node (poll a frame URL, run the stub detector, POST detections back), so fffleet runs them as a job type: `lcyt-compute/perception/fffleet-executor` (`{ type: 'perception', run }`) is loaded by an fffleet worker with `FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor` (fffleet-worker >= 1.1; the worker then claims `type:perception`). `createPerceptionManager` submits `{ kind: 'stream', type: 'perception', perception: plan }` through the shared fleet client when `FFFLEET_URL` is set; with no fleet URL it keeps using `ORCHESTRATOR_URL` / `WORKER_DAEMON_URL`. The runner, frame source and stub detector moved from `lcyt-worker-daemon/src/perception/` to `lcyt-compute/src/perception/` (the daemon imports them from there). `lcyt-worker-daemon` and `lcyt-orchestrator` can be retired once no deployment sets `FFMPEG_RUNNER=worker`, `WORKER_DAEMON_URL` or `ORCHESTRATOR_URL`; that removal is a separate step. The job spec carries the callback `internalToken`, so the fleet's job API must stay private.
- **Was still on `lcyt-worker-daemon` and `lcyt-orchestrator`:** perception jobs (not ffmpeg), until fffleet has a non-ffmpeg executor or they move into the backend. `FFMPEG_RUNNER=worker` stays until then and is deprecated for ffmpeg.
- **Not done:** the direct `spawn('ffmpeg')` sites (`hls-manager`, `stt-manager`, `music-manager`, `pcm-extractor`, DSK renderer) are still local.
