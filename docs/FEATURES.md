# LCYT Feature List & Pipeline Guide

A from-the-ground-up tour of what LCYT can do, organized as ready-made production pipelines. Use this as marketing copy, a sales sheet, or an onboarding map — pick the pipeline that matches your event and follow the linked docs.

---

## 1. Feature List

### Core caption delivery
- **YouTube Live HTTP POST caption ingestion** — Google's official closed-caption API, with sequence tracking, 60-second timestamp windows, and NTP-style clock sync (`syncOffset`) so captions land in time even on a flaky connection.
- **Multi-target fan-out** — one caption stream, delivered simultaneously to:
  - **YouTube** (one or more stream keys — multi-channel simulcast)
  - **Viewer pages** (public SSE broadcast, no auth, embeddable, Android TV app)
  - **Generic webhook** (arbitrary HTTP POST endpoint, e.g. your own overlay or CMS)
- **Caption file management** — local filesystem, S3-compatible (R2/MinIO/B2), or WebDAV storage; upload, replay, batch-send, and auto-archive every session.
- **CEA-608/708 embedding** — burn standards-compliant closed captions directly into the RTMP/HLS video stream (eia608 encoder + SRT pipe), for platforms that don't support sidecar captions.
- **HLS multilingual subtitle sidecar** — rolling WebVTT segments per language, served via an HLS.js player at `/video/:key` with a CC language picker.

### Speech-to-text (two independent paths)
- **Browser-side STT** — Web Speech API and Google Cloud STT, client-side voice-activity detection, live translation before sending.
- **Server-side STT** — no browser or microphone required; transcribes directly from the incoming RTMP/HLS/WHEP stream. Google Cloud (REST/gRPC), Whisper-compatible HTTP, or OpenAI-compatible endpoints. Per-caption confidence filtering.

### Translation
- Real-time client-side translation (MyMemory, Google, DeepL, LibreTranslate) before captions are sent, multi-target routing (different languages to different viewer pages), and translated WebVTT sidecar generation.

### Streaming infrastructure
- **RTMP relay & fan-out** — one ingest, many destinations.
- **HLS (video+audio)** — MediaMTX-based, no ffmpeg in the hot path.
- **Audio-only radio HLS** — dual mode: ffmpeg pipeline or MediaMTX + nginx slug proxying.
- **Live preview thumbnails** — JPEG snapshot polling for monitoring dashboards.
- **Distributed ffmpeg compute** — runs ffmpeg locally, in a Docker container, or dispatched to a fleet of remote worker VMs with automatic Hetzner Cloud burst-autoscaling under load. Falls back gracefully to local execution if no orchestrator is reachable.

### Inline metacodes (caption text drives everything else)
A single text stream can carry hidden HTML-comment directives that the backend strips before delivery and turns into real-time events:
- `<!-- graphics:... -->` — show/hide DSK overlay elements, per-viewport or globally, with additive/subtractive deltas.
- `<!-- cue:... -->` — advance a rundown/runsheet: exact phrase, fuzzy (typo-tolerant), semantic (embedding similarity), or AI event-based ("when the speaker mentions communion").
- `<!-- sound:... -->` / `<!-- bpm:... -->` — music/speech/silence state and tempo, fed by the music-detection engine.

### Graphics (DSK overlays)
- Headless-Chromium template renderer composited live onto the RTMP feed.
- Visual drag/resize/multi-select editor with undo/redo, snap-to-grid/edge, alignment tools, copy/paste, and a media library for uploaded images.
- **Named viewports** — push different graphic sets to differently-shaped outputs (e.g. 16:9 landscape program feed vs. a 9:16 vertical clip feed) from one caption stream, simultaneously, independently controlled.

### Production control (cameras & switchers)
- PTZ camera presets and live video-mixer source switching, driven from the same operator UI or via metacodes.
- A standalone **bridge agent** (`lcyt-bridge`) relays commands to on-site hardware over TCP, so the cloud backend never needs direct network access to the venue.

### Music & audio analysis
- Detects music / speech / silence and estimates BPM, from either server-side audio (HLS or RTMP) or a browser microphone — no song identification, just state.
- Used to suppress low-confidence STT during music, drive a "music in progress" cue light, or time graphics cuts to the beat.

### AI Agent
- Per-user pluggable embedding/LLM provider config (server-default, OpenAI, or custom endpoint).
- Context-window-aware event-cue evaluation ("fire this cue when the content matches this description").
- AI-assisted DSK template generation/editing and AI-assisted rundown/runsheet generation.

