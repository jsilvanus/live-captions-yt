# Firewall & Reverse Proxy Reference

This document lists every port used by LCYT services, whether it needs to be publicly open, and how it fits into a typical nginx reverse-proxy setup.

---

## Quick summary

| Port | Protocol | Service | Expose publicly? | Via reverse proxy? |
|------|----------|---------|------------------|--------------------|
| 80 | TCP | nginx (HTTP → HTTPS redirect) | **Yes** | — |
| 443 | TCP | nginx (HTTPS / WSS) | **Yes** | — |
| 1935 | TCP | RTMP ingest (nginx-rtmp or MediaMTX) | **Yes** (RTMP clients) | No — direct |
| 3000 | TCP | lcyt-backend API | No — loopback only | **Yes** (nginx) |
| 3001 | TCP | lcyt-mcp-sse | No — loopback only | **Yes** (nginx, if exposed) |
| 4000 | TCP | lcyt-orchestrator | No — loopback only | No (internal) |
| 5000 | TCP | lcyt-worker-daemon | No — loopback only | No (internal) |
| 8080 | TCP | MediaMTX HLS / metrics HTTP | No — loopback only | **Yes** (nginx proxy_pass for `/r/`) |
| 9997 | TCP | MediaMTX REST API | No — loopback only | No (internal only) |

---

## Public-facing ports (open in firewall)

### Port 80 — HTTP (nginx)
- Accepts plain HTTP; redirect all traffic to HTTPS.
- Rule: `allow tcp 80 from any`

### Port 443 — HTTPS / WSS (nginx)
- Main public entry point. nginx terminates TLS and reverse-proxies to backend services.
- Also handles WebSocket upgrade for SSE long-poll connections.
- Rule: `allow tcp 443 from any`

### Port 1935 — RTMP
- Required for encoder software (OBS, Wirecast, hardware encoders) to push live streams.
- Cannot go through nginx (RTMP is not HTTP); must be a direct firewall opening.
- Only needed when `RTMP_RELAY_ACTIVE=1` or MediaMTX / nginx-rtmp is in use.
- Rule: `allow tcp 1935 from any` (or restrict to known encoder IPs if possible)

---

## Internal-only ports (loopback / Docker network — do not expose)

All of the following are bound to `127.0.0.1` in `docker-compose.yml` and must **not** be reachable from outside the host. Access is only via nginx reverse proxy or inter-container networking.

### Port 3000 — lcyt-backend API
- Express HTTP server. All public API traffic arrives here via nginx.
- Configured by: `PORT` env var (default `3000`).
- nginx proxy target: `http://127.0.0.1:3000`

### Port 3001 — lcyt-mcp-sse
- HTTP SSE transport for the Model Context Protocol server.
- Only expose publicly if AI assistant MCP integration is needed.
- Configured by: `PORT` env var in the MCP SSE process (default `3001`).
- nginx proxy target: `http://127.0.0.1:3001`

### Port 4000 — lcyt-orchestrator
- Job scheduler and Hetzner VM lifecycle manager. Internal only.
- Configured by: `PORT` env var (default `4000`).
- Not proxied externally; backend reaches it via `COMPUTE_ORCHESTRATOR_URL`.

### Port 5000 — lcyt-worker-daemon
- ffmpeg / DSK renderer worker. Internal only.
- Configured by: `PORT` env var (default `5000`).
- Backend reaches it via `WORKER_DAEMON_URL` (default `http://127.0.0.1:5000`).

### Port 8080 — MediaMTX HLS / metrics
- Serves HLS playlists and segments for audio/video streams.
- nginx proxies public slug URLs (`/r/<slug>/`) to this port via `NginxManager`-generated location blocks.
- Configured by: `MEDIAMTX_HLS_BASE_URL` (default `http://mediamtx:8080` in Docker, `http://127.0.0.1:8080` on bare metal).

### Port 9997 — MediaMTX REST API
- Used by the backend (`RadioManager`) to register/deregister MediaMTX paths dynamically.
- Never proxied or exposed externally.
- Configured by: `MEDIAMTX_API_URL` (default `http://mediamtx:9997`).

