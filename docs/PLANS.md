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
| [plan_captions.md](plans/plan_captions.md) | Caption Sending Pipeline | End-to-end caption delivery: input sources, composition, target fan-out (YouTube, viewer, generic), sequence tracking, NTP clock sync, and SSE result reporting. | |
| [plan_translations.md](plans/plan_translations.md) | Caption Translation Pipeline | Client-side real-time translation before sending: vendor abstraction (MyMemory, Google, DeepL, LibreTranslate), multi-target routing, per-language viewer display, HLS subtitle sidecar, and local/backend file writing. | |
| [plan_cea.md](plans/plan_cea.md) | CEA-708 SEI NAL Caption Embedding in RTMP Relay | CEA-708 caption embedding implemented in RtmpRelayManager via ffmpeg tee muxer with eia608 subtitle encoder and SRT stdin pipe. Per-slot captionMode and per-key cea708_delay_ms. | |
| [plan_pyback.md](plans/plan_pyback.md) | Python Backend Scope Reduction | Python backend reduced to minimal unauthenticated CORS relay for YouTube caption sending. Removed API keys, JWT auth, admin routes, SQLite database. | |
| [plan_cache.md](plans/plan_cache.md) | HTTP Caching Strategy — Backend, Plugins & nginx | Comprehensive caching plan: Cache-Control headers for all backend GET endpoints (6 tiers), nginx proxy_cache for HLS/media, NginxManager segment vs. playlist split, frontend `api.getCached()` layer, preview ETag support, operator deployment guide. | |
| [plan_userprojects.md](plans/plan_userprojects.md) | Richer Projects System: Feature Flags, Membership, and Device Roles | Phases 1–3 implemented. DB tables (project_features, user_features, project_members, project_member_permissions, project_device_roles), back-fill migration, DB helpers, route modules, device-login JWT, extended /keys responses, frontend components (FeaturePicker, ProjectDetailModal, DeviceLoginPage), feature-gate middleware (FEATURE_GATE_ENFORCE), admin user feature endpoints (GET/PATCH /admin/users/:id/features). Phase 4 (QR codes, tally light, time-limited sessions) remains future work. | |
| [plan_cloudfleet.md](plans/plan_cloudfleet.md) | Hosting Modes & Cloudfleet Deployment | All three tiers implemented: Tier 1 (docker-compose.yml), Tier 2 (docker-compose.orchestrator.yml + Hetzner VMs), Tier 3 (k8s/cloudfleet/ — all 11 K8s manifests + README). Supporting docs (DEPLOY.md, FIREWALL.md, hetzner_runbook.md, hetzner_snapshot.md) in place. Optional enhancements pending: Helm chart, Litestream sidecar, Postgres migration, ServiceMonitor, CI CFCR push. | |
| [plan_dsk.md](plans/plan_dsk.md) | DSK Graphics Editor — Phases 2–4 (Editable Shapes, Multi-select, Media Library) | Phases 1–4 implemented. Direct canvas drag/resize/nudge, undo/redo, multi-selection, snap-to-grid, snap-to-edges, group/ungroup, alignment tools, ellipse shape type, copy/paste, Media Library (image upload/browse/insert/delete), safe-area guides. Unit tests for geometry helpers and component tests for canvas interactions added. Phase 5 (Animations) remains. | |
| [plan_files3.md](plans/plan_files3.md) | `lcyt-files` Plugin — Storage-Adapter Caption & Stream File I/O | Fully implemented: local FS, S3, and WebDAV adapters; three storage modes; per-key storage config (`key_storage_config` DB table + API routes); `putObject`/`publicUrl` for HLS groundwork; `listObjects` (all adapters, with S3 pagination); GDPR erasure in `DELETE /stats` now deletes physical storage objects and `caption_files` DB rows. Remaining low-priority: CDN URL field, S3 mock tests, local→S3 migration script. | |
| [plan_admin.md](plans/plan_admin.md) | Admin Panel — Web-based User & Project Management | Phases 1 & 2 fully implemented. Feature-gated admin section in lcyt-web: user/project CRUD with search, batch ops, feature-flag editing, project membership. Phase 2 additions: `admin_audit_log` DB table, audit logging on all mutating admin actions, `GET /admin/audit-log` endpoint (with action/actor/date filters), user feature entitlement CRUD (`GET/PATCH /admin/users/:id/features`), JSON export (`GET /admin/export/users|projects`) and import (`POST /admin/import/users|projects`), date-range + status filters on list endpoints, `AdminAuditLogPage` frontend, export/import toolbar in list pages. | |
| [plan_ui.md](plans/plan_ui.md) | Frontend & UI Plans | All planned items implemented. v4 two-phase login + feature-based UI complete. Backlog items all done: guided setup wizard (`/setup`), empty-state guidance in captions view, settings export/import, normalized localStorage keys, command palette (Ctrl/Cmd+K), keyboard shortcuts overlay, status-bar badges, connection health dot, auto-reconnect with backoff, unsaved-work protection, virtual scrolling for SentPanel, context splitting, lazy-loaded heavy pages. | |

