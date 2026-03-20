# Plan: Compute (FFmpeg) Docker → Distributed Hetzner Architecture

**Date:** 2026-03-19 (revised 2026-03-20)
**Status:** Draft (v2 — distributed architecture)

---

## Overview

This document tracks two related evolutions of the LCYT compute layer:

1. **Phase 1–5 (original plan, preserved):** Move each ffmpeg job from a bare `spawn()` call into its own ephemeral Docker container, introduced as a `DockerFfmpegRunner` abstraction behind `FFMPEG_RUNNER`.

2. **Phase 6+ (new, this revision):** Evolve from a single-node Docker model into a **distributed compute system** using Hetzner Cloud VMs. A new **Compute Orchestrator** service manages worker VM lifecycle and job scheduling. A **Worker Daemon** running on each VM owns the Docker socket and executes containers locally. The backend becomes a pure API server with no Docker access.

> **Key constraint:** No Kubernetes at this stage. All coordination is simple HTTP. The system must remain debuggable and support incremental rollout.

---

## Current Architecture

The backend spawns up to five distinct categories of ffmpeg child processes, all inside the same container:

| Manager | Source | Purpose | Mode |
|---|---|---|---|
| `HlsManager` | `rtmp://127.0.0.1:1935/live/<key>` | RTMP → video+audio HLS | stream copy |
| `RadioManager` | `rtmp://127.0.0.1:1935/live/<key>` | RTMP → audio-only HLS | AAC transcode |
| `PreviewManager` | `rtmp://127.0.0.1:1935/live/<key>` | RTMP → JPEG thumbnail | frame extract |
| `RtmpRelayManager` | `rtmp://127.0.0.1:1935/stream/<key>` | RTMP fan-out relay (+ CEA-708, per-slot transcode, DSK overlay) | stream copy / libx264 |
| `DskRenderer` | Playwright PNG frames on stdin | Screenshot stream → RTMP | libx264 |

All processes share CPU, memory, and filesystem with the main Node.js process. ffmpeg must be installed in the same image (`apt install ffmpeg`).

---

## Target Architecture (Distributed, Phase 6+)

> **NEW SECTION**

Three services replace the monolithic backend+ffmpeg model:

```
                ┌──────────────────────────────────────┐
                │  lcyt-backend (Node.js, unchanged API)│
                │  RTMP ingest · captions · HTTP API    │
                │  NO Docker socket · NO VM control     │
                └──────────────┬───────────────────────┘
                               │  HTTP  (job requests)
                ┌──────────────▼───────────────────────┐
                │  Compute Orchestrator (new Node.js)  │
                │  Job scheduler · Hetzner API client  │
                │  Worker registry · Scaling logic     │
                └──┬───────────────────┬───────────────┘
        HTTP /jobs │                   │ HTTP /jobs
   ┌───────────────▼──┐         ┌──────▼──────────────┐
   │  Worker VM #1    │   ...   │  Worker VM #N        │
   │  (warm pool)     │         │  (burst, Hetzner)    │
   │  Worker Daemon   │         │  Worker Daemon       │
   │  ── Docker ──    │         │  ── Docker ──        │
   │  ffmpeg ctnrs    │         │  ffmpeg ctnrs        │
   └──────────────────┘         └─────────────────────┘
```

**Responsibility split:**

| Service | Owns | Does NOT own |
|---|---|---|
| Backend | RTMP ingest, captions API, HTTP routing, DB | Docker socket, VM lifecycle |
| Compute Orchestrator | Worker registry, Hetzner API, job queue, scaling | Caption logic, user auth |
| Worker Daemon | Docker socket, ffmpeg containers, local FIFO | Hetzner API, DB |

> **Backend-VM as warm pool #1:** The VM running `lcyt-backend` + nginx-rtmp can simultaneously host Worker Daemon #1. This keeps single-VM deployments viable while the distributed model is introduced. The orchestrator simply registers the local VM as `worker-0` (type: `warm`) and targets it first. No additional infra cost for small deployments.

---

## Proposed Architecture: Compute Containers (Phase 1–5, original)

Each ffmpeg job runs in a dedicated, **ephemeral Docker container** launched by the backend. The backend retains control (start, stop, monitor) via the Docker SDK (`dockerode` or Docker CLI subprocess). The main Node.js image no longer needs ffmpeg installed.

