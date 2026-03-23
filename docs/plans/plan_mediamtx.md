---
id: plan/mediamtx
title: "MediaMTX Integration"
status: implemented
summary: "Opt-in MediaMTX media broker as alternative to ffmpeg-based RTMP/HLS flows; NginxManager for slug-based public URLs."
supersedes: "plan/rtmp (partially: RTMP ingest and HLS distribution path replaced by MediaMTX for radio/HLS mode)"
---

# MediaMTX Integration Plan

This document describes a proposed migration and integration of MediaMTX (bluenviron/mediamtx) into the LCYT infrastructure as an alternative/companion to our current ffmpeg-based RTMP/HLS flows. It is written as an engineer-facing plan with concrete next steps, sample configuration, and a list of repository places to review and update.

Motivation
- Consolidate real-time ingest and low-latency playback using a lightweight, high-performance media broker (MediaMTX) instead of ad-hoc ffmpeg relay containers for some workflows.
- Simplify RTMP/RTSP/HLS routing and reduce operational complexity for viewer/distribution paths.
- Provide a stable central point to offload stream muxing and HLS generation while keeping our ffmpeg-based processors for advanced transforms (DSK rendering, custom transcode jobs).

Scope
- Introduce MediaMTX as an option for RTMP/RTSP ingest and HLS distribution.
- Update backend and renderer components to optionally target MediaMTX ingest endpoints instead of direct ffmpeg runners.
- Add Docker compose and orchestration artifacts to run MediaMTX locally and in our orchestrated setups.
- Do not remove existing ffmpeg runner work yet — migration will be opt-in per deployment.

Key repo files to review and update
- `packages/lcyt-backend/src/rtmp-manager.js` — RTMP relay/slot management, where ingest URLs are composed and workers are started.
- `packages/plugins/lcyt-dsk/src/renderer.js` — DSK renderer push targets (RTMP output configuration).
- `packages/lcyt-bridge/src/bridge.js` — bridge command paths and any TCP relay assumptions (if bridges push to RTMP endpoints).
- `docker/ffmpeg/Dockerfile` and `docker-compose.yml` — add MediaMTX service entries and update runner definitions where needed.
- `docs/ffmpeg-docker-usage.md` and `docs/plan_dock_ffmpeg.md` — add usage notes and Phase 8 appendix (see companion appendix below).
- Tests referencing RTMP runner behaviour: `packages/lcyt-backend/test/rtmp.test.js` and `packages/lcyt-backend/test/rtmp-manager.test.js` (update mocks/expectations to support MediaMTX).

