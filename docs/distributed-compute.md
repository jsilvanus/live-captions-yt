# Distributed FFmpeg Compute Architecture

How LCYT runs ffmpeg jobs (HLS, radio, preview, RTMP relay, DSK render) — from a single bare-metal process up to an autoscaling fleet of Hetzner Cloud workers.

See [plan_dock_ffmpeg.md](./plans/plan_dock_ffmpeg.md) for the full phased implementation plan this doc summarizes. This page is the operator-facing "how does it actually work" reference.

---

## The three tiers

```
lcyt-backend  →  lcyt-orchestrator  →  lcyt-worker-daemon
(API/RTMP)       (job router)          (runs ffmpeg)
```

| Service | Owns | Never touches |
|---|---|---|
| `lcyt-backend` | HTTP API, RTMP ingest, captions, SQLite DB | Docker socket, VM lifecycle |
| `lcyt-orchestrator` | Worker registry, job routing, Hetzner API client, autoscaling | ffmpeg processes, caption logic |
| `lcyt-worker-daemon` | ffmpeg/Docker execution, local FIFOs, S3 upload | Hetzner API, the database |

`lcyt-backend` never spawns ffmpeg directly when running in distributed mode — it always goes through a **runner** abstraction (`packages/lcyt-backend/src/ffmpeg/`), selected by the `FFMPEG_RUNNER` env var via `createFfmpegRunner()`.

---

## Optional deployment paths

`FFMPEG_RUNNER` picks one of four runners. Each is a strict superset of complexity over the last; none requires the next.

| `FFMPEG_RUNNER` | Where ffmpeg runs | Requires |
|---|---|---|
| `spawn` (default) | Inside the backend's own process/container, via `child_process.spawn` | Nothing — ffmpeg binary on the backend image |
| `docker` | Ephemeral Docker container on the same VM as the backend | Docker socket (or `tecnativa/docker-socket-proxy`) mounted into the backend |
| `worker` | Remote worker VM, dispatched through the orchestrator | `lcyt-orchestrator` + at least one `lcyt-worker-daemon` reachable over HTTP |
| `worker` + Hetzner | Same as above, but the orchestrator can also provision burst worker VMs on demand | `HETZNER_API_TOKEN`, `HETZNER_SNAPSHOT_ID`, `HETZNER_NETWORK_ID` set on the orchestrator |

**Orchestrator fallback:** when `FFMPEG_RUNNER=worker`, `WorkerFfmpegRunner` (`packages/lcyt-backend/src/ffmpeg/worker-runner.js`) first tries `COMPUTE_ORCHESTRATOR_URL`. If the orchestrator is unreachable, it automatically falls back in-process to `ORCHESTRATOR_FALLBACK` (default `spawn`, can be set to `docker`, or `none` to disable fallback and surface the error instead). This means a single-VM deployment can set `FFMPEG_RUNNER=worker` with no orchestrator running yet and behave exactly like `spawn` until the orchestrator comes online — no code change needed to graduate between tiers.

---

## Starting the services

Both `lcyt-orchestrator` and `lcyt-worker-daemon` follow the same factory pattern: `createApp()` returns an Express app, `startServer(port)` wraps it with `.listen()` and returns `{ app, server, stop }`.

- **Orchestrator** — one instance, stateless, in-memory worker/job registry:
  ```bash
  npm start -w packages/lcyt-orchestrator   # PORT=4000 by default
  ```
- **Worker daemon** — one instance **per worker VM** (including the backend's own VM, which can double as `worker-0`, and every Hetzner burst VM):
  ```bash
  npm start -w packages/lcyt-worker-daemon  # PORT=5000 by default
  ```

For local development, `docker-compose.orchestrator.yml` brings up backend + orchestrator + one worker daemon together (see [compose_orchestrator.md](./compose_orchestrator.md) for curl walkthroughs). In production, the orchestrator typically runs once on its own small VM or alongside the backend, while a `lcyt-worker-daemon` systemd unit runs on every warm-pool and burst VM (cloud-init template at `packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml`; see [hetzner_runbook.md](./hetzner_runbook.md) for snapshot + boot steps).

**Worker self-registration:** on boot, each worker daemon resolves its own private IP (`WORKER_PRIVATE_IP` env override → scan `os.networkInterfaces()` → `127.0.0.1` fallback) and `POST`s to `${ORCHESTRATOR_URL}/compute/workers/register` with `{ id, privateIp, maxJobs, port, type, version }`. It retries with exponential backoff until the first successful registration, then re-registers periodically (`WORKER_REGISTER_INTERVAL_MS`) so it survives an orchestrator restart — the registry is in-memory only, by design (no shared DB between orchestrator and workers).

---

## Where are the "warm" ffmpegs?

There aren't any pre-spawned ffmpeg processes waiting around — **every job starts ffmpeg fresh** on `POST /jobs`, on every runner. "Warm" describes the **worker daemon/VM**, not the ffmpeg process:

- `WORKER_TYPE=warm` (default) — an always-on worker daemon, e.g. the backend's own VM acting as `worker-0`, or a permanently-provisioned Hetzner VM. The orchestrator's `pickWorker()` prefers warm workers first.
- `WORKER_TYPE=burst` — a Hetzner VM the orchestrator provisioned on demand because warm capacity was exhausted. It self-registers the same way, gets jobs routed to it once ready, and is destroyed automatically after `BURST_COOLDOWN_MS` (default 5 min) of sitting at `jobCount === 0`.

So "warm" capacity means *spare worker-daemon slots are immediately available to accept a job*, not that an idle ffmpeg process is sitting around consuming CPU. Job start latency is dominated by ffmpeg/container startup (~100 ms for `spawn`, ~200–500 ms for `docker`), not by orchestrator routing.

---

## Internal authentication

Two distinct shared-secret headers protect the internal HTTP hops (private network only — never expose these ports publicly):

| Header | Used for | Validated against |
|---|---|---|
| `X-Internal-Auth` | Backend → Orchestrator | `BACKEND_INTERNAL_TOKEN` / `ORCHESTRATOR_INTERNAL_TOKEN` |
| `X-Worker-Auth` | Orchestrator → Worker (or backend → worker directly, e.g. local dev) | `WORKER_AUTH_TOKEN` / `BACKEND_INTERNAL_TOKEN` |

---

## Job lifecycle (worker mode)

1. A manager (`HlsManager`, `RadioManager`, `PreviewManager`, `RtmpRelayManager`, `DskRenderer`) calls `runner.start()`.
2. `WorkerFfmpegRunner` posts the job spec to `POST /compute/jobs` on the orchestrator.
3. Orchestrator's scheduler: warm worker with spare capacity → assign immediately; else burst worker with spare capacity → assign immediately; else provision a new burst VM (if `HETZNER_API_TOKEN` set) and queue the job until it registers; else `503` with `retryAfterMs` once `BURST_QUEUE_LIMIT` is exceeded.
4. The assigned `lcyt-worker-daemon` runs ffmpeg (via `DockerFfmpegRunner`, reused verbatim from the single-VM Docker phase) and reports back through `{ jobId, workerId, workerUrl }`.
5. Caption text for CEA-708 injection flows `backend → orchestrator → worker` via `POST /jobs/:id/caption`, written to a local FIFO on the worker — never shared across VMs.
6. RTMP relay and HLS jobs are never auto-reassigned on worker loss (stream continuity requires a stable socket); stateless jobs (preview, idle HLS) can be re-dispatched after a grace period.

Full API surfaces, env var tables, and the Hetzner burst-VM provisioning flow are documented in [plan_dock_ffmpeg.md](./plans/plan_dock_ffmpeg.md).