```
┌─────────────────────────────────┐
│  lcyt-backend (Node.js)         │
│  ── no ffmpeg binary ──         │
│  ── docker SDK / CLI ──         │
└────────────┬────────────────────┘
             │  docker run / rm
    ┌────────▼────────────────────────────────┐
    │  ffmpeg compute containers               │
    │  ┌──────────────┐  ┌──────────────────┐ │
    │  │ hls-<key>    │  │ relay-<key>      │ │
    │  │ ffmpeg image │  │ ffmpeg image     │ │
    │  └──────────────┘  └──────────────────┘ │
    │  ┌──────────────┐  ┌──────────────────┐ │
    │  │ radio-<key>  │  │ dsk-<key>        │ │
    │  │ ffmpeg image │  │ ffmpeg image     │ │
    │  └──────────────┘  └──────────────────┘ │
    └─────────────────────────────────────────┘
             │  shared volumes / network
    ┌────────▼────────────────────┐
    │  nginx-rtmp + HLS storage   │
    │  (shared Docker volumes)    │
    └─────────────────────────────┘
```

> **Note (Phase 6+):** In the distributed model the backend no longer launches containers directly. This diagram applies only to Phase 1–5 (single-node mode) or when the backend VM doubles as Worker #1. In Phase 6+ the "docker run" arrow originates from the Worker Daemon, not the backend.

---

## Pros

### Isolation and Stability
- **Crash isolation.** A runaway or crashing ffmpeg process cannot take down the Node.js backend. Currently a segfault or OOM-killed ffmpeg silently dies; with containers, Docker can report and restart it.
- **Resource limits per job.** Each container gets its own `--cpus` and `--memory` constraint. A greedy transcode job cannot starve caption delivery, which is the latency-critical path.
- **No shared file descriptor leak.** Child processes inherit open file descriptors from the parent. Container isolation eliminates this entirely.

### Image Hygiene
- **Smaller main image.** The backend image drops `ffmpeg` (and its shared-library tree) from the apt install step. `node:20-slim` + app code only. This can shave 50–150 MB off the image and reduces the attack surface.
- **Purpose-built ffmpeg image.** A separate `lcyt-ffmpeg` base image can pin a specific ffmpeg version, include only the codecs needed (`libx264`, `aac`, `eia608`), or use a static build (e.g. `linuxserver/ffmpeg`, `jrottenberg/ffmpeg`, or a custom compile). Codec upgrades no longer require rebuilding the whole backend.
- **Playwright/Chromium isolation.** The DSK renderer already pairs ffmpeg with Playwright. That combination can live in its own `lcyt-dsk-renderer` image, completely separate from the backend.

### Scalability
- *(Phase 1–5)* **Horizontal scale for compute.** On a Kubernetes or Docker Swarm setup, compute containers can be scheduled on dedicated worker nodes with GPU or high-CPU profiles, while the backend runs on a low-cost coordinator node.
- *(Phase 6+)* **Hetzner-native autoscaling.** Warm-pool VMs absorb baseline load. Burst VMs spawn on demand and auto-destroy when idle. Compute cost scales with actual usage.
- **Multi-tenant safety.** Each API key's ffmpeg workload is fully isolated. One tenant's transcode cannot interfere with another's HLS segments or preview files at the process level.
- **Per-container observability.** `docker stats`, Prometheus cAdvisor, or Grafana can track CPU/memory per job by container name (`hls-<key>`, `relay-<key>`) without any instrumentation changes to the backend code.

### Operational
- **Cleaner lifecycle management.** Docker handles PID 1, signal forwarding, and orphan cleanup. The current SIGTERM → SIGKILL pattern (3 s timeout) is re-implemented natively by `docker stop --time 3`.
- **Reproducible local dev.** A developer without ffmpeg installed locally can still run the full stack via `docker compose up`.

---

## Cons

