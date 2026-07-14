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

| File | Title | Summary |
|---|---|---|
| [plan_dashboard_console_redesign.md](plans/plan_dashboard_console_redesign.md) | Dashboard / Console Redesign | Restructures lcyt-web IA: Broadcast becomes the operate surface (Live widget grid, caption input). |
| [plan_sync.md](plans/plan_sync.md) | YouTube Heartbeat Sync (syncOffset) | NTP-style clock synchronization for `YoutubeLiveCaptionSender` using YouTube's heartbeat server timestamp. |
| [plan_backend.md](plans/plan_backend.md) | lcyt-backend Express Relay Backend | CORS relay backend for YouTube Live caption ingestion: JWT auth, SQLite key management, multi-user sessions. |
| [plan_client.md](plans/plan_client.md) | Web GUI Client (lcyt-web) | Browser-based React SPA connecting to lcyt-backend: file management, session lifecycle, STT integration. |
| [plan_mcp_oauth.md](plans/plan_mcp_oauth.md) | OAuth Authorization Server for MCP (Deferred) | Reference design: LCYT as OAuth 2.1 authorization server (static pre-registration, not scheduled). |
| [plan_hls_sidecar.md](plans/plan_hls_sidecar.md) | HLS Multilingual Caption Sidecar | Rolling WebVTT subtitle segments sidecar for HLS stream with language selection. |
| [plan_mediamtx.md](plans/plan_mediamtx.md) | MediaMTX Integration | Opt-in MediaMTX media broker as alternative to ffmpeg-based RTMP/HLS flows. |
| [plan_selfservice_config_backend.md](plans/plan_selfservice_config_backend.md) | Self-Service Config Backend: Caption Targets/Translation & Ingestion | Backend-persisted config for caption targets, translation vendor settings, and RTMP ingestion (admin-only ingestion enable/disable, stream key rotation). |
| [plan_authentication_refactor.md](plans/plan_authentication_refactor.md) | Authentication Refactor — Unified Project Access & Scoped External Tokens | Dedicated auth layer, scoped external tokens, project-level session Bearer, permission inheritance. |
| [plan_batch_options.md](plans/plan_batch_options.md) | Batched YouTube Sending with Per-Caption Options | Client-side fix for batch-interval mode dropping per-caption options (translation, no-batch, stream keys). |
| [plan_prod.md](plans/plan_prod.md) | Production Control (cameras, mixers, bridge) | Pluggable production control layer: PTZ presets, video mixer source switching, lcyt-bridge TCP relay aggregator. |
| [plan_rtmp.md](plans/plan_rtmp.md) | RTMP Processing Pipeline | Orchestrate ffmpeg subprocesses from a single RTMP ingest: audio-only HLS, video+audio HLS, RTMP relay/fan-out, DSK overlays. |
| [plan_stt.md](plans/plan_stt.md) | Speech-to-Text (STT) Integration | Browser-based speech capture in lcyt-web: WebKit (Web Speech API) and Google Cloud STT engines, VAD. |
| [plan_captions.md](plans/plan_captions.md) | Caption Sending Pipeline | End-to-end caption delivery: input sources, composition, target fan-out (YouTube, viewer, generic), sequence tracking. |
| [plan_cea.md](plans/plan_cea.md) | CEA-708 SEI NAL Caption Embedding in RTMP Relay | CEA-708 caption embedding via ffmpeg eia608 subtitle encoder in RtmpRelayManager. |
| [plan_pyback.md](plans/plan_pyback.md) | Python Backend Scope Reduction | Python backend reduced to minimal unauthenticated CORS relay for YouTube caption sending. |
| [plan_cache.md](plans/plan_cache.md) | HTTP Caching Strategy — Backend, Plugins & nginx | Comprehensive caching: Cache-Control headers (6 tiers), nginx proxy caching, ETag validation. |
| [plan_setup_wizard.md](plans/plan_setup_wizard.md) | Setup Wizard | Guided setup flow at `/setup`: feature selection, dependency auto-enable, config panels. |
| [plan_userprojects.md](plans/plan_userprojects.md) | Richer Projects System: Feature Flags, Membership, Device Roles | Phases 1–3 implemented: project features, user project membership, device roles. |
| [plan_cloudfleet.md](plans/plan_cloudfleet.md) | Hosting Modes & Cloudfleet Deployment | All three tiers: docker-compose.yml, docker-compose.orchestrator.yml + Hetzner auto-provisioning. |
| [plan_dsk.md](plans/plan_dsk.md) | DSK Graphics Editor — Phases 2–4 | Phases 1–4 implemented: editable shapes, multi-select, undo/redo, media library, layer styling. |
| [plan_files3.md](plans/plan_files3.md) | `lcyt-files` Plugin — Storage-Adapter Caption & Stream File I/O | Fully implemented: local FS, S3, WebDAV adapters; three storage modes; per-key storage isolation. |
| [plan_admin.md](plans/plan_admin.md) | Admin Panel — Web-based User & Project Management | Phases 1 & 2 implemented: feature-gated admin section with user/project CRUD, search. |
| [plan_ui.md](plans/plan_ui.md) | Frontend & UI Plans | All planned items implemented: v4 two-phase login, feature-based UI, setup wizard, empty states. |
| [plan_dock_ffmpeg.md](plans/plan_dock_ffmpeg.md) | FFmpeg Compute Containers → Distributed Hetzner Architecture | All phases implemented: `DockerFfmpegRunner` abstraction, Hetzner provisioning, autoscaling. |
| [plan_team_org_backend.md](plans/plan_team_org_backend.md) | Team/Org Data Model — Backend Design | `organizations`/`org_members`/`api_keys.org_id` schema; full org CRUD + membership routes. |
| [plan_site_feature_policies.md](plans/plan_site_feature_policies.md) | Site Feature Policies — Tri-State Availability Model | Fully implemented: `site_feature_policies`/`org_feature_overrides`; enable/disable/override per org. |
| [plan_profile_team_admin_reconciliation.md](plans/plan_profile_team_admin_reconciliation.md) | Profile, Team & Admin — Claude Design Reconciliation | Reconciles `/team`, `/account`, and admin surfaces; unified page layout. |
| [plan_pubsub_event_bus.md](plans/plan_pubsub_event_bus.md) | Pub/Sub Event Bus — Unified Internal & External Event Distribution | Implemented: shared `EventBus` in packages; unified internal & external event distribution. |
| [plan_cues.md](plans/plan_cues.md) | Cue Engine Enhanced Capabilities | Phases 1–8 fully implemented: inline cues, modifiers, fuzzy matching, sound detection, semantic/event cues. |
| [plan_server_stt.md](plans/plan_server_stt.md) | Server-side Speech-to-Text (STT) | Phases 1–5 fully implemented: HLS + Google STT, Whisper, OpenAI providers, RTMP/WHEP fallback, gRPC. |
| [plan_music.md](plans/plan_music.md) | Music Detection Plugin (`lcyt-music`) | Phases 1–3 fully implemented: client-side + server-side music/speech/silence classification with BPM detection. |
| [plan_agent.md](plans/plan_agent.md) | AI Agent Capabilities (`lcyt-agent`) | Phases 1–6 fully implemented: AI config, embeddings, context window, event cue evaluation, DSK/rundown generation. |
| [plan_mcp.md](plans/plan_mcp.md) | MCP Tools for lcyt | Implemented: shared tool-schema module, in-process MCP bridge, `mcp_tokens` table + routes. |
| [plan_dsk_viewport_settings.md](plans/plan_dsk_viewport_settings.md) | DSK Viewports v2 — Slug URLs, Display Settings, Multi-Renderer | Phases 1–5 fully implemented: project slugs, viewport settings, multi-renderer streams, chromakey. |
| [plan_translations.md](plans/plan_translations.md) | Caption Translation Pipeline | Client-side real-time translation: MyMemory, Google, DeepL, LibreTranslate vendor abstraction. |

