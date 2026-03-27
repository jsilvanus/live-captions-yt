# Deployment Guide

This document covers how to deploy the LCYT platform and documents all environment variables.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Deployment Options](#deployment-options)
  - [Docker Compose (recommended)](#docker-compose-recommended)
  - [Bare-metal / systemd](#bare-metal--systemd)
  - [Distributed (Orchestrator mode)](#distributed-orchestrator-mode)
- [Building](#building)
  - [Backend + API](#backend--api)
  - [Web UI](#web-ui)
  - [Docker Images](#docker-images)
- [Ports & Firewall](#ports--firewall)
- [Environment Variables](#environment-variables)
  - [Required](#required)
  - [Application](#application)
  - [Session & Cleanup](#session--cleanup)
  - [RTMP Relay](#rtmp-relay)
  - [MediaMTX Integration](#mediamtx-integration)
  - [NginxManager (Radio Proxy)](#nginxmanager-radio-proxy)
  - [ffmpeg Runner](#ffmpeg-runner)
  - [HLS & Video](#hls--video)
  - [Radio HLS](#radio-hls)
  - [Stream Preview](#stream-preview)
  - [HLS Subtitle Sidecar](#hls-subtitle-sidecar)
  - [DSK Graphics](#dsk-graphics)
  - [File Storage](#file-storage)
  - [S3-Compatible Storage](#s3-compatible-storage)
  - [Server-Side STT](#server-side-stt)
  - [Google Cloud STT](#google-cloud-stt)
  - [Whisper HTTP STT](#whisper-http-stt)
  - [OpenAI STT](#openai-stt)
  - [YouTube OAuth](#youtube-oauth)
  - [User Accounts](#user-accounts)
  - [Contact Info](#contact-info)
  - [Backups](#backups)
  - [Bridge Agent Downloads](#bridge-agent-downloads)
  - [MCP Server (SSE)](#mcp-server-sse)
  - [Compute Orchestrator](#compute-orchestrator)
  - [Hetzner Cloud (Burst VMs)](#hetzner-cloud-burst-vms)
  - [Worker Daemon](#worker-daemon)
  - [Dockerfile Build Args](#dockerfile-build-args)
- [Reverse Proxy (nginx)](#reverse-proxy-nginx)
- [SSL / TLS](#ssl--tls)
- [Database](#database)
- [Monitoring](#monitoring)

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/jsilvanus/live-captions-yt.git
cd live-captions-yt
npm install

# 2. Configure
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and ADMIN_KEY

# 3. Start with Docker Compose
docker compose up

# Or start bare-metal
npm run start:backend
```

---

## Deployment Options

### Docker Compose (recommended)

The simplest production setup. Uses `docker-compose.yml` which starts:

- **lcyt-site** — LCYT backend API (port 3000) + MCP SSE server (port 3001)
- **mediamtx** — MediaMTX RTMP/HLS broker (ports 1935, 8080, 9997)
- **docker-socket-proxy** — (opt-in) secure Docker socket proxy for containerised ffmpeg

```bash
cp .env.example .env
# Fill in JWT_SECRET, ADMIN_KEY, and other required vars

# Basic (no RTMP relay)
docker compose up -d

# With RTMP relay + MediaMTX radio
RTMP_RELAY_ACTIVE=1 RADIO_HLS_SOURCE=mediamtx docker compose up -d

# With Docker socket proxy (for FFMPEG_RUNNER=docker)
docker compose --profile docker-runner up -d
```

### Bare-metal / systemd

```bash
npm install
npm run build          # Build CJS output for lcyt core library
npm run build:web      # Build web UI → packages/lcyt-web/dist/

# Start the backend (serves API + optionally static web UI)
STATIC_DIR=packages/lcyt-web/dist npm run start:backend
```

Create a systemd unit:

```ini
[Unit]
Description=LCYT Backend
After=network.target

[Service]
Type=simple
User=lcyt
WorkingDirectory=/opt/live-captions-yt
EnvironmentFile=/opt/live-captions-yt/.env
ExecStart=/usr/bin/node packages/lcyt-backend/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Distributed (Orchestrator mode)

For high-availability deployments with autoscaling ffmpeg workers. Uses `docker-compose.orchestrator.yml` which starts four services:

- **lcyt-backend** — API server (no Docker socket, `FFMPEG_RUNNER=worker`)
- **lcyt-orchestrator** — Job scheduler + Hetzner VM lifecycle (port 4000)
- **lcyt-worker-daemon** — Docker socket owner, runs ffmpeg containers (port 5000)
- **mediamtx** — RTMP/HLS broker

```bash
# Build required images
docker build -t lcyt-site:latest .
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg/
# Build worker daemon (if separate image needed)
# docker build -t lcyt-worker-daemon:latest packages/lcyt-worker-daemon/

# Fill in required vars
cp .env.example .env
# Set: JWT_SECRET, ADMIN_KEY, BACKEND_INTERNAL_TOKEN
# For Hetzner burst: HETZNER_API_TOKEN, HETZNER_NETWORK_ID, HETZNER_SNAPSHOT_ID

docker compose -f docker-compose.orchestrator.yml up -d
```

---

## Building

### Backend + API

```bash
npm install              # Install all workspace dependencies
npm run build            # Build lcyt CJS output (ESM→CJS)
```

### Web UI

```bash
npm run build:web        # Build lcyt-web for production → packages/lcyt-web/dist/
npm run build:site       # Build lcyt-web then lcyt-site (Astro marketing site)
```

### Docker Images

```bash
# Main backend image (includes backend + all plugins + MCP SSE)
docker build -t lcyt-site:latest .

# With ffmpeg (for RTMP relay, radio, HLS, preview)
docker build -t lcyt-site:latest --build-arg RTMP_RELAY_ACTIVE=1 .

# With Chromium (for DSK graphics rendering)
docker build -t lcyt-site:latest --build-arg GRAPHICS_ENABLED=1 .

# ffmpeg compute container (for FFMPEG_RUNNER=docker)
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg/

# DSK renderer container (for containerised Playwright rendering)
docker build -t lcyt-dsk-renderer:latest docker/lcyt-dsk-renderer/
```

---

## Ports & Firewall

| Port | Protocol | Service | Public? | Env override |
|------|----------|---------|---------|-------------|
| **3000** | HTTP | lcyt-backend (Express) | Behind nginx | `PORT` |
| **3001** | HTTP | lcyt-mcp-sse server | Optional | `PORT` (MCP) |
| **1935** | RTMP | MediaMTX — publisher ingest | Yes | — |
| **8080** | HTTP | MediaMTX — HLS output | No (internal) | `MEDIAMTX_HLS_BASE_URL` |
| **8554** | RTSP | MediaMTX — RTSP output | No (loopback) | `MEDIAMTX_RTSP_BASE_URL` |
| **8889** | HTTP/WS | MediaMTX — WebRTC preview | Optional | `MEDIAMTX_WEBRTC_BASE_URL` |
| **9997** | HTTP | MediaMTX — REST API | No (internal) | `MEDIAMTX_API_URL` |
| **80/443** | HTTP/S | nginx reverse proxy | Yes | — |
| **4000** | HTTP | lcyt-orchestrator | No (internal) | `PORT` (orchestrator) |
| **5000** | HTTP | lcyt-worker-daemon | No (internal) | `PORT` (worker) |

**Recommended firewall rules (production):**

```
# Public — must be open
TCP  80    nginx HTTP (→ HTTPS redirect)
TCP  443   nginx HTTPS
TCP  1935  MediaMTX RTMP ingest

# Optional — open only if WebRTC preview is needed
TCP  8889  MediaMTX WebRTC

# Internal — loopback / private network only
TCP  3000  lcyt-backend
TCP  3001  lcyt-mcp-sse
TCP  4000  lcyt-orchestrator
TCP  5000  lcyt-worker-daemon
TCP  8080  MediaMTX HLS
TCP  8554  MediaMTX RTSP
TCP  9997  MediaMTX REST API
```

---

## Environment Variables

All configuration is via environment variables (12-factor style). Copy `.env.example` to `.env` and fill in required values.

### Required

| Variable | Description | Default |
|---|---|---|
| `JWT_SECRET` | HS256 signing key for session and user JWTs. **Must be set in production.** | Auto-generated (warns at startup) |
| `ADMIN_KEY` | Admin API key for `/keys` admin routes. Uses constant-time comparison. | None (disables admin endpoints) |

### Application

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port for lcyt-backend | `3000` |
| `DB_PATH` | SQLite database file path | `./lcyt-backend.db` |
| `STATIC_DIR` | Serve static files from this directory (e.g. built web UI) | None |
| `PUBLIC_URL` | Server's public URL (used in generated .env downloads, bridge URLs) | None |
| `BACKEND_URL` | Server's own URL for internal use (DSK renderer, etc.) | None |
| `TRUST_PROXY` | Express `trust proxy` value (set to `true` behind nginx) | `true` |
| `ALLOWED_DOMAINS` | Comma-separated domains for session CORS filter | `lcyt.fi,www.lcyt.fi,localhost` |
| `ALLOWED_RTMP_DOMAINS` | Domains allowed to use `/stream` relay endpoints; falls back to `ALLOWED_DOMAINS` | Falls back |
| `NODE_ENV` | Node.js environment (`production` / `development`) | `development` |
| `FREE_APIKEY_ACTIVE` | Set to `1` to enable free API key self-registration at `POST /keys?freetier` | `0` |
| `USAGE_PUBLIC` | If set, `/usage` endpoint needs no auth | Unset |
| `ICONS_DIR` | Directory for icon assets served at `/icons/*` | None |

### Session & Cleanup

| Variable | Description | Default |
|---|---|---|
| `SESSION_TTL` | Session timeout in milliseconds | `7200000` (2h) |
| `CLEANUP_INTERVAL` | Session cleanup sweep interval in milliseconds | `300000` (5m) |
| `REVOKED_KEY_TTL_DAYS` | Days before revoked API keys are purged | `30` |
| `REVOKED_KEY_CLEANUP_INTERVAL` | Revoked key cleanup interval in milliseconds | `86400000` (24h) |

### RTMP Relay

| Variable | Description | Default |
|---|---|---|
| `RTMP_RELAY_ACTIVE` | Set to `1` to enable RTMP relay functionality | `0` |
| `RTMP_HOST` | RTMP host for relay destination | None |
| `RTMP_APP` / `RTMP_APPLICATION` | RTMP application name for relay | None |
| `RTMP_CONTROL_URL` | nginx-rtmp control URL (legacy fallback for `dropPublisher`) | None |

### MediaMTX Integration

| Variable | Description | Default |
|---|---|---|
| `MEDIAMTX_API_URL` | MediaMTX v3 REST API base URL | `http://localhost:9997` |
| `MEDIAMTX_HLS_BASE_URL` | MediaMTX HLS base URL (used by NginxManager for proxy_pass) | `http://127.0.0.1:8080` |
| `MEDIAMTX_RTSP_BASE_URL` | MediaMTX RTSP base URL (used by relay `runOnPublish`) | `rtsp://127.0.0.1:8554` |
| `MEDIAMTX_WEBRTC_BASE_URL` | MediaMTX WebRTC base URL (returned by `/preview/:key/webrtc`) | `http://127.0.0.1:8889` |
| `MEDIAMTX_API_USER` | Basic-auth username for the MediaMTX API | None |
| `MEDIAMTX_API_PASSWORD` | Basic-auth password for the MediaMTX API | None |
| `MEDIAMTX_LOG_LEVEL` | MediaMTX log level: `debug`, `info`, `warn`, `error` | `info` |

### NginxManager (Radio Proxy)

| Variable | Description | Default |
|---|---|---|
| `NGINX_RADIO_CONFIG_PATH` | Path to nginx include file managed by NginxManager; empty = no-op mode | Unset |
| `NGINX_TEST_CMD` | Command to test nginx config before reloading | `nginx -t` |
| `NGINX_RELOAD_CMD` | Command to reload nginx after config write | `nginx -s reload` |
| `NGINX_RADIO_PREFIX` | Public URL prefix for slug-based radio proxy locations | `/r` |

### ffmpeg Runner

| Variable | Description | Default |
|---|---|---|
| `FFMPEG_RUNNER` | ffmpeg execution backend: `spawn` (local), `docker` (containerised), `worker` (remote daemon) | `spawn` |
| `FFMPEG_IMAGE` | Docker image for ffmpeg when `FFMPEG_RUNNER=docker` | `lcyt-ffmpeg:latest` |
| `FFMPEG_WRAPPER` | Custom ffmpeg wrapper script path | None |
| `DOCKER_BUILD_TIMEOUT_MS` | Timeout for Docker image builds in milliseconds | None |
| `DOCKER_HOST` | Docker socket URL (for `FFMPEG_RUNNER=docker`) | System default |

### HLS & Video

| Variable | Description | Default |
|---|---|---|
| `HLS_ROOT` | HLS output directory for video+audio streams | `/tmp/hls-video` |
| `HLS_LOCAL_RTMP` | Local nginx-rtmp/MediaMTX base URL for HLS | `rtmp://127.0.0.1:1935` |
| `HLS_RTMP_APP` | RTMP application name for HLS | `live` |

### Radio HLS

| Variable | Description | Default |
|---|---|---|
| `RADIO_HLS_SOURCE` | Radio HLS backend: `ffmpeg` (default) or `mediamtx` (no ffmpeg) | `ffmpeg` |
| `RADIO_HLS_ROOT` | HLS output directory for audio-only streams | `/tmp/hls` |
| `RADIO_LOCAL_RTMP` | Local nginx-rtmp URL for radio streams | `rtmp://127.0.0.1:1935` |
| `RADIO_RTMP_APP` | RTMP application name for radio | `live` |

### Stream Preview

| Variable | Description | Default |
|---|---|---|
| `PREVIEW_ROOT` | Directory for JPEG thumbnail files | `/tmp/previews` |
| `PREVIEW_INTERVAL_S` | Seconds between thumbnail updates | `5` |

### HLS Subtitle Sidecar

| Variable | Description | Default |
|---|---|---|
| `HLS_SUBS_ROOT` | Directory for WebVTT subtitle segment files | `/tmp/hls-subs` |
| `HLS_SUBS_SEGMENT_DURATION` | Subtitle segment length in seconds | `6` |
| `HLS_SUBS_WINDOW_SIZE` | Number of subtitle segments to keep per language | `10` |

### DSK Graphics

| Variable | Description | Default |
|---|---|---|
| `GRAPHICS_ENABLED` | Set to `1` to enable image upload/management | `0` |
| `GRAPHICS_DIR` | Image storage directory for DSK overlays | `/data/images` |
| `GRAPHICS_MAX_FILE_BYTES` | Max uploaded image size in bytes | `5242880` (5 MB) |
| `GRAPHICS_MAX_STORAGE_BYTES` | Max total image storage per key in bytes | `52428800` (50 MB) |
| `PLAYWRIGHT_DSK_CHROMIUM` | Path to Chromium binary for DSK renderer | Playwright cache path |
| `DSK_LOCAL_SERVER` | Local server URL used by DSK renderer | `http://localhost:$PORT` |
| `DSK_LOCAL_RTMP` | Local nginx-rtmp base URL for DSK RTMP output | `rtmp://127.0.0.1:1935` |
| `DSK_RTMP_APP` | RTMP application name for DSK renderer output | `dsk` |
| `DSK_RENDERER_IMAGE` | Docker image for containerised DSK renderer | `lcyt-dsk-renderer:latest` |

### File Storage

| Variable | Description | Default |
|---|---|---|
| `FILE_STORAGE` | Storage backend: `local`, `s3`, or `webdav` | `local` |
| `FILES_DIR` | Base directory for local file adapter | `/data/files` |

### S3-Compatible Storage

| Variable | Description | Default |
|---|---|---|
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | None |
| `S3_REGION` | AWS region (or `auto` for Cloudflare R2) | `auto` |
| `S3_ENDPOINT` | Custom S3-compatible endpoint URL (R2, MinIO, Backblaze B2) | None |
| `S3_PREFIX` | Object key prefix within the bucket | `captions` |
| `S3_ACCESS_KEY_ID` | Static S3 credentials access key | None (uses AWS chain) |
| `S3_SECRET_ACCESS_KEY` | Static S3 credentials secret | None |

### Server-Side STT

| Variable | Description | Default |
|---|---|---|
| `STT_PROVIDER` | Default STT provider: `google`, `whisper_http`, `openai` | `google` |
| `STT_DEFAULT_LANGUAGE` | Default BCP-47 language tag for STT | `en-US` |
| `STT_AUDIO_SOURCE` | Default audio source for STT: `hls`, `rtmp`, `whep` | `hls` |

### Google Cloud STT

| Variable | Description | Default |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google service account JSON (for OAuth2 STT) | None |
| `GOOGLE_STT_KEY` | Google Cloud STT REST API key (simpler alternative to service account) | None |
| `GOOGLE_STT_MODE` | Google STT mode: `rest` (default) or `grpc` (lower latency; requires `@google-cloud/speech`) | `rest` |

### Whisper HTTP STT

| Variable | Description | Default |
|---|---|---|
| `WHISPER_HTTP_URL` | Base URL of a Whisper-compatible HTTP STT server | None |
| `WHISPER_HTTP_MODEL` | Model name to request from the Whisper HTTP server | None |

### OpenAI STT

| Variable | Description | Default |
|---|---|---|
| `OPENAI_STT_URL` | Base URL for OpenAI-compatible STT endpoint | OpenAI default |
| `OPENAI_STT_API_KEY` | API key for OpenAI STT endpoint | None |
| `OPENAI_STT_MODEL` | Model name for OpenAI STT requests | `whisper-1` |

### YouTube OAuth

| Variable | Description | Default |
|---|---|---|
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Web client ID (for client-side token flow) | None |

### User Accounts

| Variable | Description | Default |
|---|---|---|
| `USE_USER_LOGINS` | Set to `0` to disable user registration/login (`/auth` routes) | Enabled |

### Contact Info

| Variable | Description | Default |
|---|---|---|
| `CONTACT_EMAIL` | Contact info returned by `GET /contact` | None |
| `CONTACT_NAME` | Contact name returned by `GET /contact` | None |
| `CONTACT_PHONE` | Contact phone returned by `GET /contact` | None |
| `CONTACT_WEBSITE` | Contact website returned by `GET /contact` | None |

### Backups

| Variable | Description | Default |
|---|---|---|
| `BACKUP_DIR` | Directory for DB backup files | None |
| `BACKUP_DAYS` | Number of daily DB backups to retain | None |

### Bridge Agent Downloads

| Variable | Description | Default |
|---|---|---|
| `BRIDGE_DOWNLOAD_BASE_URL` | Base URL serving pre-built bridge agent binaries | None |

### MCP Server (SSE)

| Variable | Description | Default |
|---|---|---|
| `LCYT_BACKEND_URL` | Backend URL for MCP server to connect to | `http://localhost:3000` |
| `LCYT_API_KEY` | API key for MCP server backend connection | None |
| `LCYT_ADMIN_KEY` | Admin key for MCP server backend connection | None |
| `LCYT_WEB_URL` | Web UI URL (for MCP speech session links) | None |
| `SPEECH_PUBLIC_URL` | Public URL for speech capture sessions | None |
| `MCP_REQUIRE_API_KEY` | Set to `1` to require API key for MCP SSE connections | `0` |
| `MCP_SESSION_TTL_MS` | MCP session timeout in milliseconds | `7200000` (2h) |

### Compute Orchestrator

| Variable | Description | Default |
|---|---|---|
| `COMPUTE_ORCHESTRATOR_URL` | Orchestrator URL (used by backend in worker mode) | `http://lcyt-orchestrator:4000` |
| `BACKEND_INTERNAL_TOKEN` | Shared secret for backend ↔ orchestrator auth | None |
| `ORCHESTRATOR_FALLBACK` | Fallback runner if orchestrator is unavailable: `spawn` | None |
| `ORCHESTRATOR_BACKOFF_MS` | Base backoff ms for Hetzner retries | `1000` |
| `ORCHESTRATOR_MAX_PENDING_JOBS` | Max queued jobs before 503 | `50` |

### Hetzner Cloud (Burst VMs)

| Variable | Description | Default |
|---|---|---|
| `HETZNER_API_TOKEN` | Enables burst VM provisioning (required for autoscaling) | None (disables Hetzner) |
| `HETZNER_NETWORK_ID` | Hetzner private network ID for inter-VM communication | None |
| `HETZNER_SNAPSHOT_ID` | Image/snapshot ID for burst VMs | None |
| `HETZNER_SERVER_TYPE_BURST` | Server type for burst VMs | `cx31` |
| `HETZNER_SERVER_TYPE_WARM` | Server type for warm-pool VMs | `cx21` |
| `HETZNER_LOCATION` | Hetzner datacenter location | `hel1` |
| `WARM_POOL_SIZE` | Minimum number of warm workers to keep running | `1` |
| `BURST_COOLDOWN_MS` | Idle ms before destroying a burst worker | `300000` (5m) |
| `BURST_QUEUE_LIMIT` | Jobs in queue that trigger burst provisioning | `20` |
| `MAX_CONCURRENT_BURST_CREATES` | Max parallel burst VM provisions | `3` |

### Worker Daemon

| Variable | Description | Default |
|---|---|---|
| `WORKER_ID` | This worker's identifier | `worker-0` |
| `WORKER_AUTH_TOKEN` | Optional auth token for `/jobs` endpoints | None |
| `WORKER_MAX_JOBS` | Maximum concurrent jobs per worker | `4` |
| `WORKER_DAEMON_URL` | Worker daemon URL (used by backend in worker mode) | `http://127.0.0.1:5000` |
| `DSK_IMAGE` | Docker image for DSK renderer on worker | `lcyt-dsk-renderer:latest` |

### Dockerfile Build Args

These are build-time arguments passed to `docker build`:

| Build arg | Description | Default |
|---|---|---|
| `RTMP_RELAY_ACTIVE` | Install ffmpeg for RTMP relay | `0` |
| `RADIO_ACTIVE` | Install ffmpeg for radio HLS | `0` |
| `HLS_ACTIVE` | Install ffmpeg for video HLS | `0` |
| `PREVIEW_ACTIVE` | Install ffmpeg for preview thumbnails | `0` |
| `GRAPHICS_ENABLED` | Install Chromium for DSK graphics rendering | `0` |
| `APT_MIRROR` | Custom apt mirror URL (e.g. Hetzner mirror for faster builds) | None |

---

## Reverse Proxy (nginx)

Example nginx configuration for production:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # LCYT Backend API
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: disable buffering
        proxy_buffering off;
        proxy_cache off;
    }

    # Radio slug proxy (when NGINX_RADIO_CONFIG_PATH is set)
    include /etc/nginx/conf.d/lcyt-radio.conf;
}

# RTMP ingest (if nginx-rtmp is used as the frontend)
# rtmp {
#     server {
#         listen 1935;
#         application live {
#             live on;
#             push rtmp://127.0.0.1:1936;  # Forward to MediaMTX
#         }
#     }
# }
```

---

## SSL / TLS

For automated TLS certificates, use [Let's Encrypt](https://letsencrypt.org/) with Certbot:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d api.example.com
```

Certificates auto-renew via a systemd timer created by Certbot.

---

## Database

LCYT uses SQLite (via `better-sqlite3`). The database file location is controlled by `DB_PATH`.

- **Default:** `./lcyt-backend.db` (relative to working directory)
- **Docker:** `/data/lcyt.sqlite` (persisted in `lcyt-db` volume)

**Migrations** run automatically on startup (additive only, safe to run repeatedly).

**Backups:** Set `BACKUP_DIR` and `BACKUP_DAYS` to enable automatic daily backups. The backend creates timestamped `.sqlite` copies and prunes backups older than `BACKUP_DAYS`.

Manual backup:

```bash
sqlite3 /data/lcyt.sqlite ".backup /backups/lcyt-$(date +%Y%m%d).sqlite"
```

---

## Monitoring

### Health Checks

- `GET /health` — backend uptime, session count, login state
- `GET /compute/health` — orchestrator worker/job counts (port 4000)
- `GET /health` — worker daemon status (port 5000)
- `GET /metrics` — Prometheus text format (orchestrator, port 4000)

### Docker Compose Health Checks

All services in `docker-compose.yml` and `docker-compose.orchestrator.yml` include health checks with 30s interval, 5s timeout, and 3 retries.

### Logging

The backend uses the `lcyt/logger` module. Set `LCYT_LOG_STDERR=1` to route logs to stderr (useful for MCP contexts where stdout is reserved for the protocol).

In production, capture logs via your process manager (systemd journal, Docker logs, etc.):

```bash
# Docker
docker compose logs -f lcyt-site

# systemd
journalctl -u lcyt-backend -f
```