### Complexity
- **Docker socket access.** *(Phase 1–5 only)* The backend container needs access to the Docker socket (`/var/run/docker.sock`) or a Docker-in-Docker sidecar. Mounting the socket gives the backend root-equivalent access to the host — a significant security consideration. *(Phase 6+: Docker socket moves to Worker Daemon; backend has no socket access.)*
- **Orchestration overhead.** Managing container names, labels, cleanup of exited containers, and error recovery adds ~500–1000 LOC compared to the current `spawn()` abstraction.
- **Networking.** Compute containers need to reach nginx-rtmp (localhost loopback today). In a container network, RTMP sources become `rtmp://nginx-rtmp:1935/...` instead of `rtmp://127.0.0.1:1935/...`. All `*_LOCAL_RTMP` and `*_RTMP_*` env vars need updating and the nginx-rtmp container must be on the same Docker network.
- *(Phase 6+)* **Cross-VM coordination.** The orchestrator must track worker liveness, handle VM startup failures, and re-route jobs if a worker VM disappears.

### Latency
- **Container startup time.** `docker run` for a pre-pulled image takes roughly 200–500 ms on a typical host. For RTMP relay and HLS, this is acceptable — streams start after the publisher connects anyway. For the DSK renderer, which currently starts once at backend launch, this startup latency is less of a concern if we pre-start it. For preview thumbnails, the first frame may be delayed by the startup window.
- **CEA-708 stdin pipe.** The current relay manager writes SRT cues to ffmpeg's stdin. With a compute container, stdin piping across container boundaries requires either a Unix socket volume mount, a named pipe on a shared volume, or switching to a file-based SRT drop folder. This is the single most technically involved change.
- *(Phase 6+)* **Backend → Orchestrator → Worker round-trip.** Caption write path (`writeCaption` → Worker Daemon) adds one HTTP hop on the private network. Expected latency < 5 ms on Hetzner private network; acceptable for real-time STT delivery.

### Shared Volumes
- *(Phase 1–5)* **HLS and preview output.** HLS segments, playlists, and JPEG thumbnails written by ffmpeg containers must be readable by the backend container for HTTP serving. Both must mount the same Docker volume or bind-mount path. This is straightforward with Docker Compose named volumes but requires explicit configuration.
- *(Phase 6+)* **No shared filesystem across VMs.** Volumes cannot span Hetzner VMs. See "Storage Changes" section below for the replacement strategy.
- **Image files (DSK overlays).** The DSK renderer reads image files uploaded via the backend. Both containers need read access to `GRAPHICS_DIR`.

### Operational Gaps
- **No Docker on bare metal.** Operators running the backend as a plain `node` process (cPanel, VPS without Docker) cannot use compute containers. The spawn-based managers must remain as a fallback mode.
- **Docker image pull time.** First launch on a new host requires pulling the ffmpeg image. Pull must succeed before any compute job can start. This needs a readiness check at startup.
- **Debugging is harder.** Logs from compute containers are no longer inline in the backend stdout stream. Operators need `docker logs <container>` or a log aggregation setup.

---

## Scope of Changes (Phase 1–5)

### New: `lcyt-ffmpeg` Docker image