### In progress

| File | Title | Summary |
|---|---|---|
| [plan_api_connectors_variables.md](plans/plan_api_connectors_variables.md) | API Connectors & Variables — {{ }} Bindings and Metacode-Triggered Refresh | Project-scoped variable system with `{{name}}` insertion and API-triggered refresh. |
| [plan_ai_roles_framework.md](plans/plan_ai_roles_framework.md) | AI Roles Framework — Model + Harness Selection | Extensible `ai_roles` registry + `project_ai_role_configs` for Tracker/Describer/Setup/Asset/Planner roles. |
| [plan_ai_model_registry.md](plans/plan_ai_model_registry.md) | AI Model Registry — Site & Project Provider Catalog, Ollama Auto-Discovery | `ai_providers`/`ai_provider_models`/`ai_provider_grants`; bridge-relayed inference; Docker deployment. |
| [plan_help.md](plans/plan_help.md) | Help Page Screenshot Capture | Programmatic Playwright screenshot capture of lcyt-web UI views for help page. |
| [plan_viewer_icons.md](plans/plan_viewer_icons.md) | Viewer Icon Toggle + Icons Setup-Hub Card | Operator-side icon enable/disable toggle and Setup Hub card for icon configuration. |
| [plan_translate.md](plans/plan_translate.md) | Server-Side Translation Plugin (`lcyt-translate`) | Exploratory: server-side translation to close STT and CLI translation gap. |
| [TODO_plan.md](plans/TODO_plan.md) | Implement TODO.md items | Python stderr logging, MCP auto-sync + time field, docs reorganisation. |
| [plan_vertical_crop.md](plans/plan_vertical_crop.md) | Vertical Crop Output — Live-Repositionable Landscape→Portrait Crop | Phases 1–2 implemented (schema, CropManager + {key}-crop path, /crop routes, relay sourceView, zmq live reposition with restart fallback); UI + production-follow phases remain. |

