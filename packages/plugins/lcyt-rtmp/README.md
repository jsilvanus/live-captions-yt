# lcyt-rtmp — RTMP Relay, HLS, Radio, Preview & STT Plugin

Comprehensive plugin for RTMP relay streams, HLS video/audio output, audio-only radio streams, RTMP → JPEG preview, and server-side speech-to-text transcription.

**Version:** 0.1.0  
**License:** (none right now)

## Overview

lcyt-rtmp provides:
- **RTMP relay** — Relay RTMP streams via nginx-rtmp
- **HLS streaming** — Video + audio HLS output via MediaMTX
- **Audio-only radio** — AAC audio HLS (ffmpeg or MediaMTX)
- **Stream preview** — RTMP → JPEG thumbnail updating
- **Caption injection** — Embed captions in HLS subtitle sidecars
- **Server-side STT** — Transcribe audio streams (Google, Whisper, OpenAI)

## Installation

```bash
npm install lcyt-rtmp
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp';

const rtmp = await initRtmpControl(db, store);
const { relayManager, hlsManager, radioManager, previewManager, hlsSubsManager, sttManager } = rtmp;

// Mount routers
if (process.env.RTMP_RELAY_ACTIVE === '1') {
  const routers = createRtmpRouters(db, auth, rtmp, { allowedRtmpDomains });
  app.use('/rtmp', routers.rtmpRouter);
  app.use('/stream', routers.streamRouter);
  app.use('/stream-hls', routers.streamHlsRouter);
  app.use('/radio', routers.radioRouter);
  app.use('/preview', routers.previewRouter);
}

// On graceful shutdown
await rtmp.stop();
```

## API Routes

### RTMP Relay

```
GET/POST/PUT/DELETE /rtmp
       Relay slot management (CRUD)

POST   /stream?action=start
       Start RTMP relay stream
       Body: { rtmpUrl, ... }
       Response: 202 { streamId }

POST   /stream?action=stop
       Stop relay stream
       Response: 200

PUT    /stream/active
       Mark stream as actively publishing
       Response: 200
```

### HLS Streaming (video + audio)

```
GET    /stream-hls/:key/master.m3u8
       HLS master playlist (video quality variants + subtitle tracks)

GET    /stream-hls/:key/video/:bitrate/playlist.m3u8
       HLS video playlist for bitrate

GET    /stream-hls/:key/video/:bitrate/:segment.ts
       HLS video segment file

GET    /stream-hls/:key/audio/playlist.m3u8
       HLS audio playlist

GET    /stream-hls/:key/audio/:segment.aac
       HLS audio segment file

GET    /stream-hls/:key/subs/:lang/playlist.m3u8
       HLS subtitle (WebVTT) playlist

GET    /stream-hls/:key/subs/:lang/:segment.vtt
       WebVTT subtitle segment
```

### Radio (audio-only)

```
GET    /radio/:key/playlist.m3u8
       Audio-only HLS playlist

GET    /radio/:key/:segment.aac
       Audio segment (AAC codec)
```

**Modes:**
- `ffmpeg` — ffmpeg spawned per-stream (default)
- `mediamtx` — No ffmpeg; MediaMTX with nginx proxy

### Stream Preview

```
GET    /preview/:key/incoming.jpg
       Latest RTMP → JPEG thumbnail
       Response: image/jpeg + Cache-Control
```

### Server-side STT

```
POST   /stt/start
       Start transcription session
       Body: { provider?, language?, audioSource?, streamKey?, confidenceThreshold? }
       Response: 202 { ok: true }

POST   /stt/stop
       Stop transcription
       Response: 200

GET    /stt/events
       SSE stream of transcript events
       Response: text/event-stream

GET    /stt/status
       Current STT session state
       Response: { provider, language, running }

GET    /stt/config
       Get per-key STT config
       Response: { provider, language, audioSource, confidenceThreshold }

PUT    /stt/config
       Update STT configuration
       Body: { provider, language, audioSource, confidenceThreshold }
       Response: 200
```

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RTMP_RELAY_ACTIVE` | unset | Enable RTMP relay functionality |
| `RTMP_HOST` | — | RTMP server host |
| `RTMP_APP` | — | RTMP application name |
| `RTMP_CONTROL_URL` | — | nginx-rtmp control URL (legacy) |
| `HLS_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | nginx-rtmp base URL |
| `HLS_RTMP_APP` | `live` | RTMP app for HLS output |
| `HLS_ROOT` | `/tmp/hls-video` | HLS file storage directory |
| `HLS_SUBS_ROOT` | `/tmp/hls-subs` | WebVTT subtitle storage |
| `HLS_SUBS_SEGMENT_DURATION` | 6 | Subtitle segment duration (s) |
| `HLS_SUBS_WINDOW_SIZE` | 10 | Segments to keep per language |
| `RADIO_HLS_ROOT` | `/tmp/hls` | Audio-only HLS directory |
| `RADIO_HLS_SOURCE` | `ffmpeg` | Backend: `ffmpeg` or `mediamtx` |
| `RADIO_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | nginx-rtmp for radio |
| `RADIO_RTMP_APP` | `live` | RTMP app for radio |
| `MEDIAMTX_HLS_BASE_URL` | `http://127.0.0.1:8080` | MediaMTX HLS base URL |
| `MEDIAMTX_API_URL` | — | MediaMTX v3 REST API URL |
| `MEDIAMTX_API_USER` | — | MediaMTX API basic-auth user |
| `MEDIAMTX_API_PASSWORD` | — | MediaMTX API basic-auth password |
| `NGINX_RADIO_CONFIG_PATH` | — | nginx config file for radio (NginxManager) |
| `NGINX_RADIO_PREFIX` | `/r` | Public URL prefix for radio |
| `PREVIEW_ROOT` | `/tmp/previews` | JPEG thumbnail directory |
| `PREVIEW_INTERVAL_S` | 5 | Thumbnail update interval |
| `STT_PROVIDER` | `google` | Default STT provider |
| `STT_DEFAULT_LANGUAGE` | `en-US` | Default language tag |
| `STT_AUDIO_SOURCE` | `hls` | Audio source: `hls`, `rtmp`, `whep` |
| `GOOGLE_STT_MODE` | `rest` | Google STT: `rest` or `grpc` |
| `WHISPER_HTTP_URL` | — | Whisper HTTP server base URL |
| `OPENAI_STT_API_KEY` | — | OpenAI API key |

