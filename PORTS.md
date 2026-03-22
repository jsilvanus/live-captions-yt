# PORTS.md — Service Ports Reference

## Summary table

| Port | Protocol | Service | Direction | Env var override |
|------|----------|---------|-----------|-----------------|
| **3000** | HTTP | lcyt-backend (Express) | inbound (public) | `PORT` |
| **3001** | HTTP | lcyt-mcp-sse server | inbound (local/remote) | `PORT` |
| **1935** | RTMP | MediaMTX — publisher ingest | inbound (publishers) | — |
| **8080** | HTTP | MediaMTX — HLS output | internal | `MEDIAMTX_HLS_BASE_URL` |
| **8554** | RTSP | MediaMTX — RTSP output | internal | `MEDIAMTX_RTSP_BASE_URL` |
| **8889** | HTTP/WS | MediaMTX — WebRTC preview | inbound (browsers) | `MEDIAMTX_WEBRTC_BASE_URL` |
| **9997** | HTTP | MediaMTX — REST API | internal | `MEDIAMTX_API_URL` |
| **80 / 443** | HTTP/HTTPS | nginx reverse proxy | inbound (public) | — |

---

## Per-service detail

### lcyt-backend — port 3000

Express HTTP server. Receives captions, serves HLS/radio/preview routes, handles RTMP callbacks.

- **Inbound from internet:** yes (behind nginx reverse proxy in production)
- **Inbound direct (dev):** yes
- Override: `PORT=3000`

### lcyt-mcp-sse — port 3001

MCP server with HTTP SSE transport (`GET /sse`, `POST /messages`). Used by AI assistants connecting remotely.

- **Inbound from internet:** only if remote AI access is needed; otherwise localhost only
- Override: `PORT=3001`

### MediaMTX — RTMP ingest, port 1935

Publishers (OBS, ffmpeg, hardware encoders) connect here to push live streams.

- **Inbound from internet:** yes — must be reachable by publishers
- **Firewall:** open TCP 1935 to publishers

### MediaMTX — HLS output, port 8080

Serves HLS playlists and segments. The lcyt-backend proxies this port for
`GET /stream-hls/:key/*` and `GET /radio/:key/*` requests, so **this port
does not need to be publicly reachable**.

- **Inbound from internet:** no — internal only
- **Accessed by:** lcyt-backend (proxy), nginx (if `NGINX_RADIO_CONFIG_PATH` is set)
- Override: `MEDIAMTX_HLS_BASE_URL=http://127.0.0.1:8080`

### MediaMTX — RTSP, port 8554

Used internally by the relay manager's `runOnPublish` command:
```
ffmpeg -i rtsp://127.0.0.1:8554/<key> -c copy -f tee "..."
```
This forwarding happens on the same host as MediaMTX, so the port stays local.

- **Inbound from internet:** no — loopback only
- Override: `MEDIAMTX_RTSP_BASE_URL=rtsp://127.0.0.1:8554`

### MediaMTX — WebRTC preview, port 8889

Serves WebRTC previews for live streams. Browsers open this URL directly
(returned by `GET /preview/:key/webrtc`). Must be reachable by browsers if
WebRTC preview is used.

- **Inbound from internet:** yes — if WebRTC preview is exposed to end users
- **Firewall:** open TCP 8889 (and UDP range for WebRTC ICE if using STUN/TURN)
- Override: `MEDIAMTX_WEBRTC_BASE_URL=http://127.0.0.1:8889`

### MediaMTX — REST API, port 9997

Used by lcyt-backend to register paths, kick publishers, fetch thumbnails, etc.
Never exposed to the public.

- **Inbound from internet:** no — internal only
- Override: `MEDIAMTX_API_URL=http://127.0.0.1:9997`

### nginx — ports 80 / 443

Reverse proxy in front of lcyt-backend and MediaMTX HLS.

- **`/` → lcyt-backend :3000**
- **`/r/<slug>/` → MediaMTX HLS :8080** (when `NGINX_RADIO_CONFIG_PATH` is set — this is the slug-based proxy that hides the API key from public URLs)
- **Firewall:** open TCP 80 and 443

---

## Firewall rules (production)

```
# Public — must be open to the internet
TCP  80    nginx HTTP (redirects to HTTPS)
TCP  443   nginx HTTPS
TCP  1935  MediaMTX RTMP ingest

# Optional — open only if WebRTC preview is needed
TCP  8889  MediaMTX WebRTC

# Internal — loopback / private network only
TCP  3000  lcyt-backend
TCP  8080  MediaMTX HLS
TCP  8554  MediaMTX RTSP
TCP  9997  MediaMTX REST API
```

---

## Env vars that control ports / URLs

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | lcyt-backend HTTP port |
| `MEDIAMTX_HLS_BASE_URL` | `http://127.0.0.1:8080` | MediaMTX HLS base — used by HLS and radio proxies |
| `MEDIAMTX_RTSP_BASE_URL` | `rtsp://127.0.0.1:8554` | MediaMTX RTSP base — used by relay `runOnPublish` |
| `MEDIAMTX_WEBRTC_BASE_URL` | `http://127.0.0.1:8889` | MediaMTX WebRTC base — returned by `/preview/:key/webrtc` |
| `MEDIAMTX_API_URL` | `http://localhost:9997` | MediaMTX REST API — used by MediaMtxClient |