### Platform & operations
- Multi-user accounts, project (API key) management, team membership with roles, per-project feature flags, device-role pin-code logins for shared production hardware.
- Full admin panel: user/project CRUD, audit log, batch operations, JSON export/import.
- Two-phase adaptive login (feature-probing against `GET /health`) so the same frontend serves a full-featured cloud backend or a minimal self-hosted relay.
- Embeddable widgets (`/embed/*`) for audio capture, text input, sent-log, file drop, settings, RTMP control, and viewer — drop any one into an existing production dashboard via iframe, synced over `BroadcastChannel`.
- Android TV viewer app for full-screen caption display on TV/Fire TV.
- Three deployment tiers: single docker-compose stack, docker-compose + Hetzner burst workers, or full Kubernetes (CloudFleet) manifests.

---

## 2. Pipeline Suggestions

Each of these is a complete, ready-to-run configuration of the platform for a specific production need.

### Pipeline A — Captions only, frontend (browser) transcribe
**Best for:** solo operators, small churches/events, no server-side audio infrastructure.

The operator opens `/audio` (or the `/embed/audio` widget) in a browser, grants mic access, and Web Speech API or Google Cloud STT transcribes locally. Client-side VAD trims silence; optional live translation runs before send. Captions go straight to YouTube (and optionally a viewer page) via `BackendCaptionSender`.

- **Needs:** a browser, a microphone, an API key. No RTMP, no media server.
- **Docs:** `docs/plans/plan_stt.md`, `packages/lcyt-web/src/hooks/useWebSpeech.js`.

### Pipeline B — Captions only, backend (server-side) transcribe
**Best for:** unattended/headless rigs, hardware encoders with no browser in the loop, consistent transcription quality independent of operator hardware.

An RTMP (or WHEP) encoder pushes audio+video to the backend. `SttManager` pulls audio from the live HLS/RTMP/WHEP stream and transcribes via Google Cloud, Whisper-compatible, or OpenAI-compatible STT, with a confidence threshold to silently drop low-quality fragments. Transcripts are injected straight into the session's send queue — delivered exactly like manually typed captions.

- **Needs:** an RTMP/WHEP-capable encoder, an STT provider credential.
- **Docs:** `docs/plans/plan_server_stt.md`, `/stt/*` API routes.

### Pipeline C — RTMP fan-out
**Best for:** simulcasting one source to multiple outputs (HLS player, radio stream, thumbnail monitor, DSK-composited feed) without re-encoding per destination.

One RTMP ingest is split by `RtmpRelayManager` into: a video+audio HLS feed (MediaMTX), an audio-only "radio" HLS feed, periodic JPEG preview thumbnails, optional CEA-708 caption embedding, and an optional DSK-composited output. All from a single upstream connection.

- **Needs:** an RTMP source, relay slot configuration per API key.
- **Docs:** `docs/plans/plan_rtmp.md`, `docs/plans/plan_mediamtx.md`.

### Pipeline D — Metacode-driven automation
**Best for:** operators who want one text stream to silently drive graphics, rundown advancement, and sound-aware behavior, instead of juggling multiple control panels.

Caption text carries `<!-- graphics:... -->`, `<!-- cue:... -->`, and `<!-- sound:... -->`/`<!-- bpm:... -->` directives inline. The backend strips them before delivery to YouTube and fans the directives out as SSE events to DSK overlays, the cue engine, and connected dashboards — so a single typed or transcribed stream becomes the control surface for the whole show.

- **Needs:** nothing extra — metacodes work on top of any caption source.
- **Docs:** `docs/METACODE.md`.

### Pipeline E — Camera (PTZ) control
**Best for:** productions with one or more remotely-controllable cameras and an operator who wants preset recall from the same dashboard as captions.

PTZ presets are triggered from `/production/cameras` or via the bridge agent, against:

| Adapter | Supported devices |
|---|---|
| `amx` | AMX-protocol PTZ controllers (TCP/IP) |
| `visca-ip` | Any VISCA-over-IP PTZ camera (most professional PTZ cameras — Sony, Panasonic, PTZOptics, and other VISCA-over-IP-compliant models) |
| `browser` | Browser/WebRTC media-device capture (software-only, no physical PTZ) |
| `none` | No-op placeholder for software-only camera targets |

- **Needs:** a camera reachable over TCP/IP (for AMX/VISCA) and, for on-site hardware, a running `lcyt-bridge` agent.
- **Docs:** `docs/plans/plan_prod.md`, `packages/plugins/lcyt-production/src/adapters/camera/`.

### Pipeline F — Video switcher (mixer) control
**Best for:** productions that need source switching (camera A/B, graphics key, slides) triggered remotely or via metacode automation.

| Adapter | Supported devices |
|---|---|
| `roland` | Roland video mixers (TCP) |
| `amx` | AMX-protocol mixers (TCP) |
| `atem` | Blackmagic Design ATEM switchers |
| `obs` | OBS Studio (obs-websocket) — *see gap note below* |
| `lcyt` | LCYT's own software mixer |
| `monarch_hdx` | Matrox Monarch HDX encoder/mixer |

- **Needs:** a mixer reachable over TCP (or obs-websocket/network for OBS), and for on-site hardware, `lcyt-bridge` running locally.
- **Docs:** `docs/plans/plan_prod.md`, `packages/plugins/lcyt-production/src/adapters/mixer/`.