### Pending

(None at this time)

### Draft

| File | Title | Summary |
|---|---|---|
| [plan_assets_page.md](plans/plan_assets_page.md) | Assets Page — Content Library of Project Assets | Rebuilds `/assets` into a SetupCard-style content library (Graphics, Global cues, Global actions, Icons, Caption files, Broadcasts) distinct from Setup infra; persists YouTube video id(s) per session for Broadcast → cast links. |
| [plan_broadcasts.md](plans/plan_broadcasts.md) | Broadcasts — First-Class Intra-Project Broadcast Entity | Adds a `broadcasts` entity (a project casts many times) as an interface to the YouTube Live schedule + asset gathering: lifecycle, calendar scheduling, `broadcast_assets` linkage, 1:1 session binding (ad-hoc auto-creates), duplication without produced content, delete-archives (no auto-purge; hard-delete blocked until a cooling-off window), and `broadcast_id` on sessions/stats/caption files. |
| [plan_web_ui_event_stream_consolidation.md](plans/plan_web_ui_event_stream_consolidation.md) | Consolidate the Operator Web UI onto one `/events/stream` | Collapse the UI's authenticated and unauthenticated SSE streams into one unified stream. |
| [plan_unified_external_control.md](plans/plan_unified_external_control.md) | Unified External Control & Automation (umbrella) | Ties event bus, shared tool registry, token scope model, and MCP integration together. |
| [plan_metacode_variable_unification.md](plans/plan_metacode_variable_unification.md) | Metacode ↔ Variable Unification — One Namespace, Reserved-Name Registry | Reframes every metacode into one unified namespace with reserved-name registry. |
| [plan_named_actions.md](plans/plan_named_actions.md) | Named Actions — @name Composite Action Macros | Named/composite action macros: bundle metacodes into reusable named sequences. |
| [plan_live_variables.md](plans/plan_live_variables.md) | Live Variables — Continuous Refresh, Live Operator Display, Text-Block Expansion | Forward-looking variable behaviours: live refresh, operator display, dynamic text expansion. |
| [plan_monitors.md](plans/plan_monitors.md) | Monitors — Confidence-Only Ingestion for Visual Monitoring | Push/pull-ingested feeds shown purely for visual monitoring (e.g., confidence scores). |
| [plan_mixer_feed_sources.md](plans/plan_mixer_feed_sources.md) | Mixer Feed Sources — Encoder & File Sources, Low-Latency Preview Tiles | Generalizes software mixer program bus beyond video to include encoder/file sources. |
| [plan_postgres_option.md](plans/plan_postgres_option.md) | PostgreSQL as an Optional Backend | Adds PostgreSQL as optional backend for Node.js backend and plugin-owned DB layers. |
| [plan_metacode_refactor.md](plans/plan_metacode_refactor.md) | Metacode Refactor Plan | Mechanical relocation of scattered metacode handling into dedicated files (clarity refactor). |

### Reference

| File | Title | Summary |
|---|---|---|
| [PR_phase6-7_hetzner.md](plans/PR_phase6-7_hetzner.md) | PR: Phase 6–7 Hetzner provisioning and autoscaling scaffolding | PR artifact for `plan/dock-ffmpeg`: Hetzner provisioning + autoscaling. |
| [plan_backend_split.md](plans/plan_backend_split.md) | lcyt-backend Modularization & Plugin Extraction Assessment | Structural analysis: plugin extraction complete (lcyt-rtmp, lcyt-dsk, lcyt-agent, lcyt-music, lcyt-cues). |
| [plan_dock_ffmpeg.md.old](plans/plan_dock_ffmpeg.md.old) | (Archived) FFmpeg Plan — Old Version | Superseded 2026-03-20; see current `plan_dock_ffmpeg.md` instead. |
