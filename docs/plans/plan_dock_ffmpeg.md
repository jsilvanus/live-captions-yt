---
id: plan/dock-ffmpeg
title: "FFmpeg Compute Containers → Distributed Hetzner Architecture"
status: pending
summary: "Migrate ffmpeg jobs from bare spawn() into Docker containers (phases 1–3), then distribute across Hetzner Cloud worker VMs via a Compute Orchestrator (phases 4–7)."
supersedes: "plan/rtmp (partially: execution model — replaces bare spawn() with Docker containers)"
---

# Plan: FFmpeg Compute Containers → Distributed Hetzner Architecture

**Date:** 2026-03-19 (revised 2026-03-20)  
**Version:** v3 — self-sufficient phases, distributed architecture
**Status:** Plan accepted. Ready to implement.
**Progress:** Implementation not started.

**Note:** Consolidated PR materials and platform artifacts prepared in branch `director/phase6-7-hetzner`. See [PR description](PR_phase6-7_hetzner.md) for validation and rollback instructions.

---

## Overview

This document covers two related evolutions of the LCYT compute layer, treated as a single continuous migration path:

1. **Phases 1–3 (local containers):** Move each ffmpeg job from a bare `spawn()` call inside the backend process into its own ephemeral Docker container. A `DockerFfmpegRunner` abstraction sits behind the `FFMPEG_RUNNER` env flag. The backend VM does double duty as both API server and container host.

2. **Phases 4–7 (distributed workers):** Evolve from single-node Docker into a **distributed compute system** on Hetzner Cloud VMs. A lightweight **Compute Orchestrator** manages worker VM lifecycle and job routing. A **Worker Daemon** on each VM owns the Docker socket. The backend becomes a pure API + RTMP ingest node with no Docker access.

> **Key constraints:** No Kubernetes. All coordination is plain HTTP on a Hetzner private network. `FFMPEG_RUNNER=spawn` (current behaviour) remains the default at every phase; operators opt in by changing env vars. Each phase is independently deployable.

---

## Current Architecture

The backend spawns up to five categories of ffmpeg child processes, all inside the same OS process and container:

| Manager | RTMP/input source | Purpose | ffmpeg mode |
|---|---|---|---|
| `HlsManager` | `rtmp://127.0.0.1:1935/live/<key>` | RTMP → video+audio HLS segments | stream copy |
| `RadioManager` | `rtmp://127.0.0.1:1935/live/<key>` | RTMP → audio-only HLS segments | AAC transcode |
| `PreviewManager` | `rtmp://127.0.0.1:1935/live/<key>` | RTMP → JPEG thumbnail (live) | frame extract |
| `RtmpRelayManager` | `rtmp://127.0.0.1:1935/stream/<key>` | RTMP fan-out relay (+ CEA-708 burn-in, per-slot transcode, DSK overlay) | stream copy / libx264 |
| `DskRenderer` | Playwright PNG frames piped to stdin | Chromium screenshot stream → RTMP | libx264 |

All processes share CPU, memory, and file descriptors with the main Node.js process. ffmpeg must be installed in the same image (`apt-get install ffmpeg`). A crash or OOM kill of any ffmpeg child is silent from the host's perspective.

Source files (all in `packages/lcyt-backend/src/`):
- `hls-manager.js` — `HlsManager`
- `radio-manager.js` — `RadioManager`
- `preview-manager.js` — `PreviewManager`
- `rtmp-manager.js` — `RtmpRelayManager`
- `packages/plugins/lcyt-dsk/src/renderer.js` — `DskRenderer`

---

## Target Architecture — Distributed (Phase 6+)

Three services replace the monolithic backend+ffmpeg model:

```
                ┌──────────────────────────────────────┐
                │  lcyt-backend (Node.js, unchanged API)│
                │  RTMP ingest · captions · HTTP API    │
                │  NO Docker socket · NO VM control     │
                └──────────────┬───────────────────────┘
                               │  HTTP  (job dispatch)
                ┌──────────────▼───────────────────────┐
                │  Compute Orchestrator (new Node.js)   │
                │  Job scheduler · Hetzner API client   │
                │  Worker registry · Scaling logic      │
                └──┬─────────────────────┬─────────────┘
        HTTP /jobs │                     │ HTTP /jobs
   ┌───────────────▼──────┐     ┌────────▼────────────┐
   │  Worker VM #1        │ ... │  Worker VM #N        │
   │  (warm pool)         │     │  (burst, Hetzner)    │
   │  lcyt-worker-daemon  │     │  lcyt-worker-daemon  │
   │  ── Docker socket ── │     │  ── Docker socket ── │
   │  ffmpeg containers   │     │  ffmpeg containers   │
   └──────────────────────┘     └─────────────────────┘
```

**Responsibility split:**

| Service | Owns | Does NOT own |
|---|---|---|
| `lcyt-backend` | RTMP ingest, captions API, HTTP routing, SQLite DB | Docker socket, VM lifecycle |
| `lcyt-orchestrator` | Worker registry, Hetzner API client, job queue, autoscaling | Caption logic, user auth |
| `lcyt-worker-daemon` | Docker socket, ffmpeg containers, local FIFO pipes | Hetzner API, DB |

> **Backend VM as warm-pool worker #1:** The VM running `lcyt-backend` + nginx-rtmp can simultaneously host Worker Daemon #1. The orchestrator registers it as `worker-0` (type: `warm`) and routes to it first. This keeps single-VM deployments viable at zero extra infra cost when introducing the distributed model.

---

## Intermediate Architecture — Single-VM Compute Containers (Phases 1–3)

During phases 1–3, the backend itself manages ephemeral containers via the Docker socket (or a socket proxy). The main image no longer needs ffmpeg.

```
┌───────────────────────────────────────────────────────┐
│  lcyt-backend (Node.js)                               │
│  ── no ffmpeg binary ──   ── docker socket proxy ──   │
└──────────────────────────────┬────────────────────────┘
                               │  docker run / docker stop
    ┌──────────────────────────▼──────────────────────────────┐
    │  ephemeral ffmpeg compute containers                    │
    │  ┌──────────────────┐   ┌────────────────────────────┐  │
    │  │ hls-<key>        │   │ relay-<key>                │  │
    │  │ lcyt-ffmpeg img  │   │ lcyt-ffmpeg img            │  │
    │  └──────────────────┘   └────────────────────────────┘  │
    │  ┌──────────────────┐   ┌────────────────────────────┐  │
    │  │ radio-<key>      │   │ dsk-<key>                  │  │
    │  │ lcyt-ffmpeg img  │   │ lcyt-dsk-renderer img      │  │
    │  └──────────────────┘   └────────────────────────────┘  │
    └─────────────────────────────────────────────────────────┘
                               │  shared Docker volumes
    ┌──────────────────────────▼──────────────────────────────┐
    │  nginx-rtmp  ·  HLS segments  ·  preview JPEG           │
    │  (shared named volumes: hls-video, hls-audio, previews) │
    └─────────────────────────────────────────────────────────┘
```