A minimal image with only what ffmpeg jobs need:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["ffmpeg"]
```

Alternatively, base on a static ffmpeg build to pin codec versions independently of the OS package.

A separate `lcyt-dsk-renderer` image adds Node.js + Playwright + Chromium on top of the ffmpeg base (or builds it independently).

---

### New: `DockerFfmpegRunner` module

A new module in `packages/lcyt-backend/src/` (or `packages/plugins/lcyt-rtmp/src/`) that wraps `dockerode` (or `child_process.spawn('docker', [...])` for zero new dependencies):

```js
// src/docker-runner.js
export class DockerFfmpegRunner {
  constructor({ image, name, args, env, volumes, network, stdioMode }) {}
  async start() {}          // docker run --rm --name <name> ...
  async stop(timeoutS = 3)  // docker stop --time <timeoutS> <name>
  async isRunning()         // docker inspect --format '{{.State.Running}}' <name>
  get stdin() {}            // stream to container stdin (for CEA-708)
  get stderr() {}           // stream from container stderr (for logging)
  static async stopAll(prefix) {} // docker ps --filter name=<prefix> + stop all
}
```

> **Phase 6+:** `DockerFfmpegRunner` is preserved but moves inside the Worker Daemon. The backend/orchestrator never instantiates it directly. The Worker Daemon uses it unchanged.

The four existing managers (`HlsManager`, `RadioManager`, `PreviewManager`, `RtmpRelayManager`) swap their internal `spawn()` call for a `DockerFfmpegRunner` instance. Their public API stays identical.

---

### Changes to existing managers

| Manager | Change |
|---|---|
| `HlsManager` | Replace `spawn('ffmpeg', args)` with `DockerFfmpegRunner({ name: 'hls-<key>', ... })` |
| `RadioManager` | Same pattern |
| `PreviewManager` | Same pattern |
| `RtmpRelayManager` | Same + solve stdin pipe for CEA-708 (see below) |
| `DskRenderer` | Move to `lcyt-dsk-renderer` image; backend sends PNG frames via Unix socket volume or HTTP chunked upload |

---

### CEA-708 stdin pipe solution

Three options for feeding SRT cues to the relay container:

**Option A: Named pipe on shared volume (simplest)**
Create a FIFO at `/tmp/lcyt-cea/<key>.fifo` on a shared bind-mount. Backend writes SRT cues to the FIFO; ffmpeg container reads from it as `-i /pipes/<key>.fifo`. Requires `mkfifo` and the volume mount on both sides.

**Option B: Unix socket relay**
Backend opens a Unix socket on a shared volume. A tiny shim process inside the ffmpeg container reads from the socket and writes to ffmpeg stdin. Adds a process but keeps ffmpeg stdin clean.

**Option C: Restart on caption (lowest complexity, highest latency)**
For each caption, tear down and re-spawn the relay container with the caption baked into a static subtitle file. Only viable for low-frequency caption injection (not real-time STT).

Option A is the recommended approach for real-time CEA-708.

> **Phase 6+ note:** The FIFO always remains **local to the worker VM** running the relay job. The Worker Daemon creates and owns the FIFO; the backend sends caption text to the Worker Daemon via HTTP POST, and the daemon writes to the local FIFO. No cross-VM pipe sharing.

---

### Docker Compose changes

```yaml
services:
  lcyt-backend:
    image: lcyt-backend:latest          # no ffmpeg
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Docker socket (Phase 1-5 only)
      - hls-video:/tmp/hls-video        # shared with ffmpeg containers
      - hls-audio:/tmp/hls
      - previews:/tmp/previews
      - cea-pipes:/tmp/lcyt-cea         # CEA-708 named pipes
    environment:
      FFMPEG_IMAGE: lcyt-ffmpeg:latest
      FFMPEG_RUNNER: docker             # "docker" | "spawn" (fallback)
      DOCKER_NETWORK: lcyt-net
    networks:
      - lcyt-net

  nginx-rtmp:
    image: tiangolo/nginx-rtmp          # or custom build
    networks:
      - lcyt-net

  # ffmpeg containers are ephemeral — not declared here, launched by backend

volumes:
  hls-video:
  hls-audio:
  previews:
  cea-pipes:

networks:
  lcyt-net:
```

> **Phase 6+:** The backend service no longer mounts the Docker socket. A `lcyt-worker-daemon` service is added to the same Compose stack on the backend VM to act as warm-pool worker #1. See "Worker Daemon Compose snippet" in the Phase 6 section.

---

### Environment variables (new, Phase 1–5)

| Variable | Default | Purpose |
|---|---|---|
| `FFMPEG_RUNNER` | `spawn` | `spawn` (current behaviour), `docker` (local containers), or `worker` (Phase 6+ distributed) |
| `FFMPEG_IMAGE` | `lcyt-ffmpeg:latest` | Docker image to use for compute jobs |
| `FFMPEG_NETWORK` | `lcyt-net` | Docker network to attach compute containers to |
| `FFMPEG_VOLUME_PREFIX` | _(empty)_ | Named volume prefix for HLS/preview mounts (e.g. `lcyt_`) |
| `DOCKER_HOST` | _(default socket)_ | Override Docker daemon address (for remote Docker or DinD) |

`FFMPEG_RUNNER=spawn` keeps all existing behaviour; operators opt in to Docker by changing the env var.

---

### nginx-rtmp address change

All internal RTMP references (`127.0.0.1:1935`) must become the nginx-rtmp container's DNS name within the Docker network. Suggested env var names already exist:

- `HLS_LOCAL_RTMP` → `rtmp://nginx-rtmp:1935`
- `RADIO_LOCAL_RTMP` → `rtmp://nginx-rtmp:1935`
- `DSK_LOCAL_RTMP` → `rtmp://nginx-rtmp:1935`

