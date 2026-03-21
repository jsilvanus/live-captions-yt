# TODO: FFmpeg Container Migration — Phase-by-Phase Checklist

Date: 2026-03-20
Based on: docs/plan_dock_ffmpeg.md (v2)

Purpose
- Convert the high-level migration plan into small, testable tasks that can be implemented incrementally.

How to use
- Work top→down by Phase. Each line is an atomic task: owner, estimate, acceptance criteria (one line).

PHASE 1 — Runner abstraction (no behavior change)
- 1.1 Create `packages/lcyt-backend/src/ffmpeg/index.js` factory — Owner: Backend, Estimate: small. Acceptance: `createFfmpegRunner({ runner })` exports and unit tests.
- 1.2 Implement `local-runner.js` (wraps current spawn behavior) — Owner: Backend, Estimate: small. Acceptance: start/stop/isRunning, stderr passthrough tests.
- 1.3 Refactor `PreviewManager` to use the factory — Owner: Backend, Estimate: small. Acceptance: backend behaves identically with `FFMPEG_RUNNER=spawn` and existing tests pass.
- 1.4 Add unit tests for `local-runner` and a PreviewManager integration smoke test — Owner: Tester, Estimate: small. Acceptance: CI runs unit tests; smoke test passes locally.

Implemented (2026-03-20):
- Added `docker/ffmpeg/Dockerfile` and `images/ffmpeg/README.md` (minimal ffmpeg image).
- Added `scripts/ffmpeg-in-container.sh` wrapper to run host or docker ffmpeg.
- Updated `packages/lcyt-backend/src/ffmpeg/docker-runner.js` to forward stdin (-i), pipe stdio and accept entrypoint setting.
- Updated `packages/lcyt-backend/src/ffmpeg/index.js` to use env defaults (`FFMPEG_RUNNER`, `FFMPEG_IMAGE`, `FFMPEG_WRAPPER`).
- Added gated integration smoke test at `packages/lcyt-backend/test/integration/ffmpeg.docker.smoke.test.js` (skip unless `DOCKER_AVAILABLE=1`).

Next steps (short):
- Run local smoke: `DOCKER_AVAILABLE=1 npm test -- -w packages/lcyt-backend test/integration/ffmpeg.docker.smoke.test.js`.
- Wire `PreviewManager` to use runner factory (if not already done) and test with `FFMPEG_RUNNER=docker`.
- Add unit tests for `DockerFfmpegRunner` mocking `child_process.spawn`.
 - Ensure Python test prerequisites are installed before running Python tests: `pip install -r python-packages/lcyt-backend/requirements.txt` (use a virtualenv).
 - On Windows, run Python tests inside WSL or a Python virtualenv; the test runner and some scripts assume a Unix-like shell environment.

PHASE 2 — Docker runner for stateless jobs
- 2.1 Implement `docker-runner.js` wrapping `docker run` options (image, volumes, network, cpu/memory) — Owner: Backend, Estimate: medium. Acceptance: can start/stop a container, map volumes, capture stderr.
- 2.2 Add `images/lcyt-ffmpeg/Dockerfile` (minimal ffmpeg image) and a short README with build/push steps — Owner: Platform, Estimate: small. Acceptance: image builds locally.
- 2.3 Refactor `HlsManager` & `RadioManager` & `PreviewManager` to accept `runner` option and default to factory — Owner: Backend, Estimate: medium. Acceptance: jobs run as containers when `FFMPEG_RUNNER=docker`.
- 2.4 Add `docker-compose.yml` for single-VM dev: `lcyt-backend`, socket-proxy sidecar, named volumes, network — Owner: Platform, Estimate: small. Acceptance: compose up runs services.
- 2.5 Add guarded docker integration tests (env TEST_DOCKER=1) and CI notes — Owner: Tester/Platform, Estimate: small. Acceptance: tests run only when docker available.

PHASE 3 — CEA-708 named-pipe support and relay containers
- 3.1 Implement `pipe-utils.js` (mkfifo, remove, non-blocking write with timeout) — Owner: Backend, Estimate: small. Acceptance: FIFO lifecycle unit tests.
- 3.2 Refactor `RtmpRelayManager` to use factory + FIFO path for CEA injection — Owner: Backend, Estimate: medium. Acceptance: relay container reads FIFO and ffmpeg receives cues.
- 3.3 Mount `cea-pipes` volume in backend + relay containers in compose — Owner: Platform, Estimate: small. Acceptance: FIFO path visible inside containers.
- 3.4 Add FIFO non-blocking write e2e test that simulates stalled reader (write times out < configured ms) — Owner: Tester, Estimate: medium. Acceptance: test deterministic locally.