> In Phase 6+, the "docker run" arrow moves from the backend to the Worker Daemon. The backend only talks HTTP to the orchestrator.

---

## Pros and Cons

### Isolation and Stability (Pros)
- **Crash isolation.** A segfaulting or OOM-killed ffmpeg cannot affect the Node.js backend. Docker reports the exit code and can restart containers automatically.
- **Resource limits per job.** Each container carries `--cpus` and `--memory` limits. A greedy transcode job cannot starve caption delivery (the latency-critical path).
- **No shared FD leaks.** Child processes inherit open file descriptors from the parent. Container isolation eliminates this class of leak.

### Image Hygiene (Pros)
- **Smaller main image.** Backend image drops `ffmpeg` (and its 50–150 MB shared-library tree). `node:20-slim` + app code only.
- **Purpose-built ffmpeg image.** `lcyt-ffmpeg` pins a specific version, includes only required codecs (`libx264`, `aac`, `eia608`), and can use a static build. Codec upgrades no longer require rebuilding the backend.
- **Playwright/Chromium isolation.** The DSK renderer (Node.js + Playwright + Chromium + ffmpeg) moves into `lcyt-dsk-renderer`, separate from the backend.

### Scalability (Pros)
- **Per-container observability.** `docker stats`, cAdvisor, and Prometheus can track CPU/memory per job by container name (`hls-<key>`, `relay-<key>`) without backend code changes.
- **Horizontal compute scale.** Phase 6+ autoscales on Hetzner: warm-pool VMs absorb baseline load, burst VMs spin up on demand, cost tracks usage.
- **Multi-tenant safety.** Each API key's ffmpeg workload is isolated at the container level.

### Complexity (Cons)
- **Docker socket access (Phases 1–3 only).** The backend container must mount `/var/run/docker.sock` or use a socket proxy. Mounting the raw socket grants root-equivalent host access — mitigated by `tecnativa/docker-socket-proxy`. In Phase 6+ the socket moves exclusively to Worker Daemons.
- **Orchestration overhead.** Container name management, label-based cleanup, and error recovery add ~500–1000 LOC versus the current `spawn()` abstraction.
- **Networking change.** Containers cannot address nginx-rtmp via `127.0.0.1`. RTMP sources become `rtmp://nginx-rtmp:1935/...` within the Docker bridge network; all `*_LOCAL_RTMP` env vars must be updated. In Phase 6+, workers receive the RTMP address from the orchestrator job spec as `rtmp://<backend-private-ip>:1935/...`.

### Latency (Cons)
- **Container startup time.** Pre-pulled images start in 200–500 ms. Acceptable for RTMP relay and HLS (publisher connects first). Preview thumbnails may lose the first frame window.
- **CEA-708 stdin pipe.** `RtmpRelayManager` currently writes SRT cues directly to ffmpeg's stdin. Crossing a container boundary requires a named pipe, Unix socket, or file-drop approach. This is the single most technically involved change in the migration.
- **Backend → Orchestrator → Worker round-trip (Phase 6+).** `writeCaption` adds one HTTP hop on the private network. Expected round-trip < 5 ms on Hetzner private networking; acceptable for real-time STT delivery.

### Shared Volumes (Cons)
- **Phases 1–3:** HLS segments and preview JPEGs written by compute containers must be readable by the backend container. Both must mount the same named volume.
- **Phase 6+:** Named volumes cannot span VMs. Storage must migrate to S3 (or HTTP push) before running jobs on multi-VM workers (covered in Phase 5).
- **DSK overlay images.** Both backend and renderer containers need read access to `GRAPHICS_DIR`. In single-VM mode, a shared bind-mount suffices.

### Operational Gaps (Cons)
- **No Docker on bare metal.** cPanel, Passenger, or plain-`node` deployments cannot use compute containers. `spawn` fallback must always be preserved.
- **Image pull on first launch.** A readiness check at startup should verify the ffmpeg image is present before accepting RTMP publishes.
- **Debugging.** Container logs are no longer inline with backend stdout. Operators need `docker logs <name>` or a log aggregation pipeline.

---

## New Packages and Files

### `lcyt-ffmpeg` Docker image

```dockerfile
# images/lcyt-ffmpeg/Dockerfile
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["ffmpeg"]
```

For reproducible codec pinning, replace with a static build or a pinned package version. A separate `lcyt-dsk-renderer` image extends this with Node.js + Playwright + Chromium.

---

### Runner abstraction — `packages/lcyt-backend/src/ffmpeg/`

**`index.js`** — factory:

```js
// createFfmpegRunner({ runner: 'spawn'|'docker'|'worker', opts })
// Returns an object implementing the runner interface below.
export function createFfmpegRunner({ runner = 'spawn', ...opts }) { ... }
```

**`local-runner.js`** — wraps `child_process.spawn()`, preserving current behaviour:

```js
export class LocalFfmpegRunner {
  constructor({ args, env, name }) {}
  async start()          // spawn('ffmpeg', args, { env })
  async stop(timeoutMs)  // SIGTERM → SIGKILL after timeout
  get isRunning()        // process still alive
  get stdin()            // writable stream to ffmpeg stdin
  get stderr()           // readable stream from ffmpeg stderr
}
```

**`docker-runner.js`** — wraps Docker CLI (zero new npm dependencies):

```js
export class DockerFfmpegRunner {
  constructor({ image, name, args, env, volumes, network, cpus, memory }) {}
  async start()                    // docker run --rm --name <name> ...
  async stop(timeoutS = 3)         // docker stop --time <timeoutS> <name>
  async isRunning()                // docker inspect --format '{{.State.Running}}'
  get stdin()                      // stream to container stdin (for CEA-708 in Phase 3)
  get stderr()                     // stream from container stderr
  static async stopAll(prefix)     // docker ps --filter name=<prefix> | xargs docker stop
}
```

> `DockerFfmpegRunner` is preserved and reused verbatim inside the Worker Daemon (Phase 4+). The backend never instantiates it directly when `FFMPEG_RUNNER=worker`.