> **Phase 6+:** Worker VMs connect to nginx-rtmp on the backend VM via private network IP. The orchestrator passes the RTMP ingest address to each worker job at dispatch time as `rtmp://<backend-private-ip>:1935/...`. Workers have no DNS entry for `nginx-rtmp`; they receive the address from the job spec.

No code changes needed in the managers themselves — only `.env` / job spec overrides.

---

## Implementation Phases

### Phase 1: Abstraction layer (no behaviour change)
- Introduce `DockerFfmpegRunner` with a `spawn` backend under the hood.
- Refactor `HlsManager`, `RadioManager`, `PreviewManager` to use it.
- All tests pass unchanged. No Docker dependency yet.

### Phase 2: Docker backend for stateless managers
- Implement the `docker` backend in `DockerFfmpegRunner`.
- Wire `HlsManager`, `RadioManager`, `PreviewManager` to it.
- Add Docker Compose volumes and network.
- Integration test: start an HLS stream with `FFMPEG_RUNNER=docker`.

### Phase 3: RtmpRelayManager + CEA-708 (Option A: named pipe)
- Add named-pipe creation/cleanup to `RtmpRelayManager`.
- Mount `/tmp/lcyt-cea` volume in both backend and relay containers.
- Write SRT cues to FIFO; ffmpeg reads from `/pipes/<key>.fifo`.
- Test: real-time caption injection end-to-end.

### Phase 4: DSK renderer
- Build `lcyt-dsk-renderer` image (Node.js + Playwright + Chromium + ffmpeg).
- Backend launches renderer containers per API key; PNG frames transmitted via Unix socket volume.
- Retire `PLAYWRIGHT_DSK_CHROMIUM` env var (renderer image owns Chromium path).

### Phase 5: Hardening
- Add `docker image inspect` at startup to verify `FFMPEG_IMAGE` is present; warn if missing.
- Add container-level resource limits (`--cpus`, `--memory`) configurable per manager type.
- Implement container label cleanup (`docker container prune --filter label=lcyt.job`) on graceful shutdown.
- Update `CLAUDE.md` with new architecture and env vars.

---

### Phase 6: Compute Orchestrator + Worker Daemon (NEW)

> **Goal:** Decouple the backend from Docker. Move all container execution to dedicated Hetzner VMs. The backend calls the orchestrator API instead of spawning containers directly.

#### 6a: Worker Daemon (`packages/lcyt-worker-daemon`) — NEW service

A lightweight Node.js HTTP service that runs on each worker VM. It owns the Docker socket and executes `DockerFfmpegRunner` jobs locally.

##### Worker Daemon API

```
POST   /jobs              Start a new ffmpeg job
GET    /jobs              List running jobs (id, type, key, startedAt, cpuPct, memMb)
GET    /jobs/:id          Get job status
DELETE /jobs/:id          Stop a job (graceful, 3 s timeout)
POST   /jobs/:id/caption  Write a CEA-708 SRT cue to the local FIFO for job :id
GET    /stats             Worker capacity snapshot (cpuPct, memMb, jobCount, maxJobs)
GET    /health            Liveness probe ({ ok: true, version, workerType })
```

**`POST /jobs` request body:**

```json
{
  "id": "hls-<key>",
  "type": "hls" | "radio" | "preview" | "relay" | "dsk",
  "apiKey": "<key>",
  "rtmpSource": "rtmp://<backend-private-ip>:1935/live/<key>",
  "rtmpTargets": ["rtmp://..."],
  "hlsOutputUrl": "s3://<bucket>/hls/<key>/",
  "previewOutputUrl": "https://<backend>/internal/preview/<key>",
  "relaySlots": [...],
  "ceaEnabled": false,
  "image": "lcyt-ffmpeg:latest",
  "cpuLimit": "1.5",
  "memLimit": "512m"
}
```

**`POST /jobs/:id/caption` request body:**