### Pipeline G — Graphics (DSK overlays)
**Best for:** lower-thirds, branding, sponsor cards, and any caption-driven on-screen graphic that needs to look broadcast-quality without a dedicated graphics operator.

Design templates visually in the DSK editor (drag/resize/multi-select, snap-to-grid, media library), then drive which elements are visible live via metacodes or the DSK control panel. A headless-Chromium renderer composites the result and pushes it onto the RTMP output in real time.

- **Needs:** an RTMP output target (for hardware compositing) or a browser overlay page (for software/streaming-software compositing, e.g. an OBS browser source).
- **Docs:** `docs/plans/plan_dsk.md`, `packages/plugins/lcyt-dsk/`.

### Pipeline H — Graphics to multiple screens with different dimensions
**Best for:** simultaneous landscape program output + vertical (9:16) clip/social feed, or multi-room productions where each screen needs its own graphic set and aspect ratio.

Define named **viewports** (e.g. `landscape`/`default`/`main`, `vertical-left`, `vertical-right`) each with their own dimensions. A single metacode stream can target one, several, or all viewports independently:
```
<!-- graphics[vertical-left]:stanza,logo -->   vertical-left gets stanza+logo
<!-- graphics:logo,banner -->                  every viewport gets logo+banner
<!-- graphics[vertical-right]: -->             vertical-right cleared
```
Each viewport renders and streams independently, so a 16:9 landscape feed and a 9:16 vertical feed can show entirely different overlay content from the same show, at the same time.

- **Needs:** one DSK renderer instance per output dimension/destination.
- **Docs:** `docs/plans/plan_dsk.md` (viewport CRUD), `docs/METACODE.md`.

### Pipeline I — Music detection
**Best for:** worship/concert productions where you want STT to go quiet during musical numbers, or want a producer-facing "music is playing" / BPM cue light without identifying the song.

Two independent audio paths feed the same classifier output (music/speech/silence + BPM estimate): server-side (HLS segments or RTMP PCM, no browser needed) or client-side (browser mic, Web Audio API). Output is exposed as SSE events and `<!-- sound:... -->`/`<!-- bpm:... -->` metacodes — wire it into STT confidence gating, a DSK "now playing" indicator, or BPM-synced graphic cuts.

- **Needs:** either an RTMP/HLS audio source, or a browser microphone.
- **Docs:** `docs/plans/plan_music.md`, `packages/plugins/lcyt-music/`.

---

## 3. Pipelines That Need More Code

Honest gap list — what's solid today vs. what still needs engineering work before each pipeline above is fully production-ready end to end.

| Pipeline | Status | What's missing |
|---|---|---|
| **A. Frontend transcribe** | ✅ Fully implemented | No known gaps. |
| **B. Backend transcribe** | ⚠️ Functional, needs hardening | REST/HLS path works today. gRPC streaming mode and the RTMP/WHEP audio-source fallback paths (plan_server_stt Phases 2-4) are still being hardened — expect rough edges under sustained load or on flaky RTMP ingests. |
| **C. RTMP fan-out** | ✅ Fully implemented | `NginxManager` reload-failure handling has a documented test gap (low risk, not user-facing). |
| **D. Metacode automation** | ✅ Fully implemented | None blocking; `plan_metacode_refactor` is an internal code-organization cleanup, not a feature gap. |
| **E. Camera control** | ✅ Fully implemented | All four adapters (AMX, VISCA-IP, browser, none) are wired with no open stubs. |
| **F. Video switcher control** | ⚠️ One real gap | The `obs` mixer adapter (`adapters/mixer/obs.js`) builds a correct `obs_switch` command object, but **`lcyt-bridge` does not yet dispatch it** — OBS switching is configured but inert today. Roland/AMX/ATEM/LCYT/Monarch HDX all work. This is the most concretely scoped piece of missing code in the whole feature set. |
| **G. Graphics (DSK)** | ✅ Core fully implemented | Phase 5 (animated transitions between graphic states) is still on the roadmap; static/instant show-hide works today. |
| **H. Multi-screen graphics** | ✅ Fully implemented | Viewport targeting and independent rendering both work today; the only related gap is the same animation Phase 5 noted above. |
| **I. Music detection** | ⚠️ Functional, polish remaining | Detection, BPM estimation, and both audio paths (server + client) work. Phase 4 (tuning, export, pluggable external classifier) is unstarted, and the `on_publish` auto-start hook for `music_config.autoStart` isn't wired — autostart-on-stream-begin doesn't happen automatically yet, has to be triggered manually via `/music/start`. |

**Single most actionable fix:** wiring `obs_switch` dispatch into `lcyt-bridge` (Pipeline F) — the adapter-side contract already exists, it's a bridge-agent-only change with no architectural ambiguity.