### In progress

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_cues.md](plans/plan_cues.md) | Cue Engine Enhanced Capabilities | Next-cue-only firing with skip/anywhere modifiers (`cue:`, `cue*:`, `cue**:`), fuzzy embedding-based matching, music-state cue triggers, semantic cues, and AI event cues. Phases 1-7 implemented; Phase 8 (multi-modal scene understanding) planned. See also plan_agent. | |
| [plan_agent.md](plans/plan_agent.md) | AI Agent Capabilities (`lcyt-agent`) | Central AI service: AI config, embeddings, context window, event cue evaluation via LLM, AI DSK template generation, AI rundown creation. Phases 1–3 and 5–6 implemented. Phase 5: `generateTemplate`/`editTemplate`/`suggestStyles`, `POST /agent/generate-template` + `POST /agent/edit-template` routes, AI DSK panel in `DskEditorPage`. Phase 6: `generateRundown`/`editRundown`, `POST /agent/generate-rundown` + `POST /agent/edit-rundown` routes, AI rundown panel in `PlannerPage`. Phase 4 (video/image inference), Phase 7 (multi-modal scene understanding), and Phase 8 (local Ollama support) remain planned. | |
| [TODO_plan.md](plans/TODO_plan.md) | Implement TODO.md items | Resolve open TODO.md items: Python stderr logging, MCP auto-sync and time field, docs reorganisation, CLAUDE.md lcyt-mcp reference. | |
| [plan_server_stt.md](plans/plan_server_stt.md) | Server-side Speech-to-Text (STT) | Phase 1 implemented: HlsSegmentFetcher, GoogleSttAdapter, WhisperHttpAdapter, OpenAiAdapter, SttManager, /stt routes. Phases 2–4 (gRPC streaming, RTMP/WHEP fallback enhancements) remain. | |
| [plan_dock_ffmpeg.md](plans/plan_dock_ffmpeg.md) | FFmpeg Compute Containers → Distributed Hetzner Architecture | Phases 1–3 implemented: DockerFfmpegRunner abstraction behind `FFMPEG_RUNNER` env flag, local/docker/worker runners. Orchestrator and worker-daemon packages scaffolded. Phases 4–7 (full distributed architecture) remain. | `plan/rtmp` (execution model) |
| [plan_setup_wizard.md](plans/plan_setup_wizard.md) | Setup Wizard | Guided setup flow at `/setup`: feature selection, dependency auto-enable, config panels (targets, translation, relay, STT, embed, CEA), shared panels architecture. Backend feature deps and wizard shell implemented; config step panels implemented. |
| [plan_music.md](plans/plan_music.md) | Music Detection Plugin (`lcyt-music`) | Detect when music is playing and estimate BPM — no song identification. Two paths: server-side HLS analysis via a new `lcyt-music` plugin; client-side browser mic analysis via Web Audio API in lcyt-web. Events feed into the caption pipeline (optional `♪` annotation) and are exposed via SSE. Phase 1 implemented: `lcyt-music` plugin (SoundCaptionProcessor, DB migrations), `subscribeSseEvent` in useSession, `useMusic`/`useMusicDetector` hooks, `MusicChip`/`MusicPanel` components, AudioPanel fftSize→2048, storageKeys update, i18n, backend + frontend tests. Phase 2 pending: `music_config` DB table, backend API routes, server-side HLS analysis, MusicPanel wiring. | |

### Pending
| [plan_help.md](plans/plan_help.md) | Help Page Screenshot Capture | Programmatic Playwright screenshot capture of all significant lcyt-web UI views for the user-facing help page. | |

### Draft

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_translate.md](plans/plan_translate.md) | Server-Side Translation Plugin (`lcyt-translate`) | Exploratory plan for server-side translation to close the STT and CLI translation gap: vendor adapters (MyMemory, Google, DeepL, LibreTranslate), per-key DB config, injection into captions.js and SttManager. | |

### Reference

| File | Title | Summary |
|---|---|---|
| [PR_phase6-7_hetzner.md](plans/PR_phase6-7_hetzner.md) | PR: Phase 6–7 Hetzner provisioning and autoscaling scaffolding | PR artifact for `plan/dock-ffmpeg` phases 6–7: Hetzner provisioning, snapshot boot, autoscaling scaffolding, operator runbook. |
| [plan_backend_split.md](plans/plan_backend_split.md) | lcyt-backend Modularization & Plugin Extraction Assessment | Structural analysis of lcyt-backend: plugin extraction complete (lcyt-rtmp, lcyt-dsk, lcyt-production, lcyt-files). Internal refactoring done. lcyt-translate plugin proposal remains exploratory. |