## Components

### RtmpRelayManager

```javascript
const { relayManager } = rtmp;

// Start relay
const { streamId } = await relayManager.start({
  rtmpUrl: 'rtmp://capture.example.com/live/stream'
});

// Check status
const status = relayManager.isActive(streamId);

// Stop relay
await relayManager.stop(streamId);

// Drop publisher (MediaMTX)
await relayManager.dropPublisher(streamKey);
```

### HlsManager

Manages MediaMTX-based RTMP → HLS:

```javascript
const { hlsManager } = rtmp;

// No explicit API; automatic on RTMP stream publish
// MediaMTX generates HLS automatically
```

### RadioManager

Audio-only HLS:

```javascript
const { radioManager } = rtmp;

// ffmpeg mode: spawns ffmpeg RTMP → AAC HLS
// mediamtx mode: no ffmpeg; NginxManager writes location blocks
```

### PreviewManager

RTMP → JPEG:

```javascript
const { previewManager } = rtmp;

// Automatic JPEG generation from RTMP stream
// Available at GET /preview/:key/incoming.jpg
```

### HlsSubsManager

WebVTT subtitle sidecars:

```javascript
const { hlsSubsManager } = rtmp;

// Automatically writes WebVTT segments from captions
// Available at GET /stream-hls/:key/subs/:lang/:segment.vtt
```

### SttManager

Server-side speech-to-text:

```javascript
const { sttManager } = rtmp;

// Start STT session
await sttManager.startSession(apiKey, {
  provider: 'google',
  language: 'en-US',
  audioSource: 'hls'
});

// Transcripts emitted to session._sendQueue automatically
// Events on GET /stt/events SSE stream
```

## STT Audio Sources

| Source | How it works | Requirements |
|--------|------------|--------------|
| `hls` | Polls MediaMTX fMP4 playlist for segments | MediaMTX running |
| `rtmp` | ffmpeg reads RTMP stream, writes PCM to adapter | ffmpeg, RTMP source |
| `whep` | ffmpeg reads WHEP endpoint, writes PCM | ffmpeg, WHEP source |

## STT Providers

| Provider | API | Mode | Requirements |
|----------|-----|------|--------------|
| `google` | Google Cloud Speech-to-Text | REST or gRPC | Service account or API key |
| `whisper_http` | Whisper-compatible HTTP server | HTTP POST | Whisper HTTP endpoint |
| `openai` | OpenAI `/audio/transcriptions` | REST | OpenAI API key |

## Database Schema

```sql
-- RTMP relay sessions
CREATE TABLE rtmp_relay_sessions (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  rtmp_url TEXT,
  status TEXT,              -- 'publishing', 'idle', 'error'
  started_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- STT configuration (per key)
CREATE TABLE stt_config (
  api_key TEXT PRIMARY KEY,
  provider TEXT,            -- 'google', 'whisper_http', 'openai'
  language TEXT,
  audio_source TEXT,        -- 'hls', 'rtmp', 'whep'
  confidence_threshold REAL,
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- STT events (audit)
CREATE TABLE stt_events (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  type TEXT,                -- 'connected', 'transcript', 'error'
  transcript TEXT,
  confidence REAL,
  timestamp DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);
```

## Testing

```bash
npm test -w packages/plugins/lcyt-rtmp
```

Tests cover:
- RTMP relay manager
- HLS segment fetching
- Preview JPEG generation
- STT adapters (with mock HTTP)
- nginx config writing (NginxManager)
- MediaMTX API client

## Performance Considerations

- **HLS:** Low-latency output (6s segments typical)
- **Radio:** Audio-only reduces bandwidth
- **STT:** Latency varies by provider (Google REST: 1–2s per segment)
- **RTMP:** Dependent on source bitrate

## See Also

- [Server-side STT documentation](../../docs/plans/plan_server_stt.md)
- [HLS subtitle sidecars](../../docs/plans/plan_hls_sidecar.md)
- [RTMP relay guide](../../docs/guide-web/broadcast.md)
- [Backend documentation](../../lcyt-backend/README.md)