**`pipe-utils.js`** — FIFO management for CEA-708 (Phase 3):

```js
export async function createFifo(path)         // mkfifo, mkdir -p parent
export async function removeFifo(path)         // unlink
export function openFifoNonblocking(path)      // open O_WRONLY | O_NONBLOCK
export function writeCueWithTimeout(fd, cue, ms)  // non-blocking write + timeout guard
```

---

### Changes to existing managers

| Manager | File | Change |
|---|---|---|
| `HlsManager` | `src/hls-manager.js` | Replace `spawn('ffmpeg', args)` with `createFfmpegRunner({ runner, name: 'hls-<key>', ... })` |
| `RadioManager` | `src/radio-manager.js` | Same pattern |
| `PreviewManager` | `src/preview-manager.js` | Same pattern |
| `RtmpRelayManager` | `src/rtmp-manager.js` | Same + named-pipe support for CEA-708 (Phase 3) |
| `DskRenderer` | `plugins/lcyt-dsk/src/renderer.js` | Move to `lcyt-dsk-renderer` image; exchange PNG frames via Unix socket volume (Phase 5) |

The public APIs of all managers remain identical. Callers do not change.

---

### CEA-708 stdin pipe across container boundary

The relay container cannot share a process-level stdin with the backend. Three options evaluated:

**Option A: Named pipe on shared volume (recommended)**  
A FIFO is created at `/tmp/lcyt-cea/<key>.fifo` on a bind-mount shared between backend and relay container. The backend writes SRT cues to the FIFO; ffmpeg reads with `-i /pipes/<key>.fifo`. Managed by `pipe-utils.js`.

**Option B: Unix domain socket relay**  
Backend opens a Unix socket on a shared volume. A shim process inside the relay container proxies socket data to ffmpeg stdin. Adds a process but keeps ffmpeg argument list clean.

**Option C: File-based SRT drop (simplest, highest latency)**  
Per caption, the backend writes a `.srt` file and relaunches the relay container with `-vtt_subtitle` or filter injection. Only viable for infrequent, non-real-time captions.

**Phase 6+ note:** The FIFO always remains local to the Worker Daemon VM running the relay job. The backend sends caption text to the Worker Daemon via `POST /jobs/:id/caption`; the daemon writes to the local FIFO. No cross-VM pipe sharing is needed.

Option A is used in Phases 3–5; Option A remains in Phase 6+ (local to the worker).

---

### Docker Compose — single-VM (Phases 2–3)

```yaml
# docker-compose.yml
services:
  lcyt-backend:
    image: lcyt-backend:latest          # no ffmpeg binary
    volumes:
      - docker-socket-proxy:/var/run/docker.sock.proxy  # via socket proxy only
      - hls-video:/tmp/hls-video
      - hls-audio:/tmp/hls
      - previews:/tmp/previews
      - cea-pipes:/tmp/lcyt-cea
    environment:
      FFMPEG_RUNNER: docker
      FFMPEG_IMAGE: lcyt-ffmpeg:latest
      FFMPEG_NETWORK: lcyt-net
      HLS_LOCAL_RTMP: rtmp://nginx-rtmp:1935
      RADIO_LOCAL_RTMP: rtmp://nginx-rtmp:1935
      DSK_LOCAL_RTMP: rtmp://nginx-rtmp:1935
    depends_on: [docker-socket-proxy, nginx-rtmp]
    networks: [lcyt-net]

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      CONTAINERS: 1   # allow container CRUD
      POST: 1
    networks: [lcyt-net]

  nginx-rtmp:
    image: tiangolo/nginx-rtmp
    ports: ["1935:1935"]
    networks: [lcyt-net]

  # ffmpeg compute containers are ephemeral — launched by backend at runtime

volumes:
  hls-video:
  hls-audio:
  previews:
  cea-pipes:

networks:
  lcyt-net:
```

---

### Docker Compose — backend VM with warm-pool worker (Phase 4+)

```yaml
# docker-compose.yml (backend VM with worker-0)
services:
  lcyt-backend:
    image: lcyt-backend:latest
    environment:
      FFMPEG_RUNNER: worker
      COMPUTE_ORCHESTRATOR_URL: http://lcyt-orchestrator:4000
      BACKEND_INTERNAL_TOKEN: ${BACKEND_INTERNAL_TOKEN}
    networks: [lcyt-net]

  lcyt-orchestrator:
    image: lcyt-orchestrator:latest
    environment:
      ORCHESTRATOR_PORT: 4000
      HETZNER_API_TOKEN: ${HETZNER_API_TOKEN}
      HETZNER_NETWORK_ID: ${HETZNER_NETWORK_ID}
      HETZNER_SNAPSHOT_ID: ${HETZNER_SNAPSHOT_ID}
      WARM_POOL_SIZE: 1
      BACKEND_INTERNAL_TOKEN: ${BACKEND_INTERNAL_TOKEN}
    networks: [lcyt-net]

  lcyt-worker-daemon:       # this VM acts as warm-pool worker #1
    image: lcyt-worker-daemon:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - hls-video:/tmp/hls-video
      - hls-audio:/tmp/hls
      - previews:/tmp/previews
      - cea-pipes:/tmp/lcyt-cea
    environment:
      WORKER_TYPE: warm
      WORKER_ID: worker-0
      ORCHESTRATOR_URL: http://lcyt-orchestrator:4000
      MAX_JOBS: 4
      PORT: 5000
    networks: [lcyt-net]

  nginx-rtmp:
    image: tiangolo/nginx-rtmp
    ports: ["1935:1935"]
    networks: [lcyt-net]

volumes:
  hls-video:
  hls-audio:
  previews:
  cea-pipes:

networks:
  lcyt-net:
```

---

### Environment variables

**Backend (all phases):**

| Variable | Default | Purpose |
|---|---|---|
| `FFMPEG_RUNNER` | `spawn` | `spawn` · `docker` (Phases 2–3) · `worker` (Phase 4+) |
| `FFMPEG_IMAGE` | `lcyt-ffmpeg:latest` | Docker image for compute jobs |
| `FFMPEG_NETWORK` | `lcyt-net` | Docker bridge network name |
| `FFMPEG_VOLUME_PREFIX` | _(empty)_ | Named volume prefix (e.g. `lcyt_`) |
| `DOCKER_HOST` | _(socket default)_ | Override Docker daemon URL |

**Backend (Phase 4+ only):**