PHASE 4 — Worker Daemon + Orchestrator (single-VM opt-in)
- 4.1 Create `packages/lcyt-worker-daemon/` skeleton with HTTP API (POST /jobs, /jobs/:id/caption, GET /stats) — Owner: Backend, Estimate: medium. Acceptance: daemon registers and serves health endpoint.
- 4.2 Create `packages/lcyt-orchestrator/` skeleton: worker registry, simple scheduler, heartbeat poller — Owner: Backend/Platform, Estimate: medium. Acceptance: orchestrator reports workers and accepts job dispatch calls.
- 4.3 Implement `worker-runner.js` in backend ffmpeg factory that calls orchestrator endpoints (start/stop/caption) — Owner: Backend, Estimate: medium. Acceptance: `FFMPEG_RUNNER=worker` dispatches to `worker-0` (local daemon).
- 4.4 Update compose to include orchestrator + worker-daemon; document `BACKEND_INTERNAL_TOKEN` use — Owner: Platform, Estimate: small. Acceptance: local single-VM flow works.
- 4.5 Add integration tests exercising backend→orchestrator→worker end-to-end (guarded) — Owner: Tester, Estimate: medium. Acceptance: tests pass on dev machine with compose.

PHASE 5 — S3 storage for HLS/preview (multi-VM prerequisite)
- 5.1 Implement uploader sidecar or integrated uploader in Worker Daemon that watches output dir and uploads segments to S3 (or PUTs to backend) — Owner: Backend/Platform, Estimate: medium. Acceptance: segments appear in S3 within 1s in tests.
- 5.2 Add backend route changes: when `S3_ENDPOINT` set, serve/redirect playlists & previews to S3 URLs — Owner: Backend, Estimate: small. Acceptance: playback via S3 URLs works.
- 5.3 Add tests for upload reliability (simulate intermittent S3 errors, retries) — Owner: Tester, Estimate: medium. Acceptance: uploader retries and logs failures.

PHASE 6 — Hetzner autoscaling (burst VMs)
- 6.1 Implement Hetzner client utilities in orchestrator: createServer, poll status, deleteServer — Owner: Platform, Estimate: medium. Acceptance: dry-run API calls succeed when token present.
- 6.2 Implement autoscaler loop: provision burst VMs on queue depth, destroy idle VMs after cooldown — Owner: Platform, Estimate: large. Acceptance: under simulated load orchestrator creates workers and dispatches jobs.
- 6.3 Provide cloud-init template and snapshot prep checklist in docs — Owner: Platform, Estimate: small. Acceptance: operator can create snapshot following docs.
- 6.4 Add rate-limit/backoff & metrics (Prometheus counters) — Owner: Platform, Estimate: small. Acceptance: backoff triggers on 429 in tests.

PHASE 7 — DSK renderer containerization
- 7.1 Create `images/lcyt-dsk-renderer` image with Node + Playwright + ffmpeg, document startup args — Owner: Platform, Estimate: medium. Acceptance: renderer starts and can produce frames.
- 7.2 Update DSK renderer code to run in container and write frames to unix-socket/volume consumed by ffmpeg inside same container — Owner: Backend, Estimate: medium. Acceptance: RTMP output is produced by container.
- 7.3 Add integration smoke tests for DSK rendering in compose (guarded) — Owner: Tester, Estimate: medium. Acceptance: smoke render completes locally.

Cross-cutting tasks
- X.1 Environment flags & feature gating (`FFMPEG_RUNNER`, `FFMPEG_IMAGE`, `ORCHESTRATOR_FALLBACK`) — Owner: Backend, Estimate: small. Acceptance: toggles switch behaviour without code changes.
- X.2 Docs & runbooks: runbook for rollbacks, Hetzner snapshot guide, ops playbook for stuck FIFOs — Owner: Documentation Steward, Estimate: small. Acceptance: runbook added to docs/.
- X.3 CI & staging: add guarded integration jobs (TEST_DOCKER=1) and a local-acceptance job to run the smoke harness — Owner: Tester/Platform, Estimate: medium. Acceptance: CI jobs present but gated for runners with Docker.
- X.4 Acceptance test harness: deterministic harness that can simulate RTMP publishers and verify HLS/preview/relay semantics — Owner: Tester, Estimate: large. Acceptance: provides reproducible tests for each phase.
- X.5 Rollback helpers & diagnostics: `docker ps --filter label=lcyt` stop-all script, orchestrator graceful-fallback to `spawn` — Owner: Platform, Estimate: small. Acceptance: operator can revert to `spawn` quickly.