```json
{
  "text": "Caption text",
  "speechStart": 1234567890123,
  "timestamp": "2026-03-20T09:00:00.000"
}
```

The daemon writes the cue to the job's local FIFO (`/tmp/lcyt-cea/<id>.fifo`).

##### Worker Daemon Compose snippet (backend VM as warm pool #1)

```yaml
services:
  lcyt-worker-daemon:
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
    networks:
      - lcyt-net
```

#### 6b: Compute Orchestrator (`packages/lcyt-orchestrator`) — NEW service

A Node.js service that acts as the single point of contact for job scheduling and Hetzner VM lifecycle management.

##### Compute Orchestrator Responsibilities

1. **Worker registry** — maintains a list of active workers with their address, type (`warm`/`burst`), capacity (`maxJobs`), current load (`jobCount`), and liveness timestamp.
2. **Job scheduling** — assigns incoming job requests to workers using a best-fit strategy (lowest load first, warm workers preferred).
3. **Hetzner VM lifecycle** — uses the Hetzner Cloud API to create/destroy burst VMs when demand exceeds warm-pool capacity.
4. **Autoscaling** — watches queue depth and worker load; spins up burst VMs when no warm capacity remains; destroys idle burst VMs after a configurable cooldown.
5. **Job routing table** — maps `(type, apiKey)` → `(workerId, jobId)` so the backend can route subsequent requests (e.g. `writeCaption`) to the correct worker.
6. **Heartbeat monitoring** — polls `GET /health` on all workers every 10 s; marks a worker as `degraded` after 3 missed beats; triggers job re-assignment for non-RTMP jobs.

##### Compute Orchestrator API (called by backend)

```
POST   /compute/jobs             Dispatch a new job → returns { jobId, workerId, workerUrl }
DELETE /compute/jobs/:jobId      Stop a job
POST   /compute/jobs/:jobId/caption  Forward a CEA-708 cue to the assigned worker
GET    /compute/jobs             List all active jobs (across all workers)
GET    /compute/workers          List worker registry
GET    /compute/health           Orchestrator liveness
```

##### Scaling logic

```
on job request:
  1. find warm workers with available capacity → assign
  2. if none: find burst workers with capacity → assign
  3. if none: spin up new burst VM (Hetzner API) → enqueue job for when VM is ready
  4. if queue too long (> BURST_QUEUE_LIMIT): reject with 503 + retry-after

on worker idle (no jobs, type=burst, idle > BURST_COOLDOWN_MS):
  → POST /compute/workers/:id/destroy → Hetzner delete VM

never reassign: RTMP relay and HLS jobs (stream continuity)
```

##### New environment variables (orchestrator)

| Variable | Default | Purpose |
|---|---|---|
| `ORCHESTRATOR_PORT` | `4000` | HTTP port |
| `HETZNER_API_TOKEN` | _(required)_ | Hetzner Cloud API token |
| `HETZNER_NETWORK_ID` | _(required)_ | Private network ID to attach burst VMs to |
| `HETZNER_SNAPSHOT_ID` | _(required)_ | Pre-baked VM snapshot ID (has Docker + ffmpeg image pre-pulled) |
| `HETZNER_SERVER_TYPE_WARM` | `cx21` | Server type for warm-pool VMs |
| `HETZNER_SERVER_TYPE_BURST` | `cx31` | Server type for burst VMs |
| `HETZNER_LOCATION` | `hel1` | Datacenter location |
| `WARM_POOL_SIZE` | `1` | Minimum warm worker VMs always running |
| `BURST_COOLDOWN_MS` | `300000` | Idle time before destroying a burst VM (5 min) |
| `BURST_QUEUE_LIMIT` | `10` | Maximum queued jobs before returning 503 |
| `WORKER_MAX_JOBS_WARM` | `4` | Max concurrent jobs per warm VM |
| `WORKER_MAX_JOBS_BURST` | `8` | Max concurrent jobs per burst VM |
| `BACKEND_INTERNAL_TOKEN` | _(required)_ | Shared secret for backend → orchestrator calls |

##### New environment variables (backend, Phase 6+)