| Variable | Default | Purpose |
|---|---|---|
| `COMPUTE_ORCHESTRATOR_URL` | _(required when `worker`)_ | URL of the Compute Orchestrator |
| `BACKEND_INTERNAL_TOKEN` | _(required when `worker`)_ | Shared secret for backend→orchestrator calls |
| `ORCHESTRATOR_FALLBACK` | `spawn` | Runner to fall back to if orchestrator unreachable |

**Orchestrator:**

| Variable | Default | Purpose |
|---|---|---|
| `ORCHESTRATOR_PORT` | `4000` | HTTP listen port |
| `HETZNER_API_TOKEN` | _(required)_ | Hetzner Cloud API token |
| `HETZNER_NETWORK_ID` | _(required)_ | Private network ID for burst VMs |
| `HETZNER_SNAPSHOT_ID` | _(required)_ | Pre-baked worker VM snapshot ID |
| `HETZNER_SERVER_TYPE_WARM` | `cx21` | Warm-pool VM server type |
| `HETZNER_SERVER_TYPE_BURST` | `cx31` | Burst VM server type |
| `HETZNER_LOCATION` | `hel1` | Datacenter location |
| `WARM_POOL_SIZE` | `1` | Minimum warm workers always running |
| `BURST_COOLDOWN_MS` | `300000` | Idle time before destroying burst VM (5 min) |
| `BURST_QUEUE_LIMIT` | `20` | Max queued jobs before returning 503 |
| `MAX_CONCURRENT_BURST_CREATES` | `3` | Max parallel Hetzner VM creation calls |
| `ORCHESTRATOR_BACKOFF_MS` | `60000` | Hetzner rate-limit back-off duration |
| `BACKEND_INTERNAL_TOKEN` | _(required)_ | Auth token for backend→orchestrator |

### Phase 8 — MediaMTX integration

Introduce MediaMTX as an alternative ingest/distribution broker to complement our ffmpeg runners. Next steps:

- Add a developer `mediamtx` service to `docker-compose.yml` and a sample `docker/mediamtx.yml` configuration to validate RTMP -> HLS flows.
- Add env knobs (`RTMP_RELAY_TYPE=ffmpeg|mediamtx`, `MEDIAMTX_URL`, `MEDIAMTX_APP`) and update `packages/lcyt-backend/src/rtmp-manager.js` and `packages/plugins/lcyt-dsk/src/renderer.js` to support optional pushes into MediaMTX.
- Create a staging smoke test that pushes a short stream to MediaMTX and validates the HLS playlist; add Prometheus scraping and add runbook entries for HLS segment management.
- Roll out opt-in in staged phases; preserve the ffmpeg path as the safe rollback. Owners: infra + backend + dsk teams.


**Worker Daemon:**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP listen port |
| `WORKER_ID` | _(required)_ | Unique ID, e.g. `worker-0` or UUID |
| `WORKER_TYPE` | `warm` | `warm` or `burst` |
| `ORCHESTRATOR_URL` | _(required)_ | Orchestrator URL to self-register |
| `MAX_JOBS` | `4` | Max concurrent ffmpeg jobs on this VM |
| `FFMPEG_IMAGE` | `lcyt-ffmpeg:latest` | Docker image for jobs |

**Per-job resource defaults (override via orchestrator job spec):**

| Job type | `--cpus` | `--memory` |
|---|---|---|
| `preview` | `0.5` | `256m` |
| `radio` | `1.0` | `512m` |
| `hls` | `1.5` | `1024m` |
| `relay` | `3.0` | `6g` |
| `dsk` | `6.0` | `12g` |

**Storage (Phase 5+ only):**

| Variable | Purpose |
|---|---|
| `S3_ENDPOINT` | e.g. `https://fsn1.your-objectstorage.com` |
| `S3_BUCKET` | e.g. `lcyt-media` |
| `S3_ACCESS_KEY` | Object storage access key |
| `S3_SECRET_KEY` | Object storage secret key |
| `S3_REGION` | e.g. `eu-central` |

---

## Worker Daemon API (`packages/lcyt-worker-daemon`)

```
POST   /jobs              Start a new ffmpeg job
GET    /jobs              List running jobs { id, type, key, startedAt, cpuPct, memMb }
GET    /jobs/:id          Job status
DELETE /jobs/:id          Stop job gracefully (3 s SIGTERM → SIGKILL)
POST   /jobs/:id/caption  Inject a CEA-708 SRT cue into the job's local FIFO
GET    /stats             Capacity snapshot { cpuPct, memMb, jobCount, maxJobs }
GET    /health            Liveness { ok, version, workerType, workerId }
```

**`POST /jobs` body:**
```json
{
  "id":             "hls-<key>",
  "type":           "hls|radio|preview|relay|dsk",
  "apiKey":         "<key>",
  "rtmpSource":     "rtmp://<backend-private-ip>:1935/live/<key>",
  "rtmpTargets":    ["rtmp://..."],
  "hlsOutputPath":  "/tmp/hls-video/<key>",
  "hlsOutputUrl":   "s3://<bucket>/hls/<key>/",
  "previewOutputPath": "/tmp/previews/<key>",
  "relaySlots":     [...],
  "ceaEnabled":     false,
  "image":          "lcyt-ffmpeg:latest",
  "cpuLimit":       "1.5",
  "memLimit":       "512m"
}
```

**`POST /jobs/:id/caption` body:**
```json
{
  "text":        "Caption text here",
  "speechStart": 1234567890123,
  "timestamp":   "2026-03-20T09:00:00.000"
}
```

The daemon writes the cue to `/tmp/lcyt-cea/<id>.fifo` using non-blocking I/O with a configurable timeout. If the FIFO is full or the reader is stalled, the cue is skipped and an error is logged; the stream continues unaffected.

---

## Compute Orchestrator API (`packages/lcyt-orchestrator`)

The orchestrator is the single HTTP interface the backend uses for all compute operations in Phase 4+.

```
POST   /compute/jobs                  Dispatch a job → { jobId, workerId, workerUrl }
DELETE /compute/jobs/:jobId           Stop a job on its assigned worker
POST   /compute/jobs/:jobId/caption   Forward CEA-708 cue to assigned worker
GET    /compute/jobs                  List all active jobs across all workers
GET    /compute/workers               Worker registry with liveness status
POST   /compute/workers/register      Worker self-registration on boot
DELETE /compute/workers/:id           Deregister + optionally destroy  VM
GET    /compute/health                Orchestrator liveness
```

**Job scheduling algorithm:**

