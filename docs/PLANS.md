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
| [plan_dashboard_console_redesign.md](plans/plan_dashboard_console_redesign.md) | Dashboard / Console Redesign | Restructures lcyt-web IA: Broadcast becomes the operate surface (Live widget grid [...]
| [plan_sync.md](plans/plan_sync.md) | YouTube Heartbeat Sync (syncOffset) | NTP-style clock synchronization for `YoutubeLiveCaptionSender` using YouTube's heartbeat server timestamp. | |
| [plan_backend.md](plans/plan_backend.md) | lcyt-backend Express Relay Backend | CORS relay backend for YouTube Live caption ingestion: JWT auth, SQLite key management, multi-user sessions, admin[...]
| [plan_client.md](plans/plan_client.md) | Web GUI Client (lcyt-web) | Browser-based React SPA connecting to lcyt-backend: file management, session lifecycle, STT integration, embed widgets. | |
| [plan_mcp_oauth.md](plans/plan_mcp_oauth.md) | OAuth Authorization Server for MCP (Deferred) | Reference design, not scheduled: LCYT as its own OAuth 2.1 authorization server (static pre-registe[...]
| [plan_hls_sidecar.md](plans/plan_hls_sidecar.md) | HLS Multilingual Caption Sidecar | Rolling WebVTT subtitle segments sidecar for HLS stream; HLS.js player at `/video/:key` with CC language sel[...]
| [plan_mediamtx.md](plans/plan_mediamtx.md) | MediaMTX Integration | Opt-in MediaMTX media broker as alternative to ffmpeg-based RTMP/HLS flows; NginxManager for slug-based public URLs. | superse[...]
| [plan_selfservice_config_backend.md](plans/plan_selfservice_config_backend.md) | Self-Service Config Backend: Caption Targets/Translation, Ingestion, and Web Radio | Promotes three client-only/a[...]
| [plan_authentication_refactor.md](plans/plan_authentication_refactor.md) | Authentication Refactor — Unified Project Access & Scoped External Tokens | Backend auth policy implemented: dedicate[...]
| [plan_batch_options.md](plans/plan_batch_options.md) | Batched YouTube Sending with Per-Caption Options | Client-side-only fix for batch-interval mode dropping all per-caption options (translati[...]
| [plan_prod.md](plans/plan_prod.md) | Production Control (cameras, mixers, bridge) | Pluggable production control layer: PTZ camera presets, video mixer source switching, lcyt-bridge TCP relay ag[...]
| [plan_rtmp.md](plans/plan_rtmp.md) | RTMP Processing Pipeline | Orchestrate ffmpeg subprocesses from a single RTMP ingest: audio-only HLS, video+audio HLS, RTMP relay/fan-out, DSK overlays, thum[...]
| [plan_stt.md](plans/plan_stt.md) | Speech-to-Text (STT) Integration | Browser-based speech capture in lcyt-web: WebKit (Web Speech API) and Google Cloud STT engines, client-side VAD, translation[...]
| [plan_captions.md](plans/plan_captions.md) | Caption Sending Pipeline | End-to-end caption delivery: input sources, composition, target fan-out (YouTube, viewer, generic), sequence tracking, NTP[...]
| [plan_translations.md](plans/plan_translations.md) | Caption Translation Pipeline | Client-side real-time translation before sending: vendor abstraction (MyMemory, Google, DeepL, LibreTranslate)[...]
| [plan_cea.md](plans/plan_cea.md) | CEA-708 SEI NAL Caption Embedding in RTMP Relay | CEA-708 caption embedding implemented in RtmpRelayManager via ffmpeg tee muxer with eia608 subtitle encoder a[...]
| [plan_pyback.md](plans/plan_pyback.md) | Python Backend Scope Reduction | Python backend reduced to minimal unauthenticated CORS relay for YouTube caption sending. Removed API keys, JWT auth, ad[...]
| [plan_cache.md](plans/plan_cache.md) | HTTP Caching Strategy — Backend, Plugins & nginx | Comprehensive caching plan: Cache-Control headers for all backend GET endpoints (6 tiers), nginx proxy[...]
| [plan_setup_wizard.md](plans/plan_setup_wizard.md) | Setup Wizard | Guided setup flow at `/setup`: feature selection, dependency auto-enable, config panels (targets, translation, relay, STT, emb[...]
| [plan_userprojects.md](plans/plan_userprojects.md) | Richer Projects System: Feature Flags, Membership, and Device Roles | Phases 1–3 implemented. DB tables (project_features, user_features, p[...]
| [plan_cloudfleet.md](plans/plan_cloudfleet.md) | Hosting Modes & Cloudfleet Deployment | All three tiers implemented: Tier 1 (docker-compose.yml), Tier 2 (docker-compose.orchestrator.yml + Hetzn[...]
| [plan_dsk.md](plans/plan_dsk.md) | DSK Graphics Editor — Phases 2–4 (Editable Shapes, Multi-select, Media Library) | Phases 1–4 implemented. Direct canvas drag/resize/nudge, undo/redo, mul[...]
| [plan_files3.md](plans/plan_files3.md) | `lcyt-files` Plugin — Storage-Adapter Caption & Stream File I/O | Fully implemented: local FS, S3, and WebDAV adapters; three storage modes; per-key st[...]
| [plan_admin.md](plans/plan_admin.md) | Admin Panel — Web-based User & Project Management | Phases 1 & 2 fully implemented. Feature-gated admin section in lcyt-web: user/project CRUD with searc[...]
| [plan_ui.md](plans/plan_ui.md) | Frontend & UI Plans | All planned items implemented. v4 two-phase login + feature-based UI complete. Backlog items all done: guided setup wizard (`/setup`), empt[...]
| [plan_dock_ffmpeg.md](plans/plan_dock_ffmpeg.md) | FFmpeg Compute Containers → Distributed Hetzner Architecture | All phases implemented. Phases 1–3: `DockerFfmpegRunner` abstraction behind [...]
| [plan_team_org_backend.md](plans/plan_team_org_backend.md) | Team/Org Data Model — Backend Design | `organizations`/`org_members`/`api_keys.org_id` schema, full org CRUD + membership routes (`[...]
| [plan_site_feature_policies.md](plans/plan_site_feature_policies.md) | Site Feature Policies — Tri-State Availability Model | Fully implemented: `site_feature_policies`/`org_feature_overrides`[...]
| [plan_profile_team_admin_reconciliation.md](plans/plan_profile_team_admin_reconciliation.md) | Profile, Team & Admin — Claude Design Reconciliation | Reconciles `/team`, `/account`, and the 4 [...]
| [plan_pubsub_event_bus.md](plans/plan_pubsub_event_bus.md) | Pub/Sub Event Bus — Unified Internal & External Event Distribution | Implemented: shared `EventBus` in `packages/lcyt/src/event-bus[...]
| [plan_cues.md](plans/plan_cues.md) | Cue Engine Enhanced Capabilities | Phases 1–8 fully implemented: inline cues, modifiers, fuzzy matching, sound detection, semantic/event cues, AI event evaluation, composite conditions. | |
| [plan_server_stt.md](plans/plan_server_stt.md) | Server-side Speech-to-Text (STT) | Phases 1–5 fully implemented and verified: HLS + Google STT, additional providers (Whisper, OpenAI), RTMP/WHEP fallback, gRPC + quality controls, multi-language routing. | |
| [plan_music.md](plans/plan_music.md) | Music Detection Plugin (`lcyt-music`) | Phases 1–3 fully implemented: client-side (browser mic) + server-side (HLS/RTMP) music/speech/silence classification with BPM detection, sound-label SSE events. | |
| [plan_agent.md](plans/plan_agent.md) | AI Agent Capabilities (`lcyt-agent`) | Phases 1–6 fully implemented: AI config & embeddings, context window, event cue LLM evaluation, DSK template generation, rundown generation, vision/image inference (superseded by `plan_ai_roles_framework.md` Tracker/Describer). | |
| [plan_mcp.md](plans/plan_mcp.md) | MCP Tools for lcyt | Implemented: shared tool-schema module (`lcyt-tools`), in-process MCP bridge for agentic chat, `mcp_tokens` table + CRUD routes. External MCP server wiring pending. | |
| [plan_dsk_viewport_settings.md](plans/plan_dsk_viewport_settings.md) | DSK Viewports v2 — Slug URLs, Display Settings, Multi-Renderer, RTMP Colorkey | Phases 1–5 fully implemented: project slugs + org policy, slug resolution, viewport display settings, multi-renderer per-viewport streams, chromakey for composite. | |

### In progress

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_api_connectors_variables.md](plans/plan_api_connectors_variables.md) | API Connectors & Variables — {{ }} Bindings and Metacode-Triggered Refresh | Project-scoped variable system (`{{name}}` insertion, timing-agnostic, usable anywhere) backed by user-defined API Connectors (base URL, auth, headers) with nested Requests (method/path/q[...]
| [plan_ai_roles_framework.md](plans/plan_ai_roles_framework.md) | AI Roles Framework — Model + Harness Selection | Extensible AI "role" registry (`ai_roles` catalog + `project_ai_role_configs`) replacing ad-hoc AI config with generic model+harness selection. Tracker/Describer/Setup/Asset/Planner/Graphics/Production Assistants. | |
| [plan_ai_model_registry.md](plans/plan_ai_model_registry.md) | AI Model Registry — Site & Project Provider Catalog, Ollama Auto-Discovery, Bridge-Relayed Local Models | `ai_providers`/`ai_provider_models`/`ai_provider_grants` registry of model sources (cloud API, self-hosted Ollama, local `deer` runtimes). Bridge-relayed inference + Docker deployment mode. | |
| [TODO_plan.md](plans/TODO_plan.md) | Implement TODO.md items | Resolve open TODO.md items: Python stderr logging, MCP auto-sync and time field, docs reorganisation, CLAUDE.md lcyt-mcp reference.[...]
| [plan_help.md](plans/plan_help.md) | Help Page Screenshot Capture | Programmatic Playwright screenshot capture of all significant lcyt-web UI views for the user-facing help page. | |
| [plan_viewer_icons.md](plans/plan_viewer_icons.md) | Viewer Icon Toggle + Icons Setup-Hub Card | Operator-side "show icon" enable/disable toggle plus the existing which-icon picker in Targets 👤 [...]
| [plan_translate.md](plans/plan_translate.md) | Server-Side Translation Plugin (`lcyt-translate`) | Exploratory plan for server-side translation to close the STT and CLI translation gap: vendor a[...]

### Pending

| File | Title | Summary | Supersedes |

### Draft

| File | Title | Summary | Supersedes |
|---|---|---|---|
| [plan_web_ui_event_stream_consolidation.md](plans/plan_web_ui_event_stream_consolidation.md) | Consolidate the Operator Web UI onto one `/events/stream` | Collapse the UI's several authenticated[...]
| [plan_unified_external_control.md](plans/plan_unified_external_control.md) | Unified External Control & Automation (umbrella) | Ties the event bus, shared tool registry, token scope model, and a[...]
| [plan_metacode_variable_unification.md](plans/plan_metacode_variable_unification.md) | Metacode ↔ Variable Unification — One Namespace, Reserved-Name Registry | Reframes every metacode `<!--[...]
| [plan_named_actions.md](plans/plan_named_actions.md) | Named Actions — @name Composite Action Macros | Named/composite action macros (imperative sibling of cues): a named action is a bundle of[...]
| [plan_live_variables.md](plans/plan_live_variables.md) | Live Variables — Continuous Refresh, Live Operator Display, Text-Block Expansion | Forward-looking variable behaviours split out of the[...]
| [plan_monitors.md](plans/plan_monitors.md) | Monitors — Confidence-Only Ingestion for Visual Monitoring | Push/pull-ingested feeds shown to the operator purely for visual monitoring (e.g. a co[...]
| [plan_mixer_feed_sources.md](plans/plan_mixer_feed_sources.md) | Mixer Feed Sources — Encoder & File Sources, Low-Latency Preview Tiles | Generalizes the LCYT software mixer's program bus beyo[...]
| [plan_postgres_option.md](plans/plan_postgres_option.md) | PostgreSQL as an Optional Backend | Adds PostgreSQL as an optional backend for the Node.js backend and plugin-owned DB layers while pre[...]

### Reference

| File | Title | Summary |
|---|---|---|
| [PR_phase6-7_hetzner.md](plans/PR_phase6-7_hetzner.md) | PR: Phase 6–7 Hetzner provisioning and autoscaling scaffolding | PR artifact for `plan/dock-ffmpeg` phases 6–7: Hetzner provisioning,[...]
| [plan_backend_split.md](plans/plan_backend_split.md) | lcyt-backend Modularization & Plugin Extraction Assessment | Structural analysis of lcyt-backend: plugin extraction complete (lcyt-rtmp, lc[...]
