# Plans

All planning documents live in [`docs/plans/`](plans/). This index lists each plan with its current status.

## Status legend

| Status | Meaning |
|---|---|
| `implemented` | Feature is fully built and in production |
| `in-progress` | Partially implemented; work ongoing |
| `pending` | Plan accepted and scheduled; implementation not yet started |
| `draft` | Plan written; not yet formally accepted or scheduled |
| `reference` | Supporting artifact for another plan (PR description, runbook, etc.) |

---

## Plans by status

### Implemented

| File | Title | Summary | Superseded by |
|---|---|---|---|
| [plan_sync.md](plans/plan_sync.md) | YouTube Heartbeat Sync (syncOffset) | NTP-style clock synchronization for `YoutubeLiveCaptionSender` using YouTube's heartbeat server timestamp. | |
| [plan_backend.md](plans/plan_backend.md) | lcyt-backend Express Relay Backend | CORS relay backend for YouTube Live caption ingestion: JWT auth, SQLite key management, multi-user sessions, admin CLI. | |
| [plan_client.md](plans/plan_client.md) | Web GUI Client (lcyt-web) | Browser-based React SPA connecting to lcyt-backend: file management, session lifecycle, STT integration, embed widgets. | |
| [plan_mcp.md](plans/plan_mcp.md) | MCP Tools for lcyt | Model Context Protocol server (stdio and HTTP SSE transports) exposing caption, production, and DSK graphics tools to AI assistants. | |
| [plan_hls_sidecar.md](plans/plan_hls_sidecar.md) | HLS Multilingual Caption Sidecar | Rolling WebVTT subtitle segments sidecar for HLS stream; HLS.js player at `/video/:key` with CC language selection. | |
| [plan_mediamtx.md](plans/plan_mediamtx.md) | MediaMTX Integration | Opt-in MediaMTX media broker as alternative to ffmpeg-based RTMP/HLS flows; NginxManager for slug-based public URLs. | supersedes `plan/rtmp` partially |
| [plan_prod.md](plans/plan_prod.md) | Production Control (cameras, mixers, bridge) | Pluggable production control layer: PTZ camera presets, video mixer source switching, lcyt-bridge TCP relay agent, MCP tools. | |
| [plan_rtmp.md](plans/plan_rtmp.md) | RTMP Processing Pipeline | Orchestrate ffmpeg subprocesses from a single RTMP ingest: audio-only HLS, video+audio HLS, RTMP relay/fan-out, DSK overlays, thumbnails. | `plan/dock-ffmpeg` (execution model), `plan/mediamtx` (RTMP/HLS path) |
| [plan_stt.md](plans/plan_stt.md) | Speech-to-Text (STT) Integration | Browser-based speech capture in lcyt-web: WebKit (Web Speech API) and Google Cloud STT engines, client-side VAD, translation pipeline, MCP speech sessions, and embed widget. | |

### In progress

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_dsk.md](plans/plan_dsk.md) | DSK Graphics Editor — Phase 2 (Editable Shapes) | Phase 1 complete (template editor, renderer, broadcast control). Phase 2 adds direct canvas drag/resize/keyboard nudge for shape layers. | |
| [TODO_plan.md](plans/TODO_plan.md) | Implement TODO.md items | Resolve open TODO.md items: Python stderr logging, MCP auto-sync and time field, docs reorganisation, CLAUDE.md lcyt-mcp reference. | |

### Pending

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_UI.md](plans/plan_UI.md) | UI Reorganisation (lcyt-web) | Redesign lcyt-web desktop (two-column) and mobile (fixed bottom bar + FAB) layouts to improve clarity for the expanded feature set. | relates to `plan/front` |
| [plan_dock_ffmpeg.md](plans/plan_dock_ffmpeg.md) | FFmpeg Compute Containers → Distributed Hetzner Architecture | Migrate ffmpeg jobs from bare `spawn()` into Docker containers (phases 1–3), then distribute across Hetzner Cloud worker VMs via a Compute Orchestrator (phases 4–7). | `plan/rtmp` (execution model) |
| [plan_help.md](plans/plan_help.md) | Help Page Screenshot Capture | Programmatic Playwright screenshot capture of all significant lcyt-web UI views for the user-facing help page. | |

### Draft

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_server_stt.md](plans/plan_server_stt.md) | Server-side Speech-to-Text (STT) | Server-side audio capture from MediaMTX (RTMP, HLS, or WebRTC/WHEP) piped through ffmpeg into pluggable STT provider adapters (whisper.cpp, Google Cloud STT, OpenAI-compatible Whisper); transcripts delivered into the existing caption pipeline without browser involvement. | |
| [plan_cea.md](plans/plan_cea.md) | CEA-708 SEI NAL Caption Embedding in RTMP Relay | Embed closed captions as H.264 SEI NAL units in the RTMP relay stream using ffmpeg tee muxer with PTS-anchored payloads. | |
| [plan_front.md](plans/plan_front.md) | Frontend Flow Improvement | Targeted UI improvements for lcyt-web: sidebar navigation, hybrid settings page, improved information architecture for the multi-feature platform. | relates to `plan/ui` |

### Reference

| File | Title | Summary |
|---|---|---|
| [PR_phase6-7_hetzner.md](plans/PR_phase6-7_hetzner.md) | PR: Phase 6–7 Hetzner provisioning and autoscaling scaffolding | PR artifact for `plan/dock-ffmpeg` phases 6–7: Hetzner provisioning, snapshot boot, autoscaling scaffolding, operator runbook. |
