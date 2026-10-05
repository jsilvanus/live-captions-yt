# Deployment Guide

This guide covers building, configuring, and deploying LCYT in all supported
configurations — from a single VM with the helper script to a distributed
compute setup on an fffleet fleet.

---

## Table of Contents

1. [Deployment modes](#deployment-modes)
2. [Prerequisites](#prerequisites)
3. [Quick start — single VM](#quick-start--single-vm)
4. [Docker images](#docker-images)
5. [Build-time configuration](#build-time-configuration)
6. [Runtime environment variables](#runtime-environment-variables)
7. [ffmpeg runner modes](#ffmpeg-runner-modes)
8. [Distributed mode (fffleet)](#distributed-mode-fffleet)
9. [Updating a running deployment](#updating-a-running-deployment)
10. [Networking and reverse proxy](#networking-and-reverse-proxy)
11. [Database and backups](#database-and-backups)

---

## Deployment modes

| Mode | Tooling | When to use |
|------|---------|-------------|
| **Local (single VM)** | `docker-compose.yml` | Development, personal use, single small event |
| **fffleet fleet** | `FFMPEG_RUNNER=fleet` + an [fffleet](https://github.com/jsilvanus/fffleet) orchestrator and workers (its own compose file and autoscaling for Docker or Hetzner) | Production, moderate scale, ffmpeg offloaded to other machines |
| **Cloudfleet (Kubernetes)** | `k8s/cloudfleet/` manifests | Managed HA cluster, rolling deploys, minimal ops overhead |

See `docs/plans/plan_cloudfleet.md` for a full comparison of all three tiers
and the Cloudfleet deployment guide.

In the first two modes the web UI (`lcyt-web`) and the marketing site
(`lcyt-site`) are built on the host and served by nginx as static files — they
are **not** baked into any Docker image.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2 (`docker compose`)
- Node.js 20+ and npm 10+ (for host-side builds: web UI, site, bridge)
- nginx (reverse proxy + optional RTMP ingest)
- A domain with DNS pointed at the server and a TLS certificate (certbot works)

---

## Quick start — single VM

### 1. Configure environment

```bash
cp .env.example .env
# Required: set JWT_SECRET and ADMIN_KEY at minimum
$EDITOR .env
```

### 2. Run the deploy script

The `scripts/deploy.sh` script handles everything in one shot: git
clone/pull, web UI build, Docker Compose up, site and bridge builds.

```bash
# First deploy (clones the repo)
REPO_URL=git@github.com:you/live-captions-yt.git \
JWT_SECRET=your-secret \
bash scripts/deploy.sh ~/lcyt

# Subsequent deploys (pulls, rebuilds, restarts)
bash ~/lcyt/scripts/deploy.sh
```

The script runs these steps in order:

| Step | What it does |
|------|-------------|
| git clone / pull | Fetches latest from `GIT_BRANCH` (default: `main`). Self-updates if `deploy.sh` itself changed. |
| Build `lcyt-web` | Runs `npm run build -w packages/lcyt-web` → `packages/lcyt-web/dist/` |
| Capture screenshots | Background job: installs Playwright Chromium, captures UI screenshots for Astro site |
| `docker compose up` | Builds and starts `lcyt-site` + `mediamtx` containers |
| Build `lcyt-bridge` | Compiles bridge executables (win/mac/linux/linux-arm64) |
| Build `lcyt-site` | Runs Astro build → `packages/lcyt-site/dist/` |

After the first deploy, create nginx symlinks so the static files are served:

```bash
# Web UI
ln -sfn ~/lcyt/packages/lcyt-web/dist /var/www/html/lcyt-web

# Marketing / docs site
ln -sfn ~/lcyt/packages/lcyt-site/dist /var/www/html/lcyt-site
```

See [Networking and reverse proxy](#networking-and-reverse-proxy) for the nginx
config.

### 3. Partial deploys (`--only`)

```bash
# Rebuild and restart only the backend container
bash scripts/deploy.sh --only backend

# Rebuild only the web UI
bash scripts/deploy.sh --only app

# Rebuild only the Astro marketing site
bash scripts/deploy.sh --only site

# Rebuild only the bridge executables
bash scripts/deploy.sh --only bridge

# Re-capture UI screenshots only
bash scripts/deploy.sh --only screenshots
```

### 4. Verify

```bash
curl http://localhost:3000/health    # backend
curl http://localhost:3001/mcp       # MCP Streamable HTTP
```

---

## Docker images

All image build contexts live under `docker/` or their respective package
directory.

| Image | Build context | Purpose |
|-------|--------------|---------|
| `lcyt-site:latest` | `.` (repo root) | Backend API + MCP Streamable HTTP server |
| `lcyt-ffmpeg:latest` | `docker/lcyt-ffmpeg/` | Ephemeral ffmpeg runner (`FFMPEG_RUNNER=docker`) |
| `lcyt-dsk-renderer:latest` | `docker/lcyt-dsk-renderer/` | Playwright + ffmpeg DSK graphics renderer |

Build all images locally:

```bash
docker build -t lcyt-site:latest .
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg/
docker build -t lcyt-dsk-renderer:latest docker/lcyt-dsk-renderer/
```

Only `lcyt-site` is required for a basic deployment. The others are needed
depending on which features are enabled.

---

## Build-time configuration

Build args are passed with `--build-arg` on the CLI or via the `args:` block
in `docker-compose.yml`. See `scripts/build.env.example` for a template.

### `lcyt-site` build args

| Arg | Default | Effect |
|-----|---------|--------|
| `APT_MIRROR` | _(unset)_ | Replace `deb.debian.org` with a faster mirror during build. Example for Hetzner: `http://mirror.hetzner.com/debian/packages` |
| `RTMP_RELAY_ACTIVE` | `0` | Install ffmpeg for RTMP relay in local-spawn mode. **Not needed** when `FFMPEG_RUNNER=docker` or `FFMPEG_RUNNER=worker`. |
| `RADIO_ACTIVE` | `0` | Install ffmpeg for audio-only HLS (radio) in local-spawn mode. **Not needed** when `RADIO_HLS_SOURCE=mediamtx`. |
| `HLS_ACTIVE` | `0` | Install ffmpeg for video+audio HLS in local-spawn mode. |
| `PREVIEW_ACTIVE` | `0` | Install ffmpeg for JPEG thumbnail generation in local-spawn mode. |
| `GRAPHICS_ENABLED` | `0` | Install Chromium for the DSK Playwright renderer. Also controls the `/images` and `/dsk` endpoints at runtime. |

**When is ffmpeg needed in the image?**

ffmpeg is only installed in `lcyt-site` when one of the four feature flags
above is set to `1` **and** `FFMPEG_RUNNER=spawn` (the default). If you use
`FFMPEG_RUNNER=docker` (ephemeral containers) or `FFMPEG_RUNNER=fleet`
(fffleet workers), ffmpeg is never called inside this image, so all four flags
can stay at `0`.

### Vite build args (`lcyt-web`)

These are passed as environment variables during `npm run build:web`:

| Variable | Purpose |
|----------|---------|
| `VITE_BACKUP_DAYS` | Backup retention value shown in the Privacy modal |
| `VITE_SITE_URL` | Base URL baked into the web bundle |
| `VITE_API_KEY` | Optional API key baked into the bundle — **do not commit** |

---

## Runtime environment variables

Set these in your `.env` file (loaded by `docker compose`) or export them
before running the backend directly.

### Required

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | HS256 signing key for session and user JWTs. Generate with `openssl rand -hex 32`. A random key is used if unset, but all tokens become invalid on restart. |
| `ADMIN_KEY` | API key for admin endpoints (`X-Admin-Key` header). Disables admin routes if unset. |

### Core application

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for the backend |
| `DB_PATH` | `./lcyt-backend.db` | Path to the SQLite database file |
| `PUBLIC_URL` | _(unset)_ | Server's public URL, used in generated `.env` file downloads |
| `STATIC_DIR` | _(unset)_ | Directory to serve as static files (e.g. `packages/lcyt-web/dist`) |
| `TRUST_PROXY` | `true` | Express `trust proxy` setting; keep `true` behind nginx |
| `NODE_ENV` | `production` | Node environment |

### Access control

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_DOMAINS` | `lcyt.fi,www.lcyt.fi,localhost` | Comma-separated domains permitted as session origins (CORS allowlist) |
| `ALLOWED_RTMP_DOMAINS` | _(falls back to `ALLOWED_DOMAINS`)_ | Domains allowed to use the `/stream` RTMP relay endpoints |
| `FREE_APIKEY_ACTIVE` | _(unset)_ | Set to `1` to enable free-tier API key self-registration at `POST /keys?freetier` |
| `USE_USER_LOGINS` | _(enabled)_ | Set to `0` to disable user registration and login (`/auth` routes) |
| `USAGE_PUBLIC` | _(unset)_ | Set to any value to make `GET /usage` public (no admin key required) |

### Session management

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_TTL` | `7200000` | Session idle timeout in milliseconds (default 2 h) |
| `CLEANUP_INTERVAL` | `300000` | How often to sweep and expire idle sessions (ms) |
| `REVOKED_KEY_TTL_DAYS` | `30` | Days before purging revoked API keys from the database |
| `REVOKED_KEY_CLEANUP_INTERVAL` | `86400000` | Interval for the revoked-key cleanup sweep (ms) |

### Contact info

Returned by `GET /contact` (public endpoint).

| Variable | Description |
|----------|-------------|
| `CONTACT_NAME` | Operator display name |
| `CONTACT_EMAIL` | Contact email |
| `CONTACT_PHONE` | Contact phone |
| `CONTACT_WEBSITE` | Contact website URL |

### RTMP relay

| Variable | Default | Description |
|----------|---------|-------------|
| `RTMP_RELAY_ACTIVE` | _(unset)_ | Set to `1` to enable RTMP relay endpoints |
| `RTMP_HOST` | _(unset)_ | Default RTMP host for relay |
| `RTMP_APP` / `RTMP_APPLICATION` | _(unset)_ | Default RTMP application name |
| `RTMP_CONTROL_URL` | _(unset)_ | nginx-rtmp control URL (legacy fallback for `dropPublisher`) |

### HLS and radio streaming

| Variable | Default | Description |
|----------|---------|-------------|
| `RADIO_HLS_SOURCE` | `ffmpeg` | Radio HLS backend: `ffmpeg` (spawn local) or `mediamtx` (no ffmpeg) |
| `HLS_ROOT` | `/tmp/hls-video` | Directory for video+audio HLS output |
| `HLS_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | Local RTMP base URL for HLS pipelines |
| `HLS_RTMP_APP` | `live` | RTMP application name for HLS |
| `HLS_SUBS_ROOT` | `/tmp/hls-subs` | Directory for WebVTT subtitle segment files |
| `HLS_SUBS_SEGMENT_DURATION` | `6` | Subtitle segment length in seconds |
| `HLS_SUBS_WINDOW_SIZE` | `10` | Number of subtitle segments to keep per language |
| `RADIO_HLS_ROOT` | `/tmp/hls` | Directory for audio-only HLS output (ffmpeg mode) |
| `RADIO_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | Local RTMP base URL for radio pipelines |
| `RADIO_RTMP_APP` | `live` | RTMP application name for radio |

### Preview thumbnails

| Variable | Default | Description |
|----------|---------|-------------|
| `PREVIEW_ROOT` | `/tmp/previews` | Directory for JPEG thumbnail files |
| `PREVIEW_INTERVAL_S` | `5` | Seconds between thumbnail refresh |

### MediaMTX integration

Used when `RADIO_HLS_SOURCE=mediamtx` or when MediaMTX manages RTMP paths.

| Variable | Default | Description |
|----------|---------|-------------|
| `MEDIAMTX_API_URL` | `http://mediamtx:9997` | MediaMTX v3 REST API base URL |
| `MEDIAMTX_HLS_BASE_URL` | `http://mediamtx:8080` | HLS base URL used by NginxManager for internal `proxy_pass` |
| `MEDIAMTX_API_USER` | _(unset)_ | Basic-auth username for the MediaMTX API |
| `MEDIAMTX_API_PASSWORD` | _(unset)_ | Basic-auth password for the MediaMTX API |

### nginx radio proxy (NginxManager)

NginxManager writes slug-based nginx `location` blocks so radio streams are
served at public URLs like `/r/<slug>/` without exposing API keys.
Leave `NGINX_RADIO_CONFIG_PATH` unset to skip this and serve radio HLS
directly from the Node.js backend.

| Variable | Default | Description |
|----------|---------|-------------|
| `NGINX_RADIO_CONFIG_PATH` | _(unset)_ | Path to the nginx include file managed by NginxManager |
| `NGINX_TEST_CMD` | `nginx -t` | Command to test nginx config before reloading |
| `NGINX_RELOAD_CMD` | `nginx -s reload` | Command to reload nginx after writing the config |
| `NGINX_RADIO_PREFIX` | `/r` | Public URL prefix for radio slug locations |

### DSK graphics

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPHICS_ENABLED` | _(unset)_ | Set to `1` to enable image upload, DSK endpoints, and the Playwright renderer |
| `GRAPHICS_DIR` | `/data/images` | Directory for uploaded overlay images |
| `GRAPHICS_MAX_FILE_BYTES` | `5242880` | Max bytes per uploaded image (5 MB) |
| `GRAPHICS_MAX_STORAGE_BYTES` | `52428800` | Max total image storage per API key (50 MB) |
| `PLAYWRIGHT_DSK_CHROMIUM` | Playwright cache | Path to the Chromium binary used by the DSK renderer |
| `DSK_LOCAL_SERVER` | `http://localhost:$PORT` | URL Chromium fetches templates from |
| `DSK_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | nginx-rtmp base URL for DSK RTMP output |
| `DSK_RTMP_APP` | `live` | RTMP application name for DSK renderer output |

### Caption file storage

| Variable | Default | Description |
|----------|---------|-------------|
| `FILE_STORAGE` | `local` | Storage backend: `local` or `s3` |
| `FILES_DIR` | `/data/files` | Base directory for the local storage adapter |
| `S3_BUCKET` | _(unset)_ | S3 bucket name (required when `FILE_STORAGE=s3`) |
| `S3_REGION` | `auto` | AWS region, or `auto` for Cloudflare R2 |
| `S3_ENDPOINT` | _(unset)_ | Custom S3-compatible endpoint (R2, MinIO, Backblaze B2) |
| `S3_PREFIX` | `captions` | Object key prefix within the bucket |
| `S3_ACCESS_KEY_ID` | _(unset)_ | Static credentials (falls back to AWS credential chain) |
| `S3_SECRET_ACCESS_KEY` | _(unset)_ | Static credentials secret |

### Database backups

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DAYS` | `0` | Days of daily backups to retain (0 = disabled, max 180) |
| `BACKUP_DIR` | _(unset)_ | Directory where daily backups are written |

### Server-side STT

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PROVIDER` | `google` | Default STT provider: `google`, `whisper_http`, or `openai` |
| `STT_DEFAULT_LANGUAGE` | `en-US` | Default BCP-47 language tag |
| `STT_AUDIO_SOURCE` | `hls` | Default audio source: `hls`, `rtmp`, or `whep` |
| `GOOGLE_APPLICATION_CREDENTIALS` | _(unset)_ | Path to Google service account JSON |
| `GOOGLE_STT_KEY` | _(unset)_ | Google Cloud STT REST API key (simpler alternative to service account) |
| `GOOGLE_STT_MODE` | `rest` | Google STT mode: `rest` or `grpc` (lower latency; requires `@google-cloud/speech`) |
| `WHISPER_HTTP_URL` | _(unset)_ | Base URL of a Whisper-compatible HTTP STT server |
| `WHISPER_HTTP_MODEL` | _(unset)_ | Model name for the Whisper HTTP server |
| `OPENAI_STT_URL` | OpenAI default | Base URL for an OpenAI-compatible STT endpoint |
| `OPENAI_STT_API_KEY` | _(unset)_ | API key for the OpenAI STT endpoint |
| `OPENAI_STT_MODEL` | `whisper-1` | Model name for OpenAI STT requests |

### YouTube / OAuth

| Variable | Default | Description |
|----------|---------|-------------|
| `YOUTUBE_CLIENT_ID` | _(unset)_ | Google OAuth 2.0 Web client ID returned by `GET /youtube/config` |

### MCP Streamable HTTP server

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_REQUIRE_API_KEY` | _(unset)_ | Set to `1` to require `X-Api-Key` on MCP Streamable HTTP connections |
| `MCP_SESSION_TTL_MS` | `7200000` | MCP session idle timeout (ms) |
| `LCYT_BACKEND_URL` | `http://localhost:3000` | Backend URL the MCP server connects to |
| `LCYT_API_KEY` | _(unset)_ | API key the MCP server uses for DSK/editor tool calls |
| `LCYT_ADMIN_KEY` | _(unset)_ | Admin key the MCP server uses for production control tools |
| `LCYT_WEB_URL` | _(unset)_ | Public web UI URL embedded in MCP speech session links |
| `SPEECH_PUBLIC_URL` | _(unset)_ | Public URL for MCP speech/ASR capture endpoints |
| `LCYT_LOG_STDERR` | _(unset)_ | Set to `1` to route logs to stderr (required for MCP stdio transport) |

---

## ffmpeg runner modes

The backend can run ffmpeg in four ways, controlled by `FFMPEG_RUNNER`:

### `spawn` (default)

ffmpeg is executed as a child process inside the `lcyt-site` container.
Requires ffmpeg to be installed in the image (set the appropriate build args).

```
FFMPEG_RUNNER=spawn
```

### `docker`

The backend spawns ephemeral `lcyt-ffmpeg` containers per job via the Docker
socket. The `lcyt-site` image does **not** need ffmpeg installed. A Docker
socket proxy is recommended for security.

```
FFMPEG_RUNNER=docker
FFMPEG_IMAGE=lcyt-ffmpeg:latest
DOCKER_HOST=http://docker-socket-proxy:2375   # recommended
```

Enable the socket proxy profile in the compose file:

```bash
docker compose --profile docker-runner up -d
```

### `fleet`

Jobs go to an [fffleet](https://github.com/jsilvanus/fffleet) fleet: an
`fffleet-orchestrator` (or a single `fffleet-worker`). Unlike `worker`, the end of a job that
finishes by itself is reported, so a relay that dies is noticed. With no
`FFFLEET_URL`, or when the fleet cannot be reached, ffmpeg runs on this machine
(`FFFLEET_FALLBACK=none` disables that). SRT cues for CEA-708 go through ffmpeg's stdin on the worker.

```
FFMPEG_RUNNER=fleet
FFFLEET_URL=http://fffleet-orchestrator:4000
FFFLEET_CLIENT_ID=lcyt            # or FFFLEET_TOKEN=...
FFFLEET_CLIENT_SECRET=...
```

Perception jobs run on the same fleet as the `perception` job type (workers started with
`FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor`; image `docker/lcyt-perception-worker/`).

**DSK on the fleet.** With `DSK_RENDER_EXECUTOR=fleet` (and `FFFLEET_URL`) per-viewport DSK streams run as `dsk` jobs: a worker started from `docker/lcyt-dsk-worker/` (`FFFLEET_EXECUTORS=lcyt-dsk/fffleet-executor`) opens the viewport's display page in its own Chromium and pushes the encoded stream to the RTMP URLs itself, so the backend no longer runs Chromium for them. Set `DSK_PAGE_BASE_URL` to the backend's public address (a `localhost` value is refused) and make sure the worker can reach the RTMP ingest. A backend restart that starts the stream again re-attaches to the running job. The legacy per-key renderer stays local.
The Admin → Metrics page shows a Fleet tile (workers, slots, queue, autoscaler) read from the
orchestrator's `/metrics`; the token or client needs the `metrics` scope (a client login asks for
it automatically, so the client must be allowed `metrics`).
`FFMPEG_RUNNER=worker` and the old `lcyt-orchestrator` / `lcyt-worker-daemon` packages are gone.

**Network requirements.** A fleet worker is a different machine, so every input and output
in an ffmpeg command must be reachable *from the worker*, not from the backend:

- **RTMP relay** (`rtmp://…` ingest and the YouTube/target URLs): the worker pulls the
  stream from your MediaMTX/nginx ingest, so the ingest must listen on an address the worker
  can reach (a public or VPN address, not `localhost`) and its port must be open to the
  worker. The backend's `RTMP_LOCAL_*`/`localhost` defaults only work with the local runner.
- **STT, music analysis, PCM decode:** read the same ingest or HLS URLs, so the same rule applies.
- **Camera preview/frame URLs for perception:** the worker fetches frames from
  `CAMERA_PREVIEW_BASE_URL`/the backend's public URL, which therefore must not be
  `localhost` either.
- **fffleet itself:** the backend reaches the orchestrator at `FFFLEET_URL`, and the workers
  reach it for registration; S3 (if used for staged files) must be reachable by both.
- **HLS manager** stays on the backend machine on purpose (it re-muxes a local stream).

**When a fleet job fails.** The backend logs the fleet's error code and message, the worker
that ran it and the tail of ffmpeg's stderr (`[rtmp] ffmpeg exited with code … : [FFMPEG_EXIT] …`),
the stream route `GET /stream` returns `lastExit { at, code, reason, workerId }` while no
relay is running, and the relay panel shows it as "Relay stopped with an error". Callers of
`spawnFfmpeg` get the same text on the fake process's `stderr` and as `proc.failure`.
With fffleet 2.1 or later a *running* job also reports ffmpeg's newest stderr lines: the runner
exposes them as `runner.stderrTail` (event `stderrTail`; `proc.stderrTail` on a `spawnFfmpeg`
process), `GET /stream` returns `stderrTail` while a relay runs, and the relay panel shows it
under "Worker log" (refreshed every 5 s). A local ffmpeg has no such field. The fleet returns an
empty stderr tail for streamed jobs that run to a clean end; only the error code and message are
available for jobs that fail before ffmpeg starts (`WORKER_LOST`, no worker with the required
capabilities, …).

### `FFMPEG_WRAPPER`

Alternative: set `FFMPEG_WRAPPER` to a path or wrapper script and the
factory will use it regardless of `FFMPEG_RUNNER`. Useful for custom codec
builds or sandboxed binaries.

---

## Distributed mode (fffleet)

Heavy ffmpeg work (relays, STT, music analysis, DSK, perception) can run on other machines
through [fffleet](https://github.com/jsilvanus/fffleet):

```
lcyt-backend ──FFFLEET_URL──► fffleet-orchestrator ──► fffleet-worker (one per VM or container)
                                      └──► autoscaled workers (Docker, Hetzner Cloud, local processes)
```

Set `FFMPEG_RUNNER=fleet` and `FFFLEET_URL` (see [`fleet`](#fleet) above). Running the orchestrator and
workers, logins (`FFFLEET_CLIENT_ID`/`FFFLEET_CLIENT_SECRET`), S3 staging, autoscaling pools (including
Hetzner) and metrics are documented in the fffleet README and its `fffleet.example.yaml`. The orchestrator
can keep its queue across restarts with `FFFLEET_STATE_FILE`.

---

## Updating a running deployment

```bash
# Full redeploy (pull, rebuild web UI, restart backend)
bash scripts/deploy.sh

# Backend only (fastest for server-side changes)
bash scripts/deploy.sh --only backend

# Web UI only (no container restart)
bash scripts/deploy.sh --only app
```

The deploy script detects if `deploy.sh` itself changed during the git pull
and automatically re-executes the updated version before continuing.

---

## Networking and reverse proxy

See `docs/FIREWALL.md` for:
- The full port reference (public vs. internal-only)
- nginx reverse proxy config (API, SSE streams, MCP Streamable HTTP, radio HLS)
- UFW firewall rules
- RTMP ingest configuration (nginx-rtmp vs. MediaMTX)

**Summary of ports:**

| Port | Service | Expose publicly? |
|------|---------|-----------------|
| 80 / 443 | nginx | Yes |
| 1935 | RTMP ingest | Yes (if streaming is in use) |
| 3000 | lcyt-backend API | No — via nginx only |
| 3001 | lcyt-mcp-http | No — via nginx if needed |
| 5000 | fffleet-orchestrator (default) | No — internal |
| 8080 | MediaMTX HLS | No — via nginx proxy |
| 9997 | MediaMTX REST API | No — internal |

---

## Database and backups

The backend uses SQLite. The database file is stored at `DB_PATH`
(default `/data/lcyt.sqlite` in Docker, backed by the `lcyt-db` named volume).

Enable daily backups by setting:

```
BACKUP_DAYS=30        # keep 30 days of backups
BACKUP_DIR=/backups   # volume-mount this directory
```

Backups are written once per day to `$BACKUP_DIR/<YYYY-MM-DD>/lcyt-backend.db`.