Implementation notes and priorities
- Keep `spawn` runner default and fully tested; every phase must be deployable with `FFMPEG_RUNNER=spawn` fallback.
- Guard integration tests with env flags to avoid CI flakiness (e.g., `TEST_DOCKER`, `TEST_S3`, `TEST_HETZNER`).
- Prefer small, reviewable patches: add ffmpeg factory + local-runner first, then docker-runner, then FIFO support.

Suggested first pull request
- Branch: `director/ffmpeg-runner-phase1`
- Contents: `packages/lcyt-backend/src/ffmpeg/index.js`, `local-runner.js`, PreviewManager refactor, unit tests, README snippet.
- Tests: unit tests only; no CI Docker required.

Validation checklist before moving to Phase 2
- All unit tests pass.
- PreviewManager smoke test using `FFMPEG_RUNNER=spawn` passes locally.
- Review approved for `docker-runner` design (CLI vs Docker API decision).

---
End of file.
# TODO: Docked FFmpeg — Revised Implementation Plan (v2)

Status: Draft (updated to include distributed Phase 6+ orchestration)
Reference: docs/plan_dock_ffmpeg.md (v2)

High-level goals
- Phase 1–5: introduce `DockerFfmpegRunner` abstraction and optional local Docker execution.
- Phase 6+: add a Compute Orchestrator + Worker Daemon for distributed Hetzner-based compute.
- Preserve `spawn` fallback and enable incremental rollout.

Phased work (concrete tasks & files)

Phase 1 — Abstraction (safe)
- Create `packages/lcyt-backend/src/ffmpeg/index.js` (runner factory).
- Add `local-runner`: `packages/lcyt-backend/src/ffmpeg/local-runner.js` (wraps current spawn()).
- Refactor managers to use factory (one-by-one):
  - `packages/lcyt-backend/src/preview-manager.js` (smoke), then
  - `packages/lcyt-backend/src/hls-manager.js`,
  - `packages/lcyt-backend/src/radio-manager.js`,
  - `packages/lcyt-backend/src/rtmp-manager.js`.
- Tests: `packages/lcyt-backend/test/ffmpeg/local-runner.test.js` (unit, mock spawn).

Phase 2 — Docker runner (local containers)
- Implement `DockerFfmpegRunner`: `packages/lcyt-backend/src/ffmpeg/docker-runner.js`.
- Errors: `packages/lcyt-backend/src/ffmpeg/errors.js`.
- Managers: accept mounts/env and call `runner.start()`.
- Add envs: `FFMPEG_RUNNER` (`spawn|docker|worker`), `FFMPEG_IMAGE`, `FFMPEG_NETWORK`.
- Tests: unit mock docker (fast) and integration tests (Docker required):
  - `packages/lcyt-backend/test/ffmpeg/docker-runner.test.js`
  - `packages/lcyt-backend/test/hls-manager.docker.test.js`

Phase 3 — CEA-708 named-pipe support
- Implement `packages/lcyt-backend/src/ffmpeg/pipe-utils.js` (mkfifo management).
- Update `RtmpRelayManager` to create FIFO and write SRT cues through runner mounts.
- Integration test: `packages/lcyt-backend/test/ffmpeg/cea-pipes.integration.test.js`.

Phase 4 — DSK renderer container
- Build `lcyt-dsk-renderer` image and update `packages/plugins/lcyt-dsk/src/renderer.js`.

Phase 5 — Hardening & observability
- Add container labels, Prometheus metrics (`lcyt_ffmpeg_jobs_total`, etc.), and alerts.
- Add Docker socket proxy deployment notes.

Phase 6 — Compute Orchestrator + Worker Daemon (distributed)
- Create `packages/lcyt-worker-daemon/` (Worker Daemon service) with API:
  - `POST /jobs`, `DELETE /jobs/:id`, `POST /jobs/:id/caption`, `GET /stats`.
- Create `packages/lcyt-orchestrator/` (Orchestrator service) with API:
  - `POST /compute/jobs`, `DELETE /compute/jobs/:id`, `POST /compute/jobs/:id/caption`, `GET /compute/workers`.
