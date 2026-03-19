# Plan: Compute (FFmpeg) Docker Approach

**Date:** 2026-03-19
**Status:** Draft

---

## Overview

Currently, all ffmpeg processes are spawned as direct child processes of the Node.js backend inside the same Docker container (or bare-metal process). This plan explores moving to a **compute container** model where each ffmpeg job runs in its own ephemeral Docker container, managed by the backend via the Docker API or Docker CLI.

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

## Proposed Architecture: Compute Containers

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
- **Horizontal scale for compute.** On a Kubernetes or Docker Swarm setup, compute containers can be scheduled on dedicated worker nodes with GPU or high-CPU profiles, while the backend runs on a low-cost coordinator node.
- **Multi-tenant safety.** Each API key's ffmpeg workload is fully isolated. One tenant's transcode cannot interfere with another's HLS segments or preview files at the process level.
- **Per-container observability.** `docker stats`, Prometheus cAdvisor, or Grafana can track CPU/memory per job by container name (`hls-<key>`, `relay-<key>`) without any instrumentation changes to the backend code.

### Operational
- **Cleaner lifecycle management.** Docker handles PID 1, signal forwarding, and orphan cleanup. The current SIGTERM → SIGKILL pattern (3 s timeout) is re-implemented natively by `docker stop --time 3`.
- **Reproducible local dev.** A developer without ffmpeg installed locally can still run the full stack via `docker compose up`.

---

## Cons

### Complexity
- **Docker socket access.** The backend container needs access to the Docker socket (`/var/run/docker.sock`) or a Docker-in-Docker sidecar. Mounting the socket gives the backend root-equivalent access to the host — a significant security consideration.
- **Orchestration overhead.** Managing container names, labels, cleanup of exited containers, and error recovery adds ~500–1000 LOC compared to the current `spawn()` abstraction.
- **Networking.** Compute containers need to reach nginx-rtmp (localhost loopback today). In a container network, RTMP sources become `rtmp://nginx-rtmp:1935/...` instead of `rtmp://127.0.0.1:1935/...`. All `*_LOCAL_RTMP` and `*_RTMP_*` env vars need updating and the nginx-rtmp container must be on the same Docker network.

### Latency
- **Container startup time.** `docker run` for a pre-pulled image takes roughly 200–500 ms on a typical host. For RTMP relay and HLS, this is acceptable — streams start after the publisher connects anyway. For the DSK renderer, which currently starts once at backend launch, this startup latency is less of a concern if we pre-start it. For preview thumbnails, the first frame may be delayed by the startup window.
- **CEA-708 stdin pipe.** The current relay manager writes SRT cues to ffmpeg's stdin. With a compute container, stdin piping across container boundaries requires either a Unix socket volume mount, a named pipe on a shared volume, or switching to a file-based SRT drop folder. This is the single most technically involved change.

### Shared Volumes
- **HLS and preview output.** HLS segments, playlists, and JPEG thumbnails written by ffmpeg containers must be readable by the backend container for HTTP serving. Both must mount the same Docker volume or bind-mount path. This is straightforward with Docker Compose named volumes but requires explicit configuration.
- **Image files (DSK overlays).** The DSK renderer reads image files uploaded via the backend. Both containers need read access to `GRAPHICS_DIR`.

### Operational Gaps
- **No Docker on bare metal.** Operators running the backend as a plain `node` process (cPanel, VPS without Docker) cannot use compute containers. The spawn-based managers must remain as a fallback mode.
- **Docker image pull time.** First launch on a new host requires pulling the ffmpeg image. Pull must succeed before any compute job can start. This needs a readiness check at startup.
- **Debugging is harder.** Logs from compute containers are no longer inline in the backend stdout stream. Operators need `docker logs <container>` or a log aggregation setup.

---

## Scope of Changes

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

---

### Docker Compose changes

```yaml
services:
  lcyt-backend:
    image: lcyt-backend:latest          # no ffmpeg
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Docker socket
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

---

### Environment variables (new)

| Variable | Default | Purpose |
|---|---|---|
| `FFMPEG_RUNNER` | `spawn` | `spawn` (current behaviour) or `docker` (compute containers) |
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

No code changes needed in the managers themselves — only `.env` / Docker Compose overrides.

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

## Decision Matrix

| Criterion | Current (spawn) | Compute containers |
|---|---|---|
| Setup complexity | Low | Medium–High |
| Backend image size | Large (ffmpeg included) | Small |
| Crash isolation | None | Full |
| Per-job resource limits | None | Yes (Docker flags) |
| CEA-708 stdin pipe | Native | Named pipe (FIFO) |
| RTMP address changes | None | Yes (container DNS) |
| Works without Docker | Yes | Only with `FFMPEG_RUNNER=spawn` fallback |
| Observability | Backend logs only | `docker logs`, cAdvisor |
| First-frame latency | < 100 ms | +200–500 ms container start |
| Bare-metal / cPanel compatible | Yes | No (Docker required) |

---

## Recommendation

Implement the abstraction layer (Phase 1) now so both backends can coexist behind `FFMPEG_RUNNER`. Proceed to Phase 2 (stateless managers) in parallel with the next Docker deployment iteration. Defer Phase 3 (CEA-708) until Phase 2 is stable in production. Phase 4 (DSK renderer) is optional and should only be tackled if DSK becomes a resource-contention problem.

The Docker socket security concern should be addressed at the deployment level by running the backend as a non-root user and using a socket proxy (e.g. `tecnativa/docker-socket-proxy`) that exposes only `POST /containers/create`, `POST /containers/{id}/start`, `POST /containers/{id}/stop`, and `DELETE /containers/{id}`.
