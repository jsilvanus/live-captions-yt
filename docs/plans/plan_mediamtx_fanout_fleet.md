# Plan: no ffmpeg inside MediaMTX, every ffmpeg goes through the fffleet fleet

Status: plan only, nothing implemented (2026-10-13). Based on `live-captions-yt` main at #358 (5edd832), `deploy-media` main (#9), `fffleet` 2.4.x. Nothing here was run against a real MediaMTX or a remote fleet.

## 0. Constraint added 2026-10-13 (Juha)

The program must not start Docker containers any more. Only two ffmpeg runners remain: **`spawn`** (local process) and **`fleet`** (fffleet, which itself falls back to local). This plan assumes that: the `docker` runner is not an option anywhere below, and `crop-manager`'s "restart mode" for runners without stdin disappears (both remaining runners give stdin). Removing the Docker runner is a separate, small cleanup, listed in section 8 as **P-D** and meant for its own thread. It also removes the need for the docker-socket-proxy and the Docker socket mount in the LCYT stack. Containers started by compose, Hetzner or the fffleet orchestrator's own `docker` provider are not "started by the program" and stay.

## 1. Answer in short

MediaMTX itself starts ffmpeg in exactly **one shape**: `runOnPublish: ffmpeg -re -i rtsp://…/<path> -c copy -f tee "[f=flv]rtmp://…|…"`, registered by `RtmpManager` at **five call sites**. Everything else that uses ffmpeg around MediaMTX (processing, crop, DSK, STT, music, perception) is already started by the backend through `spawnFfmpeg` / `createFfmpegRunner` and can run on the fleet today. The deploy configs (`deploy-media/config/mediamtx.yml`, `docker/mediamtx.yml`, k8s) contain **no active `runOn*` hooks**, only a commented `curl` example.

Recommendation: stop registering `runOnPublish` at all. A small **FanoutSupervisor** in the process that owns the key is told by MediaMTX `runOnReady`/`runOnNotReady` hooks (ping to an internal backend endpoint; a slow reconcile poll of the REST API is the safety net) and runs the same tee command as a fleet **stream job** (or locally, via the same runner factory). MediaMTX itself never runs ffmpeg; it needs only curl (for the ping hook), so use an image variant that has it.

One finding that makes this more than cosmetic: both compose files use `bluenviron/mediamtx:latest`. As far as I know (documented by MediaMTX, **not verified here**) that image is the minimal one with no shell and no ffmpeg, and the ffmpeg-bundled variant is a separate tag (`-ffmpeg`). If so, the current `runOnPublish` fan-outs cannot run in the shipped stacks at all. Check first (step P0); the plan stands either way.

## 2. Inventory: every place MediaMTX starts ffmpeg

All in `packages/plugins/lcyt-rtmp/src/rtmp-manager.js`. Same command each time, only the source path and targets differ.

| # | Site | MediaMTX path | What it does | Today |
|---|---|---|---|---|
| A | plain relay, `start()` ~l.668 | `{key}` | copy raw ingest to relay targets | `runOnPublish` + `kickPath` |
| B | CEA-708 / DSK output fan-out ~l.498 and ~l.632 | `{key}-out` | the processing ffmpeg pushes the program feed here, hook copies it to targets | `runOnPublish` |
| C | per-slot transcode fan-out ~l.573 | `{key}-t{i}` | one hook per slot, copy to one target | `runOnPublish` |
| D | crop-view fan-out `_startCropRelay` → `_registerPathFanout` ~l.879 | `{key}-crop` | tee the 9:16 rendition to crop slots | `runOnPublish` |
| E | named-feed fan-out `_reconcileCameraKeyFanout` → `_registerPathFanout` | `{camera_key}` | tee a camera feed; **union of slots of every key using the feed**, MediaMTX allows one hook per path | `runOnPublish` |

C, D, E and the `{key}-out` case in B all go through (or should go through) `_registerPathFanout`/`_buildTeeTargets`; A and the two B/C copies are inline duplicates. The plan folds all five into one helper.

Settings read: `mediamtx.rtsp_base_url` (`MEDIAMTX_RTSP_BASE_URL`), `mediamtx.rtmp_base_url`, `compute.ffmpeg_runner`, `compute.fffleet_*` (`packages/lcyt-backend/src/settings/registry.js`).

## 3. Everything else that touches ffmpeg near MediaMTX