```
on POST /compute/jobs:
  1. find warm workers with jobCount < maxJobs         → assign immediately
  2. else find burst workers with jobCount < maxJobs   → assign immediately
  3. else if burst quota not exceeded:
       create burst VM (Hetzner API) → enqueue job pending VM ready
  4. else (BURST_QUEUE_LIMIT exceeded):
       respond 503 { retryAfterMs }

on idle burst worker (jobCount === 0, idle > BURST_COOLDOWN_MS):
  → DELETE Hetzner server via API

never auto-reassign: relay and HLS jobs (RTMP stream continuity requires stable socket)
```

**Heartbeat monitoring:** orchestrator polls `GET /health` on every registered worker every 10 s. After 3 consecutive misses, the worker is marked `degraded`. New jobs are not routed to degraded workers. An alert fires immediately.

---

## Hetzner Provisioning (Phase 6)

### VM snapshot preparation (one-time manual step)

1. Boot a fresh Hetzner `cx21` VM (Debian 12).
2. Install Docker Engine; set `"live-restore": true` in `/etc/docker/daemon.json`.
3. Pre-pull images: `docker pull lcyt-ffmpeg:latest && docker pull lcyt-dsk-renderer:latest`.
4. Deploy `lcyt-worker-daemon` as a systemd service set to `WantedBy=multi-user.target`.
5. Create cloud-init userdata for the snapshot boot. We provide a tested template at
  `packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml` — copy or reference this file when creating burst VMs via the Hetzner console or API.
6. Snapshot the VM in the Hetzner console → copy snapshot ID to `HETZNER_SNAPSHOT_ID`.

### Burst VM creation flow (automated by orchestrator)

```
1. POST https://api.hetzner.cloud/v1/servers
   {
     "name": "lcyt-worker-burst-<uuid>",
     "server_type": "cx31",
     "image": { "id": <HETZNER_SNAPSHOT_ID> },
     "networks": [<HETZNER_NETWORK_ID>],
     "user_data": <cloud-init below>,
     "labels": { "managed-by": "lcyt-orchestrator", "type": "burst" }
   }

2. Poll /v1/servers/:id until status === "running" (~20–30 s).

3. lcyt-worker-daemon starts via systemd on boot.
   → Worker POSTs: POST /compute/workers/register
     { id, type, privateIp, maxJobs, version }

4. Orchestrator marks worker ready → dispatches queued jobs.
```

### Cloud-init for burst VMs

```yaml
#cloud-config
write_files:
  - path: /etc/lcyt-worker.env
    permissions: "0600"
    content: |
      WORKER_ID=<uuid>
      WORKER_TYPE=burst
      ORCHESTRATOR_URL=http://<orchestrator-private-ip>:4000
      MAX_JOBS=8
      PORT=5000
      FFMPEG_IMAGE=lcyt-ffmpeg:latest
runcmd:
  - systemctl start lcyt-worker-daemon
```

---

## Storage Architecture (Phase 5)

### Problem
Docker named volumes cannot span VMs. HLS segments and preview JPEGs written by ffmpeg on remote worker VMs must be served by the backend. Two patterns are supported:

### Option A: S3-compatible object storage (recommended for multi-VM)

Each job spec includes `hlsOutputUrl: s3://<bucket>/hls/<key>/`. The Worker Daemon runs a sidecar uploader that watches the local output directory with `inotifywait` and pushes completed segments to S3.

ffmpeg has no native S3 output — uploads are always external. The backend's HLS and preview routes either redirect to a CDN URL or proxy from S3.

**Compatible providers:** Hetzner Object Storage, AWS S3, Cloudflare R2 (all S3-compatible).

When single-VM shared volumes are still in use (Phase 2–3), S3 env vars are ignored and local paths are used unchanged.

### Option B: Worker HTTP push (single-VM or low-volume multi-VM)

After each segment is complete, the Worker Daemon PUTs segments to `PUT /internal/hls/<key>/<segment>` on the backend. The backend writes them to `HLS_ROOT`. Preview is pushed to `PUT /internal/preview/<key>`. Does not require object storage but does not scale under many concurrent streams.

### Migration gating

`FFMPEG_RUNNER=worker` with multi-VM routing requires Phase 5 S3 storage to be operational. If `S3_ENDPOINT` is not set when `FFMPEG_RUNNER=worker`, orchestrator warns at startup and restricts all routing to `worker-0` (the backend VM itself).

---

## Failure Handling

| Failure | Detection | Mitigation |
|---|---|---|
| Worker VM loses heartbeat | 3 × 10 s poll misses | Mark worker `degraded`; stop routing; alert operator |
| Active RTMP relay on lost worker | Worker degraded while relay running | Do NOT auto-migrate (stream continuity); operator must reconnect publisher; log warning |
| Active HLS/radio/preview on lost worker | Worker degraded while non-RTMP job running | Orchestrator re-dispatches to healthy worker after 30 s grace period |
| Burst VM fails to start | Hetzner API error or timeout > 120 s | Retry once; if fails, return 503 to queued jobs; log Hetzner error body |
| Worker daemon crash (VM alive) | Heartbeat fails | Stop routing new jobs to VM; operator reboots or reprovisioned VM from snapshot |
| Orchestrator crash | Backend HTTP error to `COMPUTE_ORCHESTRATOR_URL` | Backend falls back to `ORCHESTRATOR_FALLBACK` runner (default `spawn`); alerts operator |
| FIFO stalled / reader gone (CEA-708) | `writeCueWithTimeout` exceeds deadline | Write skipped; error logged; stream continues; next cue attempted normally |
| S3 segment upload fails | S3 PUT returns error | Log error; segment lost; ffmpeg continues; HLS player skips segment silently; next segment attempted |
| Hetzner API rate limit | 429 from API | Back off `ORCHESTRATOR_BACKOFF_MS`; queue VM creation; log warning |
| Docker image not present on worker | `docker run` exits 125 | Pre-pull check at Worker Daemon startup; log error `IMAGE_MISSING`; reject jobs until resolved |

---

## Implementation Phases

Each phase below is **independently deployable** and leaves the system fully operational. No phase requires the next phase to be started or complete.

---

### Phase 1 — Runner Abstraction (no behaviour change)

**Goal:** Introduce the abstraction layer without touching runtime behaviour.

**Changes:**
- Create `packages/lcyt-backend/src/ffmpeg/index.js` (`createFfmpegRunner` factory).
- Create `packages/lcyt-backend/src/ffmpeg/local-runner.js` (wraps current `spawn()` logic extracted from `PreviewManager` first, as the lowest-risk manager).
- Refactor `PreviewManager` to use `createFfmpegRunner({ runner: 'spawn', ... })`.