- Implement Hetzner lifecycle: snapshot prep, create/destroy VMs via Hetzner API.
- Storage: design S3 uploader sidecar or worker push (see Phase 8 below).

Phase 7 — Hetzner snapshot & warm-pool
- Prepare snapshot with Docker + pre-pulled ffmpeg images and `lcyt-worker-daemon` systemd service.
- Add cloud-init snippet and orchestrator VM provisioning flow.

Phase 8 — Storage migration (critical for cross-VM)
- Implement object-storage uploader sidecar or Worker push to backend:
  - Option A (recommended): S3 uploader sidecar per worker; ffmpeg writes locally then uploader streams to S3.
  - Option B: Worker HTTP push to backend `PUT /internal/hls/<key>` (simpler for small deployments).
- Tests: end-to-end HLS output to S3 in a staging environment.

Phase 9 — Rollout & rollback
- Default: `FFMPEG_RUNNER=spawn` (no behavior change).
- Canary by manager: enable Docker for `PreviewManager` → `HlsManager` → `RadioManager` → `RtmpRelayManager`.
- Orchestrator mode: `FFMPEG_RUNNER=worker`, set `COMPUTE_ORCHESTRATOR_URL` and `BACKEND_INTERNAL_TOKEN`.
- Rollback: switch `FFMPEG_RUNNER=spawn` or stop worker containers; orchestrator supports draining and reassign.

Testing matrix & CI
- Unit: mock `child_process` and `dockerode` (fast). Add tests under `packages/lcyt-backend/test/ffmpeg/`.
- Integration (optional Docker runner): gate with `TEST_DOCKER=1` in CI or run in dedicated runner.
- Orchestrator/Worker integration: run in a staging environment using local VMs or Hetzner sandbox.

Immediate next actions (short-term)
1. Phase 1: scaffold `packages/lcyt-backend/src/ffmpeg/index.js` + `local-runner.js` and unit test. (owner: backend eng)
2. Refactor `packages/lcyt-backend/src/preview-manager.js` to use runner and run tests. (owner: backend eng)
3. Draft `DockerFfmpegRunner` interface and smoke unit tests (owner: backend eng + ops).

Operational notes
- New env vars: `FFMPEG_RUNNER`, `FFMPEG_IMAGE`, `FFMPEG_NETWORK`, `COMPUTE_ORCHESTRATOR_URL`, `BACKEND_INTERNAL_TOKEN`, S3 creds when Phase 8.
- Security: use `tecnativa/docker-socket-proxy` in Phase 1–5; socket removed from backend in Phase 6+.

Architect & Codebase Expert additions
- Add env defaults for orchestrator/workers and limits: `WORKER_MAX_JOBS_WARM=4`, `WORKER_MAX_JOBS_BURST=8`, `BURST_QUEUE_LIMIT=20`, `MAX_CONCURRENT_BURST_CREATES=3`, `ORCHESTRATOR_BACKOFF_MS=60000`, `ORCHESTRATOR_FALLBACK=spawn`.
- Add per-job resource defaults (suggested): `preview=0.5cpu/256MB`, `radio=1cpu/512MB`, `hls=1.5cpu/1024MB`, `relay=3cpu/6GB`, `dsk=6cpu/12GB`.
- Move storage migration earlier: run Phase 8 (storage/S3) before wide orchestrator rollout so workers publish to object storage in multi-VM setups.
- Add runbooks and operational docs: worker drain, relay failover, FIFO stuck recovery, Hetzner VM reprovision steps.
- Add logging & tracing requirement: centralized logs (Fluentd/Promtail → Loki/ELK) and request-id propagation backend→orchestrator→worker.
- Add CI/test lines: gate Docker integration tests with `TEST_DOCKER=1` and add integration tests for worker-loss reassign, Hetzner rate-limit/backoff, and S3 upload failure simulation (staging only).
- Add runner factory TODO: implement `createFfmpegRunner({ runner, opts })` and document default `spawn` behaviour.
- Add Docker socket proxy reminder: include `tecnativa/docker-socket-proxy` in Compose snippets and require it in deployment notes.

Estimated effort: phased work across 2–6 sprints depending on team size and staging infra.

References: docs/plan_dock_ffmpeg.md
# TODO: Docked FFmpeg (compute container) Implementation

Status: Draft
Reference: docs/plan_dock_ffmpeg.md

