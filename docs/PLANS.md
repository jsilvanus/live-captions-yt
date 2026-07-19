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

Where an implemented plan has known unbuilt parts (deferred phases, optional additions, explicit out-of-scope items), its summary carries a **Not done:** note listing them.

---

## Plans by status

### Implemented

| File | Title | Summary |
|---|---|---|
| [plan_dashboard_console_redesign.md](plans/plan_dashboard_console_redesign.md) | Dashboard / Console Redesign | Restructures lcyt-web IA: Broadcast becomes the operate surface (Live widget grid, caption input). Its "Deferred / Follow-up Work" items have all since shipped via later plans (team/org, site policies, AI roles, self-service config, account routes). |
| [plan_sync.md](plans/plan_sync.md) | YouTube Heartbeat Sync (syncOffset) | NTP-style clock synchronization for `YoutubeLiveCaptionSender` using YouTube's heartbeat server timestamp. |
| [plan_backend.md](plans/plan_backend.md) | lcyt-backend Express Relay Backend | CORS relay backend for YouTube Live caption ingestion: JWT auth, SQLite key management, multi-user sessions. |
| [plan_client.md](plans/plan_client.md) | Web GUI Client (lcyt-web) | Browser-based React SPA connecting to lcyt-backend: file management, session lifecycle, STT integration. YouTube stream-status polling shipped via `tmp_plan_tier3.md` Item 5 (`YouTubeTab.jsx` interval poll, paused when tab hidden) — was previously listed as out-of-scope for MVP. |
| [plan_hls_sidecar.md](plans/plan_hls_sidecar.md) | HLS Multilingual Caption Sidecar | Rolling WebVTT subtitle segments sidecar for HLS stream with language selection. ffprobe-based `BANDWIDTH`/`CODECS` detection shipped via `tmp_plan_tier3.md` Item 6 (replaces the prior hard-coded defaults, which remain the fallback when probing fails); CEA-708 embedding was delivered separately by plan_cea. |
| [plan_mediamtx.md](plans/plan_mediamtx.md) | MediaMTX Integration | Opt-in MediaMTX media broker as alternative to ffmpeg-based RTMP/HLS flows. |
| [plan_selfservice_config_backend.md](plans/plan_selfservice_config_backend.md) | Self-Service Config Backend: Caption Targets/Translation & Ingestion | Backend-persisted config for caption targets, translation vendor settings, and RTMP ingestion (admin-only ingestion enable/disable, stream key rotation). **Not done:** `PATCH /ingestion/dsk` is a deliberate 501 until a real DSK-ingest gate is designed. |
| [plan_authentication_refactor.md](plans/plan_authentication_refactor.md) | Authentication Refactor — Unified Project Access & Scoped External Tokens | Dedicated auth layer, scoped external tokens, project-level session Bearer, permission inheritance. **Not done:** UI adoption of user JWTs on project-scoped routes (follow-on); the external-event topic-scoping appendix is exploratory only. |
| [plan_batch_options.md](plans/plan_batch_options.md) | Batched YouTube Sending with Per-Caption Options | Client-side fix for batch-interval mode dropping per-caption options (translation, no-batch, stream keys). **Not done:** client-side early flush guard for the 64 kB payload limit (deliberately skipped until limits are ever hit). |
| [plan_prod.md](plans/plan_prod.md) | Production Control (cameras, mixers, bridge) | Pluggable production control layer: PTZ presets, video mixer source switching, lcyt-bridge TCP relay aggregator. |
| [plan_rtmp.md](plans/plan_rtmp.md) | RTMP Processing Pipeline | Orchestrate ffmpeg subprocesses from a single RTMP ingest: audio-only HLS, video+audio HLS, RTMP relay/fan-out, DSK overlays. |
| [plan_stt.md](plans/plan_stt.md) | Speech-to-Text (STT) Integration | Browser-based speech capture in lcyt-web: WebKit (Web Speech API) and Google Cloud STT engines, VAD. |
| [plan_captions.md](plans/plan_captions.md) | Caption Sending Pipeline | End-to-end caption delivery: input sources, composition, target fan-out (YouTube, viewer, generic), sequence tracking. |
| [plan_cea.md](plans/plan_cea.md) | CEA-708 SEI NAL Caption Embedding in RTMP Relay | CEA-708 caption embedding via ffmpeg eia608 subtitle encoder in RtmpRelayManager. |
| [plan_pyback.md](plans/plan_pyback.md) | Python Backend Scope Reduction | Python backend reduced to minimal unauthenticated CORS relay for YouTube caption sending. |
| [plan_cache.md](plans/plan_cache.md) | HTTP Caching Strategy — Backend, Plugins & nginx | Comprehensive caching: Cache-Control headers (6 tiers), nginx proxy caching, ETag validation. |
| [plan_setup_wizard.md](plans/plan_setup_wizard.md) | Setup Wizard | Guided setup flow at `/setup`: feature selection, dependency auto-enable, config panels. |
| [plan_userprojects.md](plans/plan_userprojects.md) | Richer Projects System: Feature Flags, Membership, Device Roles | Phases 1–3 implemented: project features, user project membership, device roles. Phase 4 partially shipped via `tmp_plan_tier3.md` Item 4: device-role active-flag JWT verification on every request (not just login), optional time-limited sessions (`expires_at`), and admin CLI `users features [list\|grant\|revoke]`. **Not done:** QR code generation for device PINs and the tally-light display — both deliberately left for a separate product/UX decision. |
| [plan_asset_backends.md](plans/plan_asset_backends.md) | Asset Backends — Server-Side Rundowns + Graphics-Editor Thumbnails | Implemented: server-backed rundown save/open in the planner and file-authoring routes, plus DSK thumbnail create/refresh/delete flows from the editor and backend-backed asset counts. |
| [plan_cloudfleet.md](plans/plan_cloudfleet.md) | Hosting Modes & Cloudfleet Deployment | All three tiers: docker-compose.yml, docker-compose.orchestrator.yml + Hetzner auto-provisioning. **Not done:** optional enhancements (Helm chart, Litestream, Postgres migration, CI CFCR push, native K8s Jobs runner) remain future work. |
| [plan_dsk.md](plans/plan_dsk.md) | DSK Graphics Editor — Phases 2–4 | Phases 1–4 implemented: editable shapes, multi-select, undo/redo, media library, layer styling. Rotation handle and snap-to-grid visual ruler overlay shipped via `tmp_plan_tier3.md` Item 2 — rotation applied consistently across the editor canvas, the Playwright renderer, and the live `/dsk/:key` overlay page. |
| [plan_files3.md](plans/plan_files3.md) | `lcyt-files` Plugin — Storage-Adapter Caption & Stream File I/O | Fully implemented: local FS, S3, WebDAV adapters; three storage modes; per-key storage isolation; local→S3 migration script (`scripts/migrate-files-to-s3.mjs`). `putObject`/`publicUrl` wired into the HLS manager and S3 adapter tests against a lightweight mock HTTP server both shipped via `tmp_plan_tier3.md` Items 1 and 7. **Not done:** a `cdn_url` config field (low). |
| [plan_admin.md](plans/plan_admin.md) | Admin Panel — Web-based User & Project Management | Phases 1 & 2 implemented: feature-gated admin section with user/project CRUD, search. Phase 3's role-based admin access (`admin_role`: full/readonly, gating every mutating `/admin/*` route) and admin action confirmation dialogs (shared `ConfirmDialog.jsx` replacing native `confirm()`) shipped via `tmp_plan_tier3.md` Item 3. The real-time live-stats dashboard Phase 3 also named was actually delivered separately by `plan_metering_audit.md` (`AdminMetricsPage`, `GET /admin/metrics/live`) — Phase 3 is now fully closed. |
| [plan_metering_audit.md](plans/plan_metering_audit.md) | Metering, Prometheus Metrics & Unified Audit Log | DB-first usage rollups (`usage_rollups`, hourly→daily) attributed per project, ffmpeg wall-clock × purpose compute accounting, MediaMTX/Node egress metering, prom-client `/metrics` on backend/orchestrator/worker + Prometheus in compose (no Grafana), unified `audit_log` (write-audit middleware + login events, migrates `admin_audit_log`), Admin metrics/audit views + Team usage tab. |
| [plan_ui.md](plans/plan_ui.md) | Frontend & UI Plans | All planned items implemented: v4 two-phase login, feature-based UI, setup wizard, empty states. |
| [plan_dock_ffmpeg.md](plans/plan_dock_ffmpeg.md) | FFmpeg Compute Containers → Distributed Hetzner Architecture | All phases implemented: `DockerFfmpegRunner` abstraction, Hetzner provisioning, autoscaling. |
| [plan_team_org_backend.md](plans/plan_team_org_backend.md) | Team/Org Data Model — Backend Design | `organizations`/`org_members`/`api_keys.org_id` schema; full org CRUD + membership routes. **Not done:** org admin/owner roles cascading to a higher project-level baseline (deliberately deferred; org membership always flattens to project `member`). |
| [plan_site_feature_policies.md](plans/plan_site_feature_policies.md) | Site Feature Policies — Tri-State Availability Model | Fully implemented: `site_feature_policies`/`org_feature_overrides`; enable/disable/override per org. |
| [plan_profile_team_admin_reconciliation.md](plans/plan_profile_team_admin_reconciliation.md) | Profile, Team & Admin — Claude Design Reconciliation | Reconciles `/team`, `/account`, and admin surfaces; unified page layout. **Not done:** per-category "team defaults" pull-down (deliberately deferred to its own future plan). |
| [plan_pubsub_event_bus.md](plans/plan_pubsub_event_bus.md) | Pub/Sub Event Bus — Unified Internal & External Event Distribution | Implemented: shared `EventBus` in packages; unified internal & external event distribution. |
| [plan_cues.md](plans/plan_cues.md) | Cue Engine Enhanced Capabilities | Phases 1–8 fully implemented: inline cues, modifiers, fuzzy matching, sound detection, semantic/event cues. Phase 8.5 (inline↔backend cue sync gap) was already implemented (`POST /cues/inline`) — this doc had gone stale. Phase 9 (composite trees, reusable named conditions via `/cues/defs`, `track:` tracker-state leaves) fully implemented 2026-07-18 — backend (Lane D, PR #282): `cue_named_conditions` table + CRUD, `cue_rules.condition_tree`, async `CueEngine.evaluateComposite()`/`evaluateCompositeRules()`/`evaluateTrackerEvent()`, cycle-guarded named-condition resolution, write-time cycle rejection on `/cues/defs`; frontend (same day): a multi-line indented composite-block parser grammar (`metacode-parser.js`), `buildCueMap()`/`checkCueMatch()` now correctly skip composite cues, and the `ConditionTreeEditor` component. Phase 10 (cue rules editor) implemented 2026-07-18 and extended the same day to cover composite/track rule types plus a full Named Conditions CRUD section (list/create/edit/delete, `ref`-leaf dropdown, inline-sourced "Detach" action) — a `CuesManager` core reused by the standalone `/cues` page and an embedded "Cues" tab in the Planner's right-column `PlannerAssistPanel` (alongside an "Actions" tab for named actions) above the AI assistant chat. **Not done:** multi-modal scene understanding and the fps30 tracker subsystem itself (both out of scope for this plan / a different subsystem). |
| [plan_server_stt.md](plans/plan_server_stt.md) | Server-side Speech-to-Text (STT) | Phases 1–5 fully implemented: HLS + Google STT, Whisper, OpenAI providers, RTMP/WHEP fallback, gRPC. **Not done:** live-operate-surface source-language quick-toggle (outside Setup Hub) — AudioPanel's browser-STT selector now reads the shared source-language list. |
| [plan_music.md](plans/plan_music.md) | Music Detection Plugin (`lcyt-music`) | Phases 1–3 fully implemented: client-side + server-side music/speech/silence classification with BPM detection. **Not done:** Phase 4 (tuning/export). |
| [plan_agent.md](plans/plan_agent.md) | AI Agent Capabilities (`lcyt-agent`) | Phases 1–6 fully implemented: AI config, embeddings, context window, event cue evaluation, DSK/rundown generation. **Not done:** Phase 7 (multi-modal scene understanding) still planned; Phases 4 and 8 superseded by plan_ai_roles_framework and plan_ai_model_registry respectively. |
| [plan_mcp.md](plans/plan_mcp.md) | MCP Tools for lcyt | Implemented: shared tool-schema module, in-process MCP bridge, `mcp_tokens` table + routes, external-facing `POST /mcp` endpoint in lcyt-backend, and the Setup Hub MCP access card. |
| [plan_dsk_viewport_settings.md](plans/plan_dsk_viewport_settings.md) | DSK Viewports v2 — Slug URLs, Display Settings, Multi-Renderer | Phases 1–5 fully implemented: project slugs, viewport settings, multi-renderer streams, chromakey. **Not done (follow-ups):** slug migration for `/video`/`/radio`/`/preview`/viewer embeds/Android TV links, per-device display settings via device roles, URL/iframe template layer type. |
| [plan_translations.md](plans/plan_translations.md) | Caption Translation Pipeline | Client-side real-time translation: MyMemory, Google, DeepL, LibreTranslate vendor abstraction. |
| [plan_api_connectors_variables.md](plans/plan_api_connectors_variables.md) | API Connectors & Variables — {{ }} Bindings and Metacode-Triggered Refresh | Fully implemented: `lcyt-connectors` plugin (schema, CRUD, resolution engine, SSE), `!api:`/`api:`/`api!:` metacodes, `{{ }}` insertion, and the Setup Hub Connectors card (connector/request/mapping/variable management UI). |
| [plan_help.md](plans/plan_help.md) | Help Page Screenshot Capture | Implemented: `scripts/screenshots/capture.mjs` (`npm run screenshots`) captures dark+light shots of the lcyt-web views into `docs/screenshots/` and `packages/lcyt-site/public/screenshots/`. |
| [plan_viewer_icons.md](plans/plan_viewer_icons.md) | Viewer Icon Toggle + Icons Setup-Hub Card | Implemented: `caption_targets.icon_id`/`icon_enabled` server persistence, TargetRow icon toggle + picker, Setup Hub Icons card (`IconsSection.jsx`). |
| [TODO_plan.md](plans/TODO_plan.md) | Implement TODO.md items | Implemented: Python `logger.py` with `set_use_stderr`, MCP `get_status` auto-sync, MCP `time` field, docs moved to `docs/`. |
| [plan_unified_external_control.md](plans/plan_unified_external_control.md) | Unified External Control & Automation (umbrella) | Implemented (Phases 1–3): event bus, shared tool registry, token scope model, and MCP integration shipped. |
| [plan_named_actions.md](plans/plan_named_actions.md) | Named Actions — @name Composite Action Macros | Implemented: `lcyt-actions` plugin (`action_defs` table, `/actions` CRUD), `metacode-actions.js` parse/expand/apply. `NamedActionsManager` editor was built early but never mounted anywhere; rebuilt 2026-07-18 to match the Cues editor's Dialog/SetupItemRow pattern and mounted at the standalone `/actions` page (linked from the Assets "Global actions" card) and embedded as the Planner right-column's "Actions" tab. |
| [plan_broadcasts.md](plans/plan_broadcasts.md) | Broadcasts — First-Class Intra-Project Broadcast Entity | Implemented (v1): `broadcasts` schema + CRUD routes, `broadcast_assets`/`broadcast_files` linkage, session binding, duplication, archive-then-delete, BroadcastsManager UI. **Not done:** YouTube two-way sync (data hooks only), recurrence/RRULE, automated pre-broadcast asset checks — all explicitly out of scope for v1. |
| [plan_broadcasts_next.md](plans/plan_broadcasts_next.md) | Activatable Broadcast + Unified Planner File-Management Panel | Implemented: `api_keys.active_broadcast_id` pointer surfaced via project JWT, `useActiveBroadcast`, Planner broadcast file panel, DSK broadcast asset panel, production header broadcast status controls. |
| [plan_assets_page.md](plans/plan_assets_page.md) | Assets Page — Content Library of Project Assets | Implemented: `/assets` content library (Graphics, Global cues, Global actions, Icons, Caption files, Broadcasts, Stored videos cards). |
| [plan_recording_vod.md](plans/plan_recording_vod.md) | Recording & VOD Pipeline — Stored Videos from Broadcasts | Implemented (phase 1): opt-in `record_enabled` per broadcast, MediaMTX native record → HLS VOD on S3/local, `videos` table + playback routes. **Not done:** phase 2 — the worker-daemon ffmpeg recorder alternative behind the swappable recorder interface. |
| [plan_web_ui_event_stream_consolidation.md](plans/plan_web_ui_event_stream_consolidation.md) | Consolidate the Operator Web UI onto one `/events/stream` | Implemented (Phase A): `?flat=1` delivery mode, shared `useEventStream` hook, `useVariables`/roles panels migrated, bespoke authed SSE endpoints retired. **Not done:** optional Phase B — folding the caption session `/events` stream (embed pages still consume it) and `/stt/events`. |
| [plan_metacode_variable_unification.md](plans/plan_metacode_variable_unification.md) | Metacode ↔ Variable Unification — One Namespace, Reserved-Name Registry | Core implemented: reserved-name registry dispatch (`metacode-registry.js`), unified variable namespace (`metacode-variables.js`), per-assignment TTL/expiry (`metacode-ttl.js`). **Not done:** the speculative live-refresh/display/text-block behaviours, split out into `plan_live_variables.md` (draft). |
| [plan_metacode_refactor.md](plans/plan_metacode_refactor.md) | Metacode Refactor Plan | Implemented: scattered metacode handling relocated into dedicated `metacode-*.js` modules (parser, registry, runtime, planner, active-codes, actions, variables, ttl). |

### In progress

| File | Title | Summary |
|---|---|---|
| [plan_ai_roles_framework.md](plans/plan_ai_roles_framework.md) | AI Roles Framework — Model + Harness Selection | Extensible `ai_roles` registry + `project_ai_role_configs` for Tracker/Describer/Setup/Asset/Planner roles. `AgentChatPanel` frontend shipped; bridge-relayed provider support for agentic_chat/vision is done (turn loop + all three vision adapters). Translation role remains (still just a flagged future gap, not spec'd). |
| [plan_ai_model_registry.md](plans/plan_ai_model_registry.md) | AI Model Registry — Site & Project Provider Catalog, Ollama Auto-Discovery | `ai_providers`/`ai_provider_models`/`ai_provider_grants`; bridge-relayed inference; Docker deployment. Phase 3 backend (bridge-relayed inference for agentic_chat/vision) done; its role-config model-picker UI (`lcyt-web`) still isn't wired up. Phase 4 ("deer" runtimes) unscoped. |
| [plan_vertical_crop.md](plans/plan_vertical_crop.md) | Vertical Crop Output — Live-Repositionable Landscape→Portrait Crop | Phases 1–3 implemented (schema, CropManager + {key}-crop path, /crop routes, relay sourceView, zmq live reposition with restart fallback, `/production/crop` operator UI — draggable WYSIWYG preset editor, preset-set tabs, camera/PTZ-preset source binding, vertical monitor tile); production-follow (Phase 4) and ops/polish (Phase 5) remain. |

### Pending

| File | Title | Summary |
|---|---|---|

### Draft

| File | Title | Summary |
|---|---|---|
| [plan_translate.md](plans/plan_translate.md) | Server-Side Translation Plugin (`lcyt-translate`) | Exploratory, not yet scheduled: server-side translation to close STT and CLI translation gap. |
| [plan_live_variables.md](plans/plan_live_variables.md) | Live Variables — Continuous Refresh, Live Operator Display, Text-Block Expansion | Forward-looking variable behaviours: live refresh, operator display, dynamic text expansion. |
| [plan_monitors.md](plans/plan_monitors.md) | Monitors — Confidence-Only Ingestion for Visual Monitoring | Push/pull-ingested feeds shown purely for visual monitoring (e.g., confidence scores). |
| [plan_mixer_feed_sources.md](plans/plan_mixer_feed_sources.md) | Mixer Feed Sources — Encoder & File Sources, Low-Latency Preview Tiles | Generalizes software mixer program bus beyond video to include encoder/file sources. |
| [plan_postgres_option.md](plans/plan_postgres_option.md) | PostgreSQL as an Optional Backend | Adds PostgreSQL as optional backend for Node.js backend and plugin-owned DB layers. |

### Reference

| File | Title | Summary |
|---|---|---|
| [ROADMAP.md](plans/ROADMAP.md) | Roadmap — Way Forward | Prioritised ordering across every plan above: what to work next, and which pieces can run in parallel across simultaneous agents without file/package collisions. Re-derive from this index rather than trusting it blindly — it decays as work lands. |
| [plan_mcp_oauth.md](plans/plan_mcp_oauth.md) | OAuth Authorization Server for MCP (Deferred) | Deferred-by-design reference design: LCYT as OAuth 2.1 authorization server for hosted MCP clients. **Nothing built** — `mcp_tokens` covers the near-term audience; do not build until a hosted-client integration is actually requested. |
| [PR_phase6-7_hetzner.md](plans/PR_phase6-7_hetzner.md) | PR: Phase 6–7 Hetzner provisioning and autoscaling scaffolding | PR artifact for `plan/dock-ffmpeg`: Hetzner provisioning + autoscaling. |
| [plan_backend_split.md](plans/plan_backend_split.md) | lcyt-backend Modularization & Plugin Extraction Assessment | Structural analysis: plugin extraction complete (lcyt-rtmp, lcyt-dsk, lcyt-agent, lcyt-music, lcyt-cues). |
| [plan_dock_ffmpeg.md.old](plans/plan_dock_ffmpeg.md.old) | (Archived) FFmpeg Plan — Old Version | Superseded 2026-03-20; see current `plan_dock_ffmpeg.md` instead. |