**Deployable:** Yes — default `FFMPEG_RUNNER=spawn`. No Docker dependency. No behaviour change.

**Acceptance criteria:**
- All existing tests pass unchanged.
- `PreviewManager` integration smoke test passes with `FFMPEG_RUNNER=spawn`.
- `local-runner` unit tests cover `start`, `stop`, `isRunning`, stdin/stderr stream passthrough.

**Rollback:** Revert `PreviewManager` to direct `spawn()` call; delete the ffmpeg/ directory.

---

### Phase 2 — Docker Runner for Stateless Managers

**Goal:** Run HLS, radio, and preview jobs in ephemeral containers. Keep relay (`RtmpRelayManager`) and DSK (`DskRenderer`) on `spawn` until CEA-708 pipe is handled (Phase 3).

**Changes:**
- Implement `packages/lcyt-backend/src/ffmpeg/docker-runner.js` (`DockerFfmpegRunner`).
- Refactor `HlsManager`, `RadioManager`, `PreviewManager` to use `createFfmpegRunner`.
- Create `images/lcyt-ffmpeg/Dockerfile` and build + push `lcyt-ffmpeg:latest`.
- Add `docker-compose.yml` with named volumes (`hls-video`, `hls-audio`, `previews`), `lcyt-net` Docker network, and `tecnativa/docker-socket-proxy` sidecar.
- Update `HLS_LOCAL_RTMP`, `RADIO_LOCAL_RTMP`, `DSK_LOCAL_RTMP` defaults to `rtmp://nginx-rtmp:1935`.
- Add startup check: `docker image inspect $FFMPEG_IMAGE` — warn if absent, do not block.
- Gate `FFMPEG_RUNNER=docker` behind env flag; `spawn` remains default.

**Deployable:** Yes — single-VM Docker-based compute for stateless jobs. `RtmpRelayManager` and `DskRenderer` continue on `spawn`.

**Acceptance criteria:**
- `FFMPEG_RUNNER=docker`: HLS containers start at `POST /live`, produce segments under `hls-video` volume, are accessible via `GET /stream-hls/:key/*`.
- Container names follow `hls-<key>`, `radio-<key>`, `preview-<key>` patterns.
- `docker stop --time 3` issued on graceful shutdown; no orphan containers after restart.
- Resource limits (`--cpus 1.5 --memory 1g` for HLS) confirmed via `docker inspect`.
- Integration test with `TEST_DOCKER=1` guard runs in CI staging only.

**Rollback:** Set `FFMPEG_RUNNER=spawn` and restart backend. No volume cleanup required (segments remain, HLS serving continues).

---

### Phase 3 — RtmpRelayManager + CEA-708 Named Pipe

**Goal:** Relay jobs run in containers with real-time CEA-708 caption injection via named pipe (FIFO).

**Changes:**
- Implement `packages/lcyt-backend/src/ffmpeg/pipe-utils.js` (FIFO lifecycle + non-blocking write with timeout).
- Refactor `RtmpRelayManager` to use `createFfmpegRunner` + fifo path for CEA injection.
- Mount CEA pipe volume (`cea-pipes:/tmp/lcyt-cea`) in backend and relay containers.
- ffmpeg relay command: add `-i /tmp/lcyt-cea/<key>.fifo` (or `pipe:0`) alongside RTMP input.

**Deployable:** Yes — production-ready single-VM Docker compute for all job types except DSK renderer.

**Acceptance criteria:**
- `RtmpRelayManager` container starts and ingests RTMP.
- `POST /captions` with CEA-enabled session results in 608/708 data visible in captured TS stream.
- Non-blocking FIFO write: if reader is stalled, write times out in < 50 ms; stream continues.
- On relay container crash, manager logs exit code and attempts restart per existing reconnect logic.

**Rollback:** `FFMPEG_RUNNER=spawn` (relay falls back to direct stdin), or set `CEA=0` to disable injection.

---

### Phase 4 — Worker Daemon + Orchestrator (single-VM, opt-in)

**Goal:** Introduce the distributed compute API without requiring Hetzner VMs. The backend VM acts as `worker-0`; the orchestrator runs on the same VM. Zero additional infra cost.

**Changes:**
- Create `packages/lcyt-worker-daemon/` — lightweight Node.js HTTP server implementing the Worker Daemon API (see above). Reuses `DockerFfmpegRunner` and `pipe-utils.js` from Phase 3.
- Create `packages/lcyt-orchestrator/` — single-node skeleton: worker registry (in-memory), job routing table, heartbeat monitor. Hetzner API client stubbed / behind `HETZNER_API_TOKEN` guard.
- Implement `WorkerFfmpegRunner` in `packages/lcyt-backend/src/ffmpeg/worker-runner.js` — routes `start`, `stop`, `writeCaption` calls to the orchestrator HTTP API.
- Wire `FFMPEG_RUNNER=worker` → `WorkerFfmpegRunner` in all managers.
- Update `docker-compose.yml` with `lcyt-orchestrator` and `lcyt-worker-daemon` services (see Compose snippet above).

**Deployable:** Yes — full single-VM worker pipeline. No Hetzner account required. `WARM_POOL_SIZE=1` (local worker).

**Acceptance criteria:**
- `FFMPEG_RUNNER=worker`: all job types (HLS, radio, preview, relay) dispatched via orchestrator to `worker-0` and running as Docker containers.
- `GET /compute/workers` shows `worker-0` with `status: ready`.
- Caption injection (`POST /compute/jobs/:id/caption`) reaches the worker FIFO end-to-end.
- Orchestrator liveness endpoint responds; heartbeat loop fires every 10 s.
- Graceful shutdown: `DELETE /compute/jobs/:id` drains all jobs on backend SIGTERM.

**Rollback:** Set `FFMPEG_RUNNER=spawn` (or `docker`) and stop `lcyt-orchestrator` + `lcyt-worker-daemon` containers.

---

### Phase 5 — S3 Storage + Multi-VM Routing Prerequisite

**Goal:** Decouple HLS/preview storage from node-local volumes so multiple worker VMs can write output consumed by the backend.