| Site | Started by | Needs media locally? | Fleet today | Action |
|---|---|---|---|---|
| Processing ffmpeg (CEA-708 cues on stdin, DSK composite, per-slot transcode), `rtmp-manager.js` ~l.721 | backend, `createFfmpegRunner`, reads `FFMPEG_RUNNER` from `process.env` (not the settings object) | no, reads MediaMTX, pushes to `{key}-out` over RTMP | yes (`runner: fleet`, stdin through the fleet API) | read the runner from settings like the others; needs publish access to MediaMTX from workers (section 5) |
| `CropManager` renderer (stdin crop commands) | backend runner | no | yes, stdin works | none (restart mode for the docker runner goes away with P-D) |
| STT, music, PCM, perception | `spawnFfmpeg` / fleet executor | no (read RTSP/HLS) | yes (#312) | none; they already need `AUDITOR_STT_SOURCE_URL` / `PERCEPTION_STREAM_BASE_URL` to be reachable from the worker, same rule as below |
| DSK renderer streams | `lcyt-dsk` fleet executor | no, pushes RTMP into `dsk/{key}` | yes (`DSK_RENDER_EXECUTOR=fleet`) | none; publish access, section 5 |
| HLS, radio, preview, WebRTC, thumbnails | MediaMTX **natively**, no ffmpeg (`HlsManager` only runs `ffprobe` via `spawnSync`) | yes, they *are* MediaMTX | n/a | **stay local by design** (PR #312 decision stands) |
| Recording (#357/#358, `recorder.js`) | MediaMTX **natively** (`record: true`, fmp4 segments) | writes files on the MediaMTX host | n/a | stays on MediaMTX |
| Recording post-processing (`runFfmpeg`, concat / HLS VOD / probe) | backend, `runner: 'spawn'` **hard-coded** | **yes**, local segment files under `VIDEOS_STORAGE_DIR` | no | out of scope here (not started by MediaMTX); optional phase P5 once segments live in S3 |
| `ffmpeg -version` / `ffprobe` probes (stt-manager, hls-manager, camera/recorder probes) | backend `spawn`/`spawnSync` | local binary | no | stay local: they are capability checks and tiny |

So: the only things that **must** move are the five `runOnPublish` fan-outs. Nothing in the fan-outs needs media on the worker's disk.

## 4. Design

### 4.1 FanoutSupervisor (new, `lcyt-rtmp`)

Replaces `_upsertPath(..., { runOnPublish })`. Interface (all five sites call it):

```
fanout.set(pathName, slots, { label })   // desired state; replaces earlier slots for that path
fanout.clear(pathName)
```

Behaviour:
1. Keeps desired state per path (E already merges slots across keys before calling).
2. **Trigger (revised 2026-10-13, Juha):** MediaMTX hooks are primary. `runOnReady` / `runOnNotReady` in `mediamtx.yml` POST `$MTX_PATH` plus a shared secret to `/internal/mediamtx/path` on the backend (forwarded to the key's owner instance by the L4 forwarding; `/internal` stays off the public proxy). This needs a shell and curl in the MediaMTX container: use the `-ffmpeg` image variant or a tiny custom image with curl, pinned by version and tested in P0. Safety net: a slow reconcile poll of `MediaMtxClient.getPath(pathName).ready` (~30 s, only for paths with a desired fan-out) plus an immediate check after `set()` and at startup, covering lost hooks and backend restarts. nginx-rtmp callbacks are being deprecated and are not relied on. This replaces `kickPath`, which existed only to make MediaMTX fire the old hook.
3. Path ready and desired → start a runner `createFfmpegRunner({ runner, cmd:'ffmpeg', args, purpose:'relay', apiKey, requires })` with args `['-rtsp_transport','tcp','-re','-i',<rtspUrl>,'-c','copy','-f','tee',<tee>]`. `-rtsp_transport tcp` is new and mandatory for remote workers (UDP breaks across NAT/VPN); harmless locally.
4. Path not ready or desired removed → stop the runner (SIGTERM locally, fleet cancel remotely).
5. Runner closes while path is ready and still desired → restart with backoff (1 s, 2 s, … 15 s cap). This is the `runOnPublishRestart: true` semantics.
6. Spec changes (slot list changes) → stop old, start new. Cancel first: a second connection to the same YouTube ingest URL would be rejected, so a short gap beats a duplicate.

Runner choice comes from the existing `compute.ffmpeg_runner`, which becomes `spawn` (local process on the backend host) or `fleet`. The supervisor is runner-agnostic, which is what keeps local fallback and single-instance behaviour for free.

### 4.2 Needed small changes in `lcyt-compute`

- `FleetFfmpegRunner` takes an optional `jobId` (today `purpose-<uuid>`). Deterministic id `fanout-<hash(path + specHash)>-<gen>` makes submit idempotent (fffleet returns the existing job for the same id and spec), which matters for multi-instance takeover (section 7). `gen` increments on every restart because a finished job's id cannot be reused.
- Pass `requires: ['net:mediamtx']` (section 5) and `class: 'stream'`, high `priority` (relays should jump the queue).
- Expose `runner.where` / job id to the supervisor for status and the reaper.

### 4.3 Modes and rollout switch

New setting `mediamtx.fanout_mode`: `hook` (today, legacy) | `runner` (new). Default `hook` until verified, then default `runner` whenever `FFMPEG_RUNNER` is `fleet`, finally `runner` always and the hook code removed. In `runner` mode the stock `bluenviron/mediamtx` image is enough. In `hook` mode the docs say to use the ffmpeg-bundled tag (and fix the compose files, which is a one-line change worth doing in P0 regardless).

## 5. How workers reach MediaMTX

Three streams of traffic to think about, all from the worker:

1. **Read**: RTSP `rtsp://<mediamtx>:8554/<path>` (fan-out, STT, music, perception, crop, processing input). Port 8554 is documented as internal only today.
2. **Publish back**: RTMP `rtmp://<mediamtx>:1935/<path>` (processing output `{key}-out`, crop `{key}-crop`, DSK `dsk/{key}`). MediaMTX currently accepts any publisher without credentials (`source: publisher` on a `~.*` path).
3. **Send out**: the worker pushes to YouTube / Facebook RTMP itself, from its own IP and uplink.

New setting `mediamtx.rtsp_fleet_base_url` (and `mediamtx.rtmp_fleet_base_url`), default = the existing base URLs. The URLs given to **fleet** jobs use these; the backend's own calls keep using the local ones. `127.0.0.1` and compose-internal names are only valid where the worker shares the network.

Topologies, in the order the project tests them:

| Topology | Worker reaches MediaMTX via | Needed |
|---|---|---|
| Local Windows Docker Desktop, everything in `compose.yml` | `rtsp://mediamtx:8554` on the compose network | nothing new; worker containers already join the network |
| Worker on another LAN machine (`setup.mjs` sets `FFFLEET_BIND`) | LAN address of the MediaMTX host | publish 8554/1935 on the LAN interface only; `FFFLEET_PROBE=mediamtx=<host>:8554` on that worker |
| Hetzner burst workers | **Hetzner private network** (decided 2026-10-13, Juha): MediaMTX host and workers on the same Cloud Network, fffleet `hetzner.network` with `advertise: private`; MediaMTX ports 8554/1935 listen on the private address only. A MediaMTX host outside Hetzner (e.g. a home machine) is not on that network: needs a VPN, or MediaMTX moved to Hetzner | see below |

For anything leaving the local network:
- **Auth.** Add MediaMTX internal users: a read-only user (RTSP read on `~.*`) and a publish user (RTMP publish on the worker-owned paths), credentials in the fleet URL (`rtsp://user:pass@host:8554/path`). Today's open `source: publisher` is acceptable inside a compose network, not on a public port.
- **Network.** Prefer a private overlay; otherwise firewall 8554/1935 to the worker IPs, optionally `rtspEncryption: optional` and `rtsps://`.
- **Placement.** Workers run with `FFFLEET_PROBE=mediamtx=<host>:8554`, jobs carry `requires: ['net:mediamtx']`, so a job only lands where the TCP connect succeeds. If none qualifies the job queues; the supervisor falls back after `queueTimeoutMs` (section 6).
- **Cold start.** Hetzner burst servers take tens of seconds to minutes. A live relay cannot wait for that. Keep at least one always-on stream worker next to MediaMTX (the existing `worker-lcyt` has `stream=4`), let burst workers take batch work (Saarnavideo renders, downloads) and overflow only.
- **Cost / bandwidth.** Moving the fan-out off loopback adds one RTSP read of the stream from MediaMTX per fan-out path (not per target). For the same-host worker that is still loopback/compose traffic.
- **Secrets in specs.** Relay target URLs contain stream keys, and the fleet job spec (and `FFFLEET_STATE_FILE`) now holds them, as the MediaMTX path config does today. Keep the orchestrator behind its token/TLS, never log args, and mask targets in `lcyt-compute` accounting. Decide whether that is acceptable (open question 3).


### 5.1 Deployment targets (Juha, 2026-10-13)

**Scope rule:** a deployment is either one LAN or one Hetzner private network, never mixed. Workers always reach MediaMTX on a private address, so no public exposure, no VPN and no TLS/auth work is planned; MediaMTX auth users are optional hardening only. Bursting from a LAN to Hetzner is out of scope.

- MediaMTX runs in the same network as the fleet workers (Hetzner private network when bursting), so the private-network rows above apply without VPN.
- Windows laptops are dev/test. Later one setup (LCYT, MediaMTX, fffleet) runs across **two Windows laptops on the AV network**, a plain LAN with no Hetzner involved. Consequences: the LAN row of the table is the production case, not a test case. MediaMTX ports 8554/1935 are published on the AV-network address (not 0.0.0.0 on every interface) and `FFFLEET_PROBE=mediamtx=<laptop>:8554` goes on the workers of both laptops. The hook target (`/internal/mediamtx/path`) must be an address both the MediaMTX container and, via L4 forwarding, the other laptop's LCYT instance can reach; Docker Desktop containers reach the host as `host.docker.internal`, so prefer both services on one compose network per laptop and the multi overlay for the second. Windows Docker Desktop firewall rules for the published ports are part of the P2 deploy-media work, and the P3 verification matrix gets a "two laptops on one LAN" row.

## 6. Local fallback and single instance

- `FFMPEG_RUNNER=spawn` (default): the supervisor spawns the same ffmpeg **in the backend process/container**, reading `rtsp://127.0.0.1:8554` (or the compose name). Only change versus `hook` mode: ffmpeg now lives in the backend image, not the MediaMTX one. The lcyt `Dockerfile` already installs ffmpeg conditionally; the default build must keep it.
- `FFMPEG_RUNNER=fleet` with `FFFLEET_FALLBACK=local` (default): unreachable fleet → in-process fffleet runs the job on the backend host. `FFFLEET_FALLBACK=none` fails visibly instead.
- Stuck in queue (no worker with `net:mediamtx`): after `RELAY_FLEET_QUEUE_TIMEOUT_MS` (default 10 s) cancel the queued job and run local, with a log line, unless fallback is `none`. Relays are time critical; batch work keeps waiting.
- Single instance, no Postgres, no fleet: identical behaviour to today apart from the process that owns ffmpeg. Nothing requires a leader or table beyond what exists.
- Windows Docker Desktop: no change in kind (compose is the user's choice; the program itself no longer needs the Docker socket); `rtsp://mediamtx:8554` is reached from sibling containers, `host.docker.internal` only if a worker runs outside compose.

## 7. Multi-instance and multi-MediaMTX

Fits `multi-instance-plan-2026-10-12.md` L4 (relay/crop/STT ownership per key, `INSTANCE_URL` forwarding):
- The **owner instance of the key supervises** its fan-outs (one more `withOwnership` user, no new lease type). Stop/status forwarded to the owner as today.
- Deterministic job ids: after takeover the new owner submits the same spec and fffleet returns the existing running job (200, no duplicate), then follows its events. This is the one new reason to have ids in the runner.
- **Orphans.** A running stream job survives a dead owner. Usually it ends by itself because its input (the path) goes away; the leftover case is "owner died, relay disabled meanwhile". Fix: table `fanout_jobs(path, job_id, spec_hash, owner_instance, state, updated_at)` in the rtmp plugin DB; on takeover and at startup the owner reconciles table vs desired state and cancels strays. (fffleet's `GET /v1/jobs` has no documented label filter, so do not rely on listing; confirm in P1.)
- **Several MediaMTX servers** (`plan_multi_mediamtx.md`): the supervisor gets the source URL from a resolver `resolveRtspUrl(pathName, apiKey)`; today it returns the global setting, later the key's assigned server, and `requires` becomes `net:<server id>`. That plan's complaint that `runOnPublish` children sit on the MediaMTX host disappears.

## 8. Phases

- **P0 (hours, no code risk).** Confirm what `bluenviron/mediamtx:latest` contains (shell? ffmpeg?). If no ffmpeg, note in `docs`/README that hook-based relays cannot work with it today. Add the inventory to `rtmp-manager` as a comment or doc. Collapse A/B/C inline copies into `_registerPathFanout` (pure refactor, tests exist: `rtmp-manager-restart.test.js`, `crop-manager.test.js`, `rtmp-manager-camera-source.test.js`).
- **P1.** `FanoutSupervisor` + `mediamtx.fanout_mode` + `lcyt-compute` `jobId`/`requires` options. Unit tests with a fake runner and fake `MediaMtxClient` (ready flips, restart with backoff, slot change, E-merge, stop). Default stays `hook`.
- **P2.** deploy-media: MediaMTX auth users, `*_fleet_base_url` env, `FFFLEET_PROBE` on workers, worker `net:` capability docs, compose overlay for a remote worker. Settings registry + `.env.example` + PORTS.md updated together.
- **P3.** Verification: an e2e with a real MediaMTX binary, ffmpeg test source publishing to it, an ffmpeg-listen RTMP sink as the relay target, and (a) local runner, (b) in-process fleet, (c) real orchestrator + worker in another container. Then Windows Docker Desktop with the full compose, then a second machine, then Hetzner via VPN.
- **P4.** Flip default to `runner` with fleet, then always; remove `runOnPublish` code and the `kickPath` kick; move the processing runner onto settings.
- **P-D (separate thread, independent of P1-P4).** Remove the program-launched Docker runner: `lcyt-compute/src/ffmpeg/docker-runner.js` and its factory case, `docker` in the `compute.ffmpeg_runner` enum (settings registry; treat a stored `docker` value as `spawn` with a startup warning), `FFMPEG_IMAGE`/`DOCKER_HOST`-style settings, `crop-manager` restart-mode branch (`runner === 'docker'`), the placeholder `lcyt-dsk/src/renderer-container.js`, tests (`docker-runner.*`, `ffmpeg.docker.smoke`, the docker part of `rtmp-relay.fifo`), `docker-socket-proxy` service and socket mounts in `docker-compose.yml` and `k8s/cloudfleet`, `scripts/ffmpeg-in-container.sh`, `ops/runbooks/ffmpeg-docker-rollout.md`, `docs/ffmpeg-docker-usage.md`, `docs/plans/plan_dock_ffmpeg.md` and `todo_dock_ffmpeg.md` (archive, mark superseded), CI `docker/lcyt-ffmpeg` build/lint, and mentions in CLAUDE.md files, `.env.example`, `docs/env-vars.md`. Keep `docker/lcyt-dsk-renderer`/fleet-worker images (those run under compose or the fleet, not started by the program). Do this **before or with P1** so the supervisor only has two runners to support. Check first that no deployment sets `FFMPEG_RUNNER=docker`.
- **P5 (optional).** Recording post-processing as fleet batch jobs over S3 segments (needs the `s3://` refs listed as not done in #358). Not MediaMTX-started; listed so it is not forgotten.

## 9. Risks

- Start latency of a relay after publish: hook ping + job submit + worker spawn. Mitigate with a warm stream worker. A lost hook is caught by the ~30 s reconcile poll.
- Orchestrator becomes a dependency of relays (single scheduler, HA out of scope per multi-instance plan). Fallback-to-local covers an outage.
- Fan-out per path now spans two components (supervisor + fleet); failures need visible status. Surface `where`, job id and last failure in the existing relay status route.
- No real MediaMTX / fleet verification exists yet for any of this (also true of recording, #358).
- Hook mode keeps its current quirks until removed (one hook per path, the E merge workaround).

## 10. Decisions wanted from Juha

1. Trigger: decided 2026-10-13, hooks (`runOnReady`/`runOnNotReady` ping) primary with a slow reconcile poll as safety net; supervisor logic stays in the backend.
2. Transport for remote workers: decided, Hetzner private network (VPN only if MediaMTX stays outside Hetzner). MediaMTX auth users still recommended as defence in depth.
3. Relay stream keys in fleet job specs and the orchestrator state file: accepted by Juha 2026-10-13 (keep orchestrator behind token/TLS, never log args, mask targets in accounting).
4. Default flip timing (P4): decided 2026-10-13, after the local Windows run passes; Hetzner verified afterwards.