---

## nginx reverse proxy configuration

A single nginx vhost on port 443 handles all public HTTP/HTTPS traffic. The sample config below covers the most common routing:

```nginx
server {
    listen 443 ssl;
    server_name api.lcyt.fi;

    # ── Backend API ──────────────────────────────────────────────────────────
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # ── SSE streams (GET /events, GET /viewer/:key, GET /dsk/:key/events) ───
    # Disable buffering so events reach the client immediately.
    location ~* ^/(events|viewer/|dsk/) {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Connection        "";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
    }

    # ── HLS audio streams via MediaMTX (RADIO_HLS_SOURCE=mediamtx) ──────────
    # NginxManager writes slug-based location blocks here automatically.
    # include /etc/nginx/conf.d/lcyt-radio.conf;

    # ── MCP SSE server (optional) ────────────────────────────────────────────
    location /mcp-sse/ {
        proxy_pass         http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header   Connection        "";
        proxy_set_header   Host              $host;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
    }

    # ssl_certificate / ssl_certificate_key — managed by certbot or similar.
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name api.lcyt.fi;
    return 301 https://$host$request_uri;
}
```

### Web UI vhost (separate domain, static files)

```nginx
server {
    listen 443 ssl;
    server_name app.lcyt.fi;

    root /var/www/html/lcyt-web;   # symlink to packages/lcyt-web/dist
    index index.html;

    # SPA fallback — serve index.html for any unknown path
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache Vite content-addressed assets indefinitely
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # lcyt-bridge binary downloads
    location /bridge-downloads/ {
        alias /var/www/html/lcyt-bridge/;
        default_type application/octet-stream;
        add_header Content-Disposition "attachment";
        add_header Cache-Control "no-cache";
    }

    # ssl_certificate / ssl_certificate_key — managed by certbot or similar.
}
```

---

## RTMP ingest (nginx-rtmp or MediaMTX)

Port **1935** must be opened directly in the firewall — it cannot be reverse-proxied by nginx (nginx-rtmp is a separate module and standard nginx cannot transparently proxy raw RTMP).

**nginx-rtmp** (used when `RTMP_RELAY_ACTIVE=1` with the nginx-rtmp module):
```nginx
rtmp {
    server {
        listen 1935;
        application live {
            live on;
            # forward to MediaMTX or other targets
        }
    }
}
```

**MediaMTX** (used when `RADIO_HLS_SOURCE=mediamtx`):
- RTMP on port 1935 is handled natively by MediaMTX.
- In Docker, the compose file maps `127.0.0.1:1936:1935` to avoid conflicting with a host nginx-rtmp. Adjust to `0.0.0.0:1935:1935` if encoders connect directly to MediaMTX.

---

## UFW example (Ubuntu)

```sh
# Public ports
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 1935/tcp   # RTMP — only if live streaming is in use

# Block everything else by default
ufw default deny incoming
ufw default allow outgoing
ufw enable
```

---

## Environment variables that affect networking

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3000` | Backend HTTP port |
| `HLS_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | RTMP base URL used by HLS manager |
| `RADIO_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | RTMP base URL used by radio manager |
| `DSK_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | RTMP base URL used by DSK renderer |
| `MEDIAMTX_HLS_BASE_URL` | `http://mediamtx:8080` | Internal HLS proxy target for nginx |
| `MEDIAMTX_API_URL` | `http://mediamtx:9997` | Internal REST API for path management |
| `NGINX_RADIO_CONFIG_PATH` | _(unset)_ | Path nginx include file for radio slug locations |
| `DSK_LOCAL_SERVER` | `http://localhost:3000` | URL Chromium renderer fetches templates from |
| `PUBLIC_URL` | _(unset)_ | Server's public URL, used in generated `.env` downloads |
| `ALLOWED_DOMAINS` | `lcyt.fi,www.lcyt.fi,localhost` | Session CORS allowlist |
| `ALLOWED_RTMP_DOMAINS` | _(falls back to `ALLOWED_DOMAINS`)_ | Domains allowed to use `/stream` relay |