**Changes:**
- Implement S3 segment uploader in Worker Daemon: `inotifywait`-driven upload of each finished `.ts`/`.vtt` segment and playlist to `$S3_BUCKET/hls/<key>/`.
- Preview JPEG uploaded to `$S3_BUCKET/previews/<key>/latest.jpg` on each frame.
- Backend HLS route: when `S3_ENDPOINT` set, redirect to S3 CDN URL (or proxy via signed URL).
- Backend preview route: same redirect/proxy pattern.
- Add `S3_*` env vars to orchestrator job spec propagation.

**Deployable:** Yes — can be run with `FFMPEG_RUNNER=spawn`, `docker`, or `worker`. S3 integration is only activated when `S3_ENDPOINT` is set.

**Acceptance criteria:**
- Segments appear in S3 bucket within 1 s of ffmpeg writing them locally.
- HLS playback from S3 URLs works end-to-end.
- Uploader error rate < 1% under simulated 10-stream load test.
- When `S3_ENDPOINT` unset, local volume path used unchanged (backward compatible).

**Rollback:** Unset `S3_ENDPOINT` to revert to local volumes (Phase 2–4 setup). Any uploaded segments remain in S3 but backend serves from local path.

---

### Phase 6 — Distributed Hetzner Workers (autoscaling)

**Goal:** Orchestrator provisions and destroys burst Hetzner VMs on demand. Warm-pool always available; burst VMs spun up when no warm capacity remains.

**Prerequisite:** Phase 5 S3 storage operational. `HETZNER_API_TOKEN` and snapshot ID configured.

**Changes:**
- Implement Hetzner Cloud API client in orchestrator: `createServer`, `deleteServer`, `listServers`.
- Implement autoscaling loop: poll job queue depth + worker loads; create burst VMs; destroy idle burst VMs after `BURST_COOLDOWN_MS`.
- Worker self-registration: on VM boot `lcyt-worker-daemon` calls `POST /compute/workers/register` with private IP.
- Cloud-init template for burst VMs (see Hetzner Provisioning section above).
- Implement Hetzner API rate-limit back-off (`429 → wait ORCHESTRATOR_BACKOFF_MS`).
- Add Prometheus metrics: `lcyt_burst_vm_created_total`, `lcyt_burst_vm_destroyed_total`, `lcyt_worker_heartbeat_missing`.

**Deployable:** Yes — operates with `WARM_POOL_SIZE=1` (local worker only) until Hetzner credentials are configured. Hetzner scaling activates only when `HETZNER_API_TOKEN` is present.

**Acceptance criteria:**
- Under simulated high load, orchestrator provisions a burst VM within 60 s.
- Burst VM self-registers; queued jobs dispatched immediately.
- Idle burst VM destroyed after `BURST_COOLDOWN_MS`.
- `GET /compute/workers` reflects live registry including burst VMs.
- On Hetzner API failure, orchestrator retries once then returns 503; no crash.

**Rollback:** Remove `HETZNER_API_TOKEN` from orchestrator env; existing burst VMs drain naturally; orchestrator routes only to warm pool workers. Manual VM cleanup via Hetzner console.

---

### Phase 7 — Autoscaling, Production Hardening, and Runbooks

**Goal:** Finalise autoscaling behaviour and operational hardening for Hetzner burst workers, publish an operator runbook, and document rollback steps and env variables required for safe production operations.

This phase assumes Phase 5 (S3-compatible storage) and Phase 6 (Hetzner snapshot + worker registration) are in place. The orchestrator now manages creation, readiness checks, registration, and destruction of burst VMs and exposes Prometheus metrics and health endpoints for monitoring and alerting.

**Key behaviour (implemented):**
- Orchestrator only creates a burst VM when warm workers are saturated and queued jobs exceed `BURST_QUEUE_LIMIT` policy.
- Burst VM creation uses the snapshot ID configured in `HETZNER_SNAPSHOT_ID` and boots with cloud-init from `packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml` (the orchestrator passes this as `user_data`).
- Orchestrator enforces a rate limit on Hetzner API calls: on HTTP 429 the orchestrator backs off for `ORCHESTRATOR_BACKOFF_MS` and requeues VM creation attempts.
- Worker readiness is gated: the orchestrator waits for a successful `POST /compute/workers/register` from the worker VM and liveness `GET /health` before dispatching any jobs.
- Idle burst VMs are destroyed after `BURST_COOLDOWN_MS`; destruction increments `lcyt_burst_vm_destroyed_total`.

**Environment variables (production-critical additions):**
- `HETZNER_API_TOKEN` (required to enable burst VM creation)
- `HETZNER_SNAPSHOT_ID` (ID of the pre-baked worker snapshot)
- `HETZNER_NETWORK_ID` (private network for worker VMs)
- `ORCHESTRATOR_BACKOFF_MS` (429 back-off window)
- `MAX_CONCURRENT_BURST_CREATES` (throttle parallel creates)

Set these on the orchestrator process or container. The orchestrator will refuse to create burst VMs unless `HETZNER_API_TOKEN` and `HETZNER_SNAPSHOT_ID` are non-empty.

**Runbooks & operator playbook (summary):**
- Pre-snapshot checklist and cloud-init usage: see `docs/hetzner_runbook.md` (new file). The runbook references `packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml` and exact CLI snippets for snapshot and VM lifecycle operations.
- Boot & test a VM locally (operator steps): boot from snapshot, verify `docker images` contains `lcyt-ffmpeg:latest`, confirm `systemctl status lcyt-worker-daemon`, and `curl http://<worker-private-ip>:5000/health`.
- How to take a snapshot: stop worker daemon, ensure docker image pulls complete, capture snapshot via Hetzner console or `hcloud` CLI (example in runbook).

**Rollback steps (operator actions):**
- Revert orchestrator to safe mode: set `ORCHESTRATOR_FALLBACK=spawn` and restart the orchestrator service. This causes the backend to route to the local `spawn` runner if the orchestrator is unreachable.
- Mark workers degraded manually: `DELETE /compute/workers/:id` with `?mark=degraded` (or via the orchestrator UI / API). Degraded workers are excluded from scheduling and are shown in Prometheus/Grafana dashboards.
- De-register a worker (manual decommission): `DELETE /compute/workers/:id?destroy=false` to remove registration but keep the VM; use `?destroy=true` to also issue a Hetzner server DELETE. Exact API calls are in `docs/hetzner_runbook.md`.

**Monitoring & alerts:**
- Critical alerts: `worker_heartbeat_missing` → page on 3 consecutive misses; `burst_vm_create_failures_total` → alert when > 3 in 1 min; `s3_upload_error_rate` → warn when > 1%.
- Dashboard links and Prometheus queries are provided in `docs/hetzner_runbook.md`.