High-level architecture
- MediaMTX runs as a network-accessible service (sidecar or centralized): accepts RTMP/RTSP ingest and can publish HLS, DASH, and RTSP endpoints.
- Our backend/renderer will push RTMP to MediaMTX (e.g. rtmp://mediamtx:1935/live/<key>). MediaMTX will provide HLS endpoints for viewers (e.g. http://mediamtx:8080/live/<key>.m3u8) when enabled.
- Keep ffmpeg-based runners for tasks that require frame-level processing (DSK rendering, advanced transcode), and have those runners push into MediaMTX when appropriate.

Deployment options
- Local dev: docker-compose service `mediamtx` for developer testing.
- Single-VM: run MediaMTX as a systemd service or Docker container bound to local network.
- Multi-VM/cluster: run MediaMTX as a highly-available cluster (or a small farm) behind a load balancer; prefer per-region instances for latency-sensitive ingest.

Sample docker-compose snippet

```yaml
services:
  mediamtx:
    image: bluenviron/mediamtx:latest
    container_name: mediamtx
    ports:
      - "1935:1935"    # RTMP
      - "8554:8554"    # RTSP
      - "8080:8080"    # HTTP/HLS/metrics
    volumes:
      - ./docker/mediamtx.yml:/etc/mediamtx.yml:ro
    restart: unless-stopped
```

Minimal `mediamtx.yml` example

```yaml
# docker/mediamtx.yml
paths:
  all:
    publish: yes
    hls:
      enabled: yes
      segment_duration: 4
      playlist_length: 6
    source: ""

http:
  address: ":8080"

rtmp:
  address: ":1935"

log:
  level: info
```

Integration details and code notes

### MediaMTX REST API client (implemented ✅)

A typed REST client is now available at `packages/plugins/lcyt-rtmp/src/mediamtx-client.js` and
exported from the `lcyt-rtmp` plugin entry point (`api.js`).

```
import { MediaMtxClient, MediaMtxApiError } from 'lcyt-rtmp';
```

**Class: `MediaMtxClient`**

All operations call the MediaMTX v3 REST API (default port `:9997`).

| Method | REST call | Purpose |
|---|---|---|
| `kickPath(name)` | `POST /v3/paths/kick/{name}` | Drop publisher (replaces nginx-rtmp `drop/publisher`) |
| `getPath(name)` | `GET /v3/paths/get/{name}` | Get path state (publisher, readers, tracks) |
| `isPathPublishing(name)` | `GET /v3/paths/get/{name}` | Returns `true` if a publisher is active |
| `listPaths()` | `GET /v3/paths/list` | List all active paths |
| `addPath(name, config?)` | `POST /v3/config/paths/add/{name}` | Dynamically add a path |
| `deletePath(name)` | `DELETE /v3/config/paths/delete/{name}` | Remove a dynamically-added path |

**Environment variables:**

| Variable | Purpose | Default |
|---|---|---|
| `MEDIAMTX_API_URL` | MediaMTX API base URL | `http://localhost:9997` |
| `MEDIAMTX_API_USER` | Basic-auth username | (none) |
| `MEDIAMTX_API_PASSWORD` | Basic-auth password | (none) |

Setting `MEDIAMTX_API_URL` is sufficient to activate the MediaMTX code path — the `RtmpRelayManager`
auto-creates a `MediaMtxClient` from that env var if no explicit instance is injected.

**Integration in `RtmpRelayManager` (`packages/plugins/lcyt-rtmp/src/rtmp-manager.js`):**

- Constructor now accepts an optional `mediamtxClient` option (instance of `MediaMtxClient`).
- `dropPublisher(apiKey)` checks for a MediaMTX client first, then falls back to the nginx-rtmp
  control URL, and finally logs a no-op if neither is configured.
- When `MEDIAMTX_API_URL` is set but no explicit instance is passed, the manager creates one
  automatically from environment variables.

**Testing the client:**

Inject a mock `mediamtxClient` into `RtmpRelayManager` for unit tests:

```js
const mockClient = { kickPath: stub().resolves() };
const manager = new RtmpRelayManager({ mediamtxClient: mockClient });
await manager.dropPublisher('mykey');
assert.calledWith(mockClient.kickPath, 'mykey');
```

### Remaining work

- `packages/plugins/lcyt-rtmp/src/rtmp-manager.js`
  - Add `MEDIAMTX_RTMP_URL` / `MEDIAMTX_RTMP_APP` env var support so `start()` composes the push
    URL targeting MediaMTX instead of nginx-rtmp (guarded by `RTMP_RELAY_TYPE=mediamtx`).
  - Ensure existing slot lifecycle semantics (start/stop, health checks, TTL, auth) are preserved.

- `packages/plugins/lcyt-dsk/src/renderer.js`
  - Make RTMP output target configurable via env (e.g. `DSK_RTMP_OUTPUT`) so tests and local dev
    can switch between direct ffmpeg→nginx and ffmpeg→MediaMTX.

- `packages/lcyt-bridge/src/bridge.js` and production bridge code
  - Review any hard-coded RTMP target assumptions and allow `MEDIAMTX_HOST` based configuration
    for remote on-site ingest/forwarding.

Operational concerns
- Authentication & ACLs: MediaMTX has minimal built-in auth. Gate ingest behind network ACLs and/or a JWT/API fronting layer when exposing public ingest endpoints.
- Metrics & Monitoring: enable MediaMTX HTTP metrics and export to Prometheus. Add runbook entries for stream health, reconnect patterns, and disk usage for HLS segments.
- Storage: For long-term HLS segment retention or CDN uploads, plan a sidecar process to upload completed segments to object storage (S3) as part of Phase 8.

Migration plan (step-by-step)
1. Spike (1 week)
   - Run MediaMTX locally via docker-compose. Push an RTMP stream from ffmpeg and confirm HLS output.
   - Verify viewer playback and measure latency compared to ffmpeg sidecar flow.
2. Dev integration (1–2 weeks)
   - Add `mediamtx` service to `docker-compose.yml` for dev/test.
   - Add configuration knobs (`RTMP_RELAY_TYPE`, `MEDIAMTX_URL`, `MEDIAMTX_APP`) to `packages/lcyt-backend` and `packages/plugins/lcyt-dsk`.
   - Add unit/integration tests that mock/point to a local MediaMTX instance.
3. Staging rollout (2 weeks)
   - Deploy MediaMTX to staging environment.
   - Configure a small set of projects to opt into MediaMTX ingest and validate metrics, error modes, and SSE/event propagation.
4. Production rollout (phased)
   - Run A/B: some events on MediaMTX, others on existing ffmpeg runner. Monitor stream reliability, reconnection behavior, and viewer UX.
   - If stable, gradually move more workloads. Keep rollback plan to revert `RTMP_RELAY_TYPE` to `ffmpeg`.
5. Phase 8 (hardening)
   - Add monitoring dashboards, alerts, runbooks, S3-backed HLS archival, and high-availability deployment patterns.

Testing
- Update existing RTMP-related unit tests to support configurable `RTMP_RELAY_TYPE`.
- Add an end-to-end smoke test that spins a Mediamtx container, pushes a short test stream, and validates HLS playlist availability.

Rollbacks and fallbacks
- All changes should be toggled by configuration (`RTMP_RELAY_TYPE`). Keep ffmpeg runner path unchanged so we can quickly revert.

Security
- Expose MediaMTX ports only on internal networks.
- Limit public ingestion with short-lived stream keys; consider IP allowlists for production ingest.

Observability & runbooks
- Export MediaMTX metrics (HTTP port) to Prometheus.
- Add runbook items for: stream stuck/404 HLS pages, segment accumulation, disk pressure, CPU spikes when many concurrent transmuxes.

Deliverables
- `docker/mediamtx.yml` (example config)
- `docker-compose.yml` update with `mediamtx` service (dev-only toggle)
- Code changes guarded by `RTMP_RELAY_TYPE` env var in:
  - `packages/lcyt-backend/src/rtmp-manager.js`
  - `packages/plugins/lcyt-dsk/src/renderer.js`
- E2E smoke test to push and verify HLS
- Documentation updated: `docs/plan_mediamtx.md` (this file) and `docs/plan_dock_ffmpeg.md` Phase 8 appendix (see companion paragraph)

Notes
- This plan is intentionally conservative: it introduces MediaMTX as an opt-in target while preserving existing ffmpeg flows until we validate stability.
- Most code changes should be small and confined to configuration and endpoint composition; keep worker/ffmpeg invocation logic unchanged where possible.

References
- MediaMTX docker image: https://github.com/bluenviron/mediamtx
- Files in this repo to review: `packages/lcyt-backend/src/rtmp-manager.js`, `packages/plugins/lcyt-dsk/src/renderer.js`, `packages/lcyt-bridge/src/bridge.js`, `docker/ffmpeg/Dockerfile`, `docker-compose.yml`, `docs/ffmpeg-docker-usage.md`, `docs/plan_dock_ffmpeg.md`