| Variable | Default | Purpose |
|---|---|---|
| `FFMPEG_RUNNER` | `spawn` | Set to `worker` to route jobs to orchestrator |
| `COMPUTE_ORCHESTRATOR_URL` | _(required when `worker`)_ | URL of the Compute Orchestrator |
| `BACKEND_INTERNAL_TOKEN` | _(required when `worker`)_ | Shared secret (same as orchestrator) |

---

### Phase 7: Hetzner Provisioning Flow (NEW)

#### VM snapshot preparation (one-time)

1. Boot a fresh Hetzner `cx21` VM (Debian 12).
2. Install Docker Engine, configure daemon with `live-restore: true`.
3. Pre-pull ffmpeg images: `docker pull lcyt-ffmpeg:latest && docker pull lcyt-dsk-renderer:latest`.
4. Install `lcyt-worker-daemon` as a systemd service (starts on boot).
5. Create Hetzner snapshot → record `HETZNER_SNAPSHOT_ID`.

#### Burst VM creation flow (orchestrator)

```
1. POST https://api.hetzner.cloud/v1/servers
   { name: "lcyt-worker-burst-<uuid>",
     server_type: "cx31",
     image: { id: <HETZNER_SNAPSHOT_ID> },
     networks: [<HETZNER_NETWORK_ID>],
     user_data: "<full YAML from cloud-init snippet below>",  # sets WORKER_ID, ORCHESTRATOR_URL, etc.
     labels: { managed-by: "lcyt-orchestrator", type: "burst" } }

2. Poll server status until running (~20-30 s).

3. Worker daemon auto-starts via systemd on boot.
   → Worker daemon POSTs to orchestrator: POST /compute/workers/register
     { id, type, privateIp, maxJobs, version }

4. Orchestrator marks worker as ready; dispatches queued jobs.
```

#### Cloud-init snippet for burst VMs

```yaml
#cloud-config
write_files:
  - path: /etc/lcyt-worker.env
    content: |
      WORKER_ID=<uuid>
      WORKER_TYPE=burst
      ORCHESTRATOR_URL=http://<orchestrator-private-ip>:4000
      MAX_JOBS=8
      PORT=5000
runcmd:
  - systemctl start lcyt-worker-daemon
```

---

### Phase 8: Storage Changes (NEW — critical for cross-VM)

> **Problem:** Docker named volumes cannot span VMs. HLS segments and preview JPEG files written by ffmpeg on worker VMs must be served by the backend. Two options:

#### Option A: Object storage (recommended for production)

- Each worker job receives `hlsOutputUrl: s3://<bucket>/hls/<key>/` and `previewOutputUrl: s3://<bucket>/previews/<key>/latest.jpg` in the job spec.
- ffmpeg writes segments to a local temp directory; a sidecar script (or `inotifywait`-driven uploader) streams finished segments to S3 using the AWS CLI or an S3 client library. Note: ffmpeg has no native S3 output — uploads are always handled by an external process or script that reads from the local output directory.
- The backend's HLS and preview routes proxy or redirect to the S3 bucket (or serve directly from a CDN).
- **Compatible S3 providers:** Hetzner Object Storage (S3-compatible), AWS S3, Cloudflare R2.

```
New env vars (backend + orchestrator):
  S3_ENDPOINT      e.g. https://fsn1.your-objectstorage.com
  S3_BUCKET        e.g. lcyt-media
  S3_ACCESS_KEY
  S3_SECRET_KEY
  S3_REGION        e.g. eu-central
```

#### Option B: Worker HTTP push (simpler, lower infra cost)

- After writing HLS segments to local disk, the Worker Daemon pushes them to the backend via `PUT /internal/hls/<key>/<segment>`.
- The backend stores them in its local `HLS_ROOT` directory.
- Preview JPEG is pushed similarly to `PUT /internal/preview/<key>`.
- Suitable for small deployments; does not scale well under many concurrent streams.

#### Phase 1–5 (single VM) compatibility

When `FFMPEG_RUNNER=spawn` or `FFMPEG_RUNNER=docker` (single VM), shared Docker volumes continue to work unchanged. Storage migration is only required when switching to `FFMPEG_RUNNER=worker`.

---

### Phase 9: Failure Handling (NEW)