Goals
- Move ffmpeg workloads into ephemeral compute containers while preserving a spawn-based fallback.
- Provide per-job resource limits, improved isolation, and predictable lifecycle management.

Milestones
- Phase 1 — Abstraction (safe): introduce runner abstraction, local runner implementation.
- Phase 2 — Docker backend: implement `DockerFfmpegRunner`, wire stateless managers.
- Phase 3 — CEA-708: named-pipe support for relay stdin (real-time captions).
- Phase 4 — DSK renderer: renderer image + socket/volume frame transport.
- Phase 5 — Hardening & rollout: observability, limits, orchestration docs.

Phase 1 — Abstraction (owner: backend eng) — 2–4 days
- Add runner abstraction: `packages/lcyt-backend/src/ffmpeg/index.js` (factory).
- Implement `local-runner`: `packages/lcyt-backend/src/ffmpeg/local-runner.js` (wraps spawn).
- Replace direct `spawn('ffmpeg')` calls to use factory in: 
  - `packages/lcyt-backend/src/hls-manager.js`
  - `packages/lcyt-backend/src/radio-manager.js`
  - `packages/lcyt-backend/src/preview-manager.js`
  - `packages/lcyt-backend/src/rtmp-manager.js`
- Add unit tests for local-runner: `packages/lcyt-backend/test/ffmpeg/local-runner.test.js`

Phase 2 — Docker runner (owner: backend eng + ops) — 3–7 days
- Add `DockerFfmpegRunner`: `packages/lcyt-backend/src/ffmpeg/docker-runner.js`.
- Implement API: `start({ ffmpegArgs, mounts, env, pipes })`, `stop()`, `probe()` and event emitter (`stdout`, `stderr`, `exit`).
- Add errors file: `packages/lcyt-backend/src/ffmpeg/errors.js`.
- Wire managers to accept mount/label parameters and pass to runner.
- Add integration tests (Docker required):
  - `packages/lcyt-backend/test/ffmpeg/docker-runner.test.js`
  - `packages/lcyt-backend/test/hls-manager.docker.test.js`
- Add env flags: `FFMPEG_RUNNER`, `FFMPEG_IMAGE`, `FFMPEG_NETWORK`.

Phase 3 — CEA-708 stdin pipe (owner: backend eng) — 2–5 days
- Implement named-pipe utils: `packages/lcyt-backend/src/ffmpeg/pipe-utils.js`.
- Update `RtmpRelayManager` to create FIFO in shared volume and write SRT cues.
- Ensure Docker runner mounts `/tmp/lcyt-cea` into containers.
- Add integration test: `packages/lcyt-backend/test/ffmpeg/cea-pipes.integration.test.js`.

Phase 4 — DSK renderer (owner: dsk team) — 3–7 days
- Create `lcyt-dsk-renderer` image (Playwright + Chromium + ffmpeg).
- Update `packages/plugins/lcyt-dsk/src/renderer.js` to launch renderer container and use socket/volume transport.

Phase 5 — Hardening & rollout (owner: platform eng) — ongoing
- Add labels to containers: `lcyt.job`, `lcyt.manager`, `lcyt.key`.
- Add Prometheus metrics (backend): `lcyt_ffmpeg_jobs_total`, `..._restarts_total`, `..._start_latency_seconds`.
- Add alert rules: job restart rate, OOM kills, high CPU/memory, HLS playlist age.
- Add Docker socket proxy plan (tecnativa/docker-socket-proxy) and image-signing policy.

Testing matrix
- Unit: mock dockerode and spawn (fast)
- Integration: requires Docker available; configured via `TEST_DOCKER=1` env
- CI: mark Docker integration tests as optional or run on runners with Docker support

Backward compatibility
- Default `FFMPEG_RUNNER=spawn` maintains current behaviour.
- If Docker probe fails at startup, log warning and fallback to `spawn`.

Docs to update
- `docs/plan_dock_ffmpeg.md` (architecture) — add final decisions
- `CLAUDE.md` — operations notes and required env vars
- `.github/agents/orchestrator.agent.md` — example payloads (already updated)

Initial tasks (next actions)
1. Create `packages/lcyt-backend/src/ffmpeg` folder and add `index.js` + `local-runner.js` (Phase 1).
2. Refactor one manager (`PreviewManager`) to use runner as a smoke test.
3. Add unit tests for local-runner and run CI.

Estimated total: 2–4 sprints (team-dependent). 

References: docs/plan_dock_ffmpeg.md