**Troubleshooting (short):**
- Hetzner 429 on VM create: check `ORCHESTRATOR_BACKOFF_MS` and `MAX_CONCURRENT_BURST_CREATES`; wait and retry; consult `orchestrator` logs for the API response body.
- Image missing on worker: `docker images` will show `IMAGE_MISSING`; run `docker pull lcyt-ffmpeg:latest` and restart `lcyt-worker-daemon`.
- Registration timeout: tail worker logs (`journalctl -u lcyt-worker-daemon`) and orchestrator logs (`journalctl -u lcyt-orchestrator`); ensure `HETZNER_NETWORK_ID` allows the worker private IP to reach orchestrator.

**Acceptance criteria:**
- Orchestrator provisions a burst VM within configured SLA (observed median < 60 s) and dispatches queued jobs after worker registration.
- Operator runbook reproduces snapshot → VM boot → worker registration steps successfully in staging.
- Rollback scenario exercised: setting `ORCHESTRATOR_FALLBACK=spawn` returns system to single-VM operation without data loss for existing streams.

**Next steps (post-Phase 7):**
- Complete the DSK renderer containerisation (moved to a follow-on Phase 8) with the same worker-runner model.
- Expand runbooks to include runbook playbooks for on-call rotation and incident postmortems.
---

### Phase 8 — Hardening, Monitoring, and Runbooks

**Goal:** Production-grade observability and operational documentation for all deployed phases.

**Prometheus metrics (backend + worker daemon):**
- `lcyt_ffmpeg_jobs_started_total{type, key}` — job start counter
- `lcyt_ffmpeg_job_restarts_total{type, key}` — unexpected restart counter
- `lcyt_ffmpeg_job_duration_seconds{type}` — histogram
- `lcyt_worker_heartbeat_missing{worker_id}` — gauge (0/1)
- `hls_playlist_age_seconds{key}` — time since last segment write
- `lcyt_burst_vm_created_total` / `lcyt_burst_vm_destroyed_total`

**Grafana dashboards:**
- Per-job CPU/memory via cAdvisor labels `container_name=~hls-.*`
- Worker registry liveness heatmap
- S3 upload error rate

**CI gates:**
- `TEST_DOCKER=1` — Docker integration tests (Phases 2–3). Run only in CI staging environment.
- `TEST_HETZNER=1` — Hetzner provisioning tests (Phase 6). Run only in dedicated staging environment with live Hetzner credentials.
- All other tests run without Docker or cloud dependencies.

**Runbooks required before each phase goes to production:**
- **Worker drain:** gracefully stop routing to a worker; wait for jobs to finish; deregister.
- **Relay failover:** manual publisher reconnect steps when relay worker is lost.
- **FIFO stuck recovery:** identify stalled consumer; restart relay container; re-enable caption injection.
- **Hetzner VM reprovision:** steps to rebuild worker snapshot after ffmpeg version upgrade.
- **S3 backfill:** steps to recover missing segments from partial upload failure.

---

## Decision Matrix

| Criterion | Current (spawn) | Phases 1–3 (docker, single VM) | Phases 4–6 (worker, distributed) |
|---|---|---|---|
| Setup complexity | Low | Medium | High |
| Backend image size | Large (ffmpeg included) | Small | Small |
| Crash isolation | None | Full (container) | Full (VM + container) |
| Per-job resource limits | None | Yes (Docker flags) | Yes (Docker flags + VM type) |
| CEA-708 real-time | Native `stdin` | Named pipe (FIFO) on shared volume | Local FIFO on worker VM |
| RTMP address changes needed | No | Yes (container DNS) | Yes (private IP from job spec) |
| Works without Docker | Yes (default) | Fallback to `spawn` | Fallback to `spawn` |
| Observability | Backend logs only | `docker logs`, cAdvisor | Per-worker logs + orchestrator dashboard |
| Container start latency | < 100 ms | +200–500 ms | +200–500 ms + < 5 ms private net |
| Bare-metal / cPanel compatible | Yes | No | No |
| Compute autoscaling | None | None | Automatic warm pool + burst |
| Storage architecture | Local FS | Shared Docker named volumes | S3 (multi-VM) or shared volumes (single-VM) |
| Backend Docker socket exposure | Yes (raw) | Yes (via proxy only) | No (socket on worker only) |
| Backend VM as worker #1 | N/A | N/A | Yes, zero extra cost |

---

## Recommendation and Migration Path

1. **Start with Phase 1** — runner abstraction is a pure refactor with no operational risk. Establishes the factory pattern used in all later phases.
2. **Phase 2–3 together** — Docker backend for stateless managers and CEA-708 pipe can be delivered as a single PR once Phase 1 is stable. Defer CEA-708 if relay complexity is blocking.
3. **Phase 4 on same VM** — introduce orchestrator + worker daemon with `WARM_POOL_SIZE=1` on the existing backend VM. Validates the whole dispatch path before any Hetzner billing or VM risk.
4. **Phase 5 before Phase 6** — S3 storage must be operational and tested before routing jobs to multiple VMs. Do not enable multi-VM routing without this.
5. **Phase 6 with a single burst VM** — run a controlled test: provision one burst VM manually, verify it self-registers and receives jobs. Then enable autoscaling.
6. **Phase 7 (DSK)** is optional and orthogonal; schedule when the DSK renderer image is needed for isolation or multi-tenant use.
7. **Phase 8 (hardening)** — each phase should incorporate its metrics and runbook before being declared production-ready. Do not defer all monitoring to the end.

**Docker socket security (Phases 2–3):** Use `tecnativa/docker-socket-proxy` exposing only `POST /containers/create`, `POST /containers/{id}/start`, `POST /containers/{id}/stop`, and `DELETE /containers/{id}`. In Phase 4+ the concern disappears from the backend entirely.

**Authentication (Phase 4+):** `BACKEND_INTERNAL_TOKEN` is a plain shared secret suitable for a private network. For production, rotate it on a schedule or replace with short-lived tokens (e.g. HMAC-signed JWTs with 5-minute expiry) on the `backend → orchestrator → worker` call path.

**Incremental migration path:**
```
spawn (today, default, always fallback)
  └─► FFMPEG_RUNNER=docker  (Phases 2–3, single VM)
        └─► FFMPEG_RUNNER=worker  (Phase 4, backend VM as worker-0)
              └─► Hetzner burst adds workers  (Phase 6, multi-VM autoscaling)
                    └─► S3 storage required for multi-VM  (Phase 5, prerequisite)
```