| Failure scenario | Detection | Mitigation |
|---|---|---|
| Worker VM loses heartbeat | Orchestrator misses 3 × 10 s polls | Mark worker `degraded`; stop routing new jobs to it; alert operator |
| Active RTMP relay job on lost worker | Worker marked degraded while relay running | Log warning; do NOT auto-migrate (stream continuity); operator must reconnect publisher |
| Active HLS/radio/preview job on lost worker | Same as above | Orchestrator re-dispatches to a healthy worker after 30 s grace period |
| Burst VM fails to start | Hetzner API error or timeout (> 120 s) | Retry once; if fails, return 503 for queued jobs; log Hetzner error |
| Worker daemon crash (VM still running) | Heartbeat fails | Orchestrator stops routing new jobs to that worker; operator uses Hetzner API (reboot action) or recreates the VM from snapshot as a last resort |
| Orchestrator crash | Backend cannot reach orchestrator | Backend falls back to `FFMPEG_RUNNER=spawn` if `COMPUTE_ORCHESTRATOR_URL` is unreachable (requires graceful degradation flag `ORCHESTRATOR_FALLBACK=spawn`) |
| FIFO stalled (CEA-708) | Writer blocks on FIFO write | Daemon enforces non-blocking write with timeout; logs error; caption skipped (stream continues) |
| HLS segment upload fails (S3) | S3 PUT returns error | ffmpeg job continues; segment is lost; next segment will succeed; HLS player skips lost segment silently |
| Hetzner API rate limit | 429 from Hetzner API | Orchestrator backs off 60 s; queues VM creation; logs warning |

---

## Decision Matrix

| Criterion | Current (spawn) | Compute containers (Phase 1–5) | Distributed Hetzner (Phase 6+) |
|---|---|---|---|
| Setup complexity | Low | Medium–High | High |
| Backend image size | Large (ffmpeg included) | Small | Small |
| Crash isolation | None | Full (container) | Full (VM + container) |
| Per-job resource limits | None | Yes (Docker flags) | Yes (Docker flags + VM type) |
| CEA-708 stdin pipe | Native | Named pipe (FIFO) | FIFO local to worker VM |
| RTMP address changes | None | Yes (container DNS) | Yes (private network IP) |
| Works without Docker | Yes | Only with `spawn` fallback | Only with `spawn` fallback |
| Observability | Backend logs only | `docker logs`, cAdvisor | Per-worker `docker logs` + orchestrator dashboard |
| First-frame latency | < 100 ms | +200–500 ms container start | +200–500 ms + ~5 ms network |
| Bare-metal / cPanel compatible | Yes | No | No |
| Horizontal scale | None | Manual | Automatic (warm pool + burst) |
| Storage architecture | Local FS | Shared Docker volumes | S3 or HTTP push |
| Backend-VM as worker #1 | N/A | N/A | Yes (supported, optional) |

---

## Recommendation

1. **Now:** Implement Phase 1 (abstraction layer) to prepare for both paths without coupling to either.
2. **Next:** Phase 2–3 (Docker backend) in parallel with the next Docker deployment iteration. Defer CEA-708 (Phase 3) until Phase 2 is stable.
3. **When scaling is needed:** Phase 6 (Compute Orchestrator + Worker Daemon) is the next architectural step after Phase 5 is stable. Start with the backend VM acting as warm-pool worker #1 (zero additional infra cost) to validate the orchestrator API before provisioning dedicated worker VMs.
4. **Storage:** Defer Phase 8 (S3) until at least two worker VMs are needed simultaneously. Phase 6 with a single warm-pool worker on the backend VM can continue using shared volumes.

**Docker socket security** (Phase 1–5): Address at deployment by using a socket proxy (`tecnativa/docker-socket-proxy`) that exposes only `POST /containers/create`, `POST /containers/{id}/start`, `POST /containers/{id}/stop`, and `DELETE /containers/{id}`. In Phase 6+ this concern disappears from the backend entirely (Docker socket is only on worker VMs, not the backend).

**Incremental migration path:**
```
spawn (today)
  └─► docker / single-VM (Phase 1–5)
        └─► worker=backend-VM (Phase 6, warm pool #1, zero extra cost)
              └─► worker=dedicated VMs (Phase 6, full Hetzner autoscaling)
                    └─► S3 storage (Phase 8, multi-VM concurrent streams)
```
