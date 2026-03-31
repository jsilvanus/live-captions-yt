# Deployment Guide

This guide covers building, configuring, and deploying LCYT in all supported
configurations — from a single VM with the helper script to a distributed
compute setup with Hetzner autoscaling.

---

## Table of Contents

1. [Deployment modes](#deployment-modes)
2. [Prerequisites](#prerequisites)
3. [Quick start — single VM](#quick-start--single-vm)
4. [Docker images](#docker-images)
5. [Build-time configuration](#build-time-configuration)
6. [Runtime environment variables](#runtime-environment-variables)
7. [ffmpeg runner modes](#ffmpeg-runner-modes)
8. [Distributed mode (orchestrator)](#distributed-mode-orchestrator)
9. [Hetzner autoscaling](#hetzner-autoscaling)
10. [Updating a running deployment](#updating-a-running-deployment)
11. [Networking and reverse proxy](#networking-and-reverse-proxy)
12. [Database and backups](#database-and-backups)

---

## Deployment modes

| Mode | Tooling | When to use |
|------|---------|-------------|
| **Local (single VM)** | `docker-compose.yml` | Development, personal use, single small event |
| **Self-managed orchestrator** | `docker-compose.orchestrator.yml` + Hetzner VMs | Production, moderate scale, full control, cost-optimised |
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
curl http://localhost:3001/sse       # MCP SSE (text/event-stream)
```

---

## Docker images

All image build contexts live under `docker/` or their respective package
directory.

| Image | Build context | Purpose |
|-------|--------------|---------|
| `lcyt-site:latest` | `.` (repo root) | Backend API + MCP SSE server |
| `lcyt-worker-daemon:latest` | `packages/lcyt-worker-daemon/` | ffmpeg worker daemon (distributed mode) |
| `lcyt-ffmpeg:latest` | `docker/lcyt-ffmpeg/` | Ephemeral ffmpeg runner (`FFMPEG_RUNNER=docker`) |
| `lcyt-dsk-renderer:latest` | `docker/lcyt-dsk-renderer/` | Playwright + ffmpeg DSK graphics renderer |

Build all images locally:

```bash
docker build -t lcyt-site:latest .
docker build -t lcyt-worker-daemon:latest packages/lcyt-worker-daemon/
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
`FFMPEG_RUNNER=docker` (ephemeral containers) or `FFMPEG_RUNNER=worker`
(worker daemon), ffmpeg is never called inside this image, so all four flags
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

### MCP SSE server

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_REQUIRE_API_KEY` | _(unset)_ | Set to `1` to require `X-Api-Key` on MCP SSE connections |
| `MCP_SESSION_TTL_MS` | `7200000` | MCP session idle timeout (ms) |
| `LCYT_BACKEND_URL` | `http://localhost:3000` | Backend URL the MCP server connects to |
| `LCYT_API_KEY` | _(unset)_ | API key the MCP server uses for DSK/editor tool calls |
| `LCYT_ADMIN_KEY` | _(unset)_ | Admin key the MCP server uses for production control tools |
| `LCYT_WEB_URL` | _(unset)_ | Public web UI URL embedded in MCP speech session links |
| `SPEECH_PUBLIC_URL` | _(unset)_ | Public URL for MCP speech/ASR capture endpoints |
| `LCYT_LOG_STDERR` | _(unset)_ | Set to `1` to route logs to stderr (required for MCP stdio transport) |

---

## ffmpeg runner modes

The backend can run ffmpeg in three ways, controlled by `FFMPEG_RUNNER`:

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

### `worker`

Jobs are dispatched to `lcyt-worker-daemon` via HTTP through the
`lcyt-orchestrator`. Used in the distributed setup (Phase 4+). The
`lcyt-site` image does **not** need ffmpeg installed.

```
FFMPEG_RUNNER=worker
COMPUTE_ORCHESTRATOR_URL=http://lcyt-orchestrator:4000
BACKEND_INTERNAL_TOKEN=shared-secret
ORCHESTRATOR_FALLBACK=spawn   # fallback if orchestrator is unreachable
```

### `FFMPEG_WRAPPER`

Alternative: set `FFMPEG_WRAPPER` to a path or wrapper script and the
factory will use it regardless of `FFMPEG_RUNNER`. Useful for custom codec
builds or sandboxed binaries.

---

## Distributed mode (orchestrator)

The orchestrator compose file (`docker-compose.orchestrator.yml`) runs a
three-tier architecture:

```
lcyt-backend ──► lcyt-orchestrator ──► lcyt-worker-daemon (warm pool)
                                  └──► burst VMs (Hetzner Cloud, on demand)
```

### Build images

```bash
docker build -t lcyt-site:latest .
docker build -t lcyt-worker-daemon:latest packages/lcyt-worker-daemon/
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg/
```

### Configure

Copy `.env.example` to `.env` and set:

```
JWT_SECRET=...
ADMIN_KEY=...
BACKEND_INTERNAL_TOKEN=...        # shared secret between backend and orchestrator
HETZNER_API_TOKEN=...             # omit to disable burst provisioning
HETZNER_NETWORK_ID=...
HETZNER_SNAPSHOT_ID=...           # see Hetzner autoscaling section
```

### Start

```bash
docker compose -f docker-compose.orchestrator.yml up -d
```

### Orchestrator env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPUTE_ORCHESTRATOR_URL` | `http://lcyt-orchestrator:4000` | Orchestrator base URL (used by the backend) |
| `BACKEND_INTERNAL_TOKEN` | _(required)_ | Shared secret for backend ↔ orchestrator auth |
| `ORCHESTRATOR_FALLBACK` | `spawn` | Runner to use if the orchestrator is unreachable |
| `WARM_POOL_SIZE` | `1` | Minimum number of warm workers to keep alive |
| `BURST_COOLDOWN_MS` | `300000` | Idle milliseconds before destroying a burst worker (5 min) |
| `BURST_QUEUE_LIMIT` | `20` | Pending jobs before the autoscaler provisions burst VMs |
| `MAX_CONCURRENT_BURST_CREATES` | `3` | Max parallel Hetzner VM provisions |
| `ORCHESTRATOR_MAX_PENDING_JOBS` | `50` | Max queued jobs before returning 503 |
| `ORCHESTRATOR_BACKOFF_MS` | `60000` | Base backoff for Hetzner API retries |

### Worker daemon env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_ID` | `worker-0` | Unique identifier for this worker instance |
| `WORKER_MAX_JOBS` | `4` | Maximum concurrent jobs |
| `FFMPEG_IMAGE` | `lcyt-ffmpeg:latest` | Docker image used for ffmpeg jobs |
| `DSK_IMAGE` | `lcyt-dsk-renderer:latest` | Docker image used for DSK renderer jobs |
| `WORKER_AUTH_TOKEN` / `BACKEND_INTERNAL_TOKEN` | _(unset)_ | Optional auth token for all `/jobs` endpoints |

---

## Hetzner autoscaling

When `HETZNER_API_TOKEN` is set, the orchestrator automatically provisions
burst VMs from a pre-baked snapshot when the job queue exceeds
`BURST_QUEUE_LIMIT`.

### Hetzner env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `HETZNER_API_TOKEN` | _(unset)_ | Hetzner Cloud API token. Autoscaling is disabled without this. |
| `HETZNER_NETWORK_ID` | _(unset)_ | Hetzner private network ID for inter-VM communication |
| `HETZNER_SNAPSHOT_ID` | _(unset)_ | ID of the pre-baked worker VM snapshot |
| `HETZNER_SERVER_TYPE_BURST` | `cx31` | Server type for on-demand burst VMs |
| `HETZNER_SERVER_TYPE_WARM` | `cx21` | Server type for warm-pool VMs |
| `HETZNER_LOCATION` | `hel1` | Datacenter location for new VMs |

### Preparing a worker snapshot

See `docs/hetzner_snapshot.md` for the full runbook. The short version:

1. Boot a fresh Hetzner `cx21` Debian 12 VM
2. Install Docker Engine and enable live-restore
3. Pre-pull `lcyt-ffmpeg:latest` (and optionally `lcyt-dsk-renderer:latest`)
4. Install and enable `lcyt-worker-daemon` as a systemd service
5. Stop services and create a snapshot in the Hetzner Console
6. Set `HETZNER_SNAPSHOT_ID` to the snapshot ID

New burst VMs boot from this snapshot and self-register with the orchestrator
via cloud-init. See `docs/hetzner_snapshot.md` for the cloud-init template.

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
- nginx reverse proxy config (API, SSE streams, MCP SSE, radio HLS)
- UFW firewall rules
- RTMP ingest configuration (nginx-rtmp vs. MediaMTX)

**Summary of ports:**

| Port | Service | Expose publicly? |
|------|---------|-----------------|
| 80 / 443 | nginx | Yes |
| 1935 | RTMP ingest | Yes (if streaming is in use) |
| 3000 | lcyt-backend API | No — via nginx only |
| 3001 | lcyt-mcp-sse | No — via nginx if needed |
| 4000 | lcyt-orchestrator | No — internal |
| 5000 | lcyt-worker-daemon | No — internal |
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
