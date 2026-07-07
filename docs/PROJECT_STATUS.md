# LCYT Project Status

*Compiled 2026-06-30. Sources: `docs/PLANS.md`, `docs/plans/*.md`, `TODO.md`, package.json versions, and a repo-wide grep for TODO/FIXME/WIP/stub markers.*

This is a point-in-time snapshot, not a maintained changelog. The repo has no `CHANGELOG.md`, `HISTORY.md`, or git tags — `docs/PLANS.md` (summarized below) is the closest thing to a living project history, alongside git log itself.

---

## 1. Plan Index (from `docs/PLANS.md`)

27 plans total: 21 implemented, 4 in-progress, 1 pending, 1 draft, 2 reference artifacts.

### Implemented (21)

| Plan | Title | Notes |
|---|---|---|
| plan_sync | YouTube Heartbeat Sync | NTP-style clock sync for `YoutubeLiveCaptionSender` |
| plan_backend | lcyt-backend Express Relay | JWT auth, SQLite, multi-user sessions, admin CLI |
| plan_client | Web GUI Client (lcyt-web) | Full React SPA |
| plan_mcp | MCP Tools | stdio + SSE transports |
| plan_hls_sidecar | HLS Multilingual Caption Sidecar | WebVTT rolling segments + HLS.js player |
| plan_mediamtx | MediaMTX Integration | Alternative RTMP/HLS broker, NginxManager |
| plan_prod | Production Control | Cameras, mixers, bridge agent, MCP tools |
| plan_rtmp | RTMP Processing Pipeline | ffmpeg orchestration for HLS/relay/DSK/thumbnails |
| plan_stt | Browser STT Integration | Web Speech API + Google Cloud STT, VAD, translation |
| plan_captions | Caption Sending Pipeline | Target fan-out, sequencing, SSE results |
| plan_translations | Caption Translation Pipeline | Vendor abstraction, multi-target, subtitle sidecar |
| plan_cea | CEA-708 SEI NAL Embedding | eia608 encoder + SRT pipe in RtmpRelayManager |
| plan_pyback | Python Backend Scope Reduction | Minimal unauthenticated relay |
| plan_cache | HTTP Caching Strategy | Cache-Control tiers, nginx proxy_cache, ETag |
| plan_setup_wizard | Setup Wizard | `/setup` guided flow, fully implemented |
| plan_userprojects | Feature Flags, Membership, Device Roles | Phases 1-3 done; Phase 4 (QR codes, tally light, time-limited sessions) future work |
| plan_cloudfleet | Hosting Modes & Cloudfleet Deployment | All 3 tiers done; optional Helm/Litestream/Postgres/ServiceMonitor pending |
| plan_dsk | DSK Graphics Editor (Phases 2-5) | Canvas editing, multi-select, media library, entry/exit animations — all complete |
| plan_files3 | lcyt-files Storage Adapters | local/S3/WebDAV done; CDN URL field, S3 mock tests, migration script remain low-priority |
| plan_admin | Admin Panel | Phases 1-2 done: CRUD, audit log, import/export |
| plan_ui | Frontend & UI Plans | All backlog items done (command palette, shortcuts, reconnect, etc.) |
| plan_dock_ffmpeg | FFmpeg Compute Containers → Distributed Hetzner Architecture | All phases done. Phases 1-3: runner abstraction (`FFMPEG_RUNNER`); Phases 4-7: `lcyt-orchestrator` (worker registry, job routing, Hetzner client, autoscaler, Prometheus metrics) + `lcyt-worker-daemon` (job lifecycle, Docker execution, S3 uploader) fully wired, including caption forwarding (`POST /compute/jobs/:jobId/caption`). See `docs/distributed-compute.md`. |

### In Progress (4, + TODO follow-through)

| Plan | Done | Remaining |
|---|---|---|
| plan_cues (Cue Engine) | Phases 1-7: phrase/fuzzy/semantic/event cues, music-state triggers; compact inline cue syntax, composite/context evaluation, and inline cue sync are now implemented | Phase 9: multi-modal scene understanding |
| plan_agent (AI Agent) | Phases 1-3, 5-6: config, embeddings, context window, event-cue LLM eval, AI template/rundown generation | Phase 4: video/image inference (`analyseImage()` is a stub — see §3); Phase 7: multi-modal scene understanding; Phase 8: local Ollama support |
| plan_server_stt (Server-side STT) | Phase 1: HlsSegmentFetcher, Google/Whisper/OpenAI adapters, SttManager, `/stt` routes | Phases 2-4: gRPC streaming hardening, RTMP/WHEP fallback enhancements |
| plan_music (Music Detection) | Phases 1-3: client-side Web Audio API path, server-side HLS analysis, `music_config` DB table + routes, RTMP audio-source fallback | Phase 4: tuning/export/external classifier; `on_publish` auto-start hook for `music_config.autoStart` not yet wired |
| TODO_plan | — | Resolve TODO.md items (see §2) |

### Pending (1)

- **plan_help** — Help Page Screenshot Capture: programmatic Playwright screenshots of lcyt-web UI views for the help page. Accepted, not started.

### Draft (1)

- **plan_translate** — `lcyt-translate`: exploratory server-side translation plugin (vendor adapters, per-key DB config, injection into captions.js/SttManager) to close the gap where translation currently only happens client-side. Not yet accepted/scheduled.

### Reference (2)

- **PR_phase6-7_hetzner** — PR artifact for plan_dock_ffmpeg phases 6-7 (Hetzner provisioning, snapshot boot, autoscaling scaffolding, operator runbook).
- **plan_backend_split** — Structural assessment: plugin extraction (lcyt-rtmp, lcyt-dsk, lcyt-production, lcyt-files) complete; lcyt-translate proposal remains exploratory.

---

## 2. `TODO.md` Contents

The entire file, verbatim:

> Timestamp parsing relies on ISO strings without trailing `Z` — behavior is consistent across Node versions but keep tests for edge cases.

A single note, not an outstanding work item — more of a documented design constraint. `plan_TODO_plan.md` references resolving "Python stderr logging, MCP auto-sync and time field, docs reorganisation, CLAUDE.md lcyt-mcp reference" — these appear to already be addressed given CLAUDE.md's current state; no further open items found in TODO.md itself.

---

## 3. Grep Findings: TODO / FIXME / WIP / stub / "not implemented"

A repo-wide case-insensitive grep across `packages/`, `python-packages/`, `android/` (excluding `node_modules`, `dist`, `build`) turned up ~30 hits. The large majority are test-file vocabulary ("stub DB", "stub fetch", "AnalyserNode stub") describing test mocks, not unfinished product code. Hits that represent **real gaps**:

| File | Marker | What it means |
|---|---|---|
| `packages/plugins/lcyt-agent/src/agent-engine.js:181` | `// Stub — requires vision-capable LLM integration (Phase 6)` | `analyseImage()` is a placeholder; this is plan_agent Phase 4/7 (video/image inference) |
| `packages/plugins/lcyt-production/src/adapters/mixer/obs.js:29-31, 141` | "routing for OBS is not implemented in the current bridge agent" | The OBS mixer adapter returns a forward-compatible `obs_switch` object, but `lcyt-bridge` doesn't yet dispatch it — switching doesn't actually reach OBS yet |
| `packages/plugins/lcyt-files/src/routes/files.js:57` | "Defensive fallback... adapter-less stub that returns 503" | Intentional safety fallback, not a gap |
| `packages/lcyt-backend/test/integration/dsk-integration.test.js:3-5` | `test.skip(...)`, "TODO: implement" | DSK Playwright/Chromium integration test is a scaffolded placeholder, skipped |
| `packages/lcyt-backend/test/integration/stt-integration.test.js:3-6` | `test.skip(...)`, "TODO: implement" | Real STT integration test (needs HLS/ffmpeg/MediaMTX) not yet written, skipped |
| `packages/lcyt-web/src/main.jsx:138-147` | `StubPage` component | Defined as scaffolding for "routes not yet fully implemented" but **not actually referenced anywhere** in the router — dead code, not an active gap |

Everything else (the bulk of matches) is test-mock terminology and not indicative of incomplete features.

---

## 4. Package Maturity Signals (`package.json` versions)

| Package | Version | Signal |
|---|---|---|
| `packages/lcyt` | 3.0.0 | Mature, published, stable API |
| `packages/lcyt-cli` | 2.0.0 | Mature, published |
| `packages/lcyt-backend` | 1.0.0 | Stable, production-tagged |
| `packages/lcyt-web` | 1.0.0 | Stable |
| `packages/lcyt-bridge` | 0.3.0 | Functional but pre-1.0 |
| `packages/lcyt-mcp-stdio` | 0.1.0 | Stable but early |
| `packages/lcyt-mcp-http` | 0.1.0 | Stable but early |
| `packages/lcyt-site` | 0.1.0 | Early (marketing site) |
| `packages/lcyt-orchestrator` | 0.0.1 (private) | Functionally wired (worker registry, job dispatch, caption forwarding, Hetzner autoscaling) but version number not yet bumped past scaffold-era `0.0.x` |
| `packages/lcyt-worker-daemon` | 0.0.0 (private) | Same — functional, version number stale |
| `packages/plugins/*` (cues, production, rtmp, dsk, music, files, agent) | 0.1.0 each | Stable internal plugins, not independently versioned/released |

The orchestrator and worker-daemon's `0.0.x` versions are now a lag indicator, not a maturity signal — plan_dock_ffmpeg Phases 4-7 shipped in PR #221 (see `docs/distributed-compute.md`), but the package versions weren't bumped to reflect it.

---

## 5. Where to Continue Next (prioritized)

1. **OBS mixer dispatch in lcyt-bridge** — the adapter is ready (`adapters/mixer/obs.js`) but the bridge agent doesn't yet send `obs_switch` commands; small, well-scoped fix if OBS support matters to current use cases.
2. **STT provider hardening** (plan_server_stt Phases 2-4) — gRPC streaming polish and RTMP/WHEP fallback; REST/HLS path already works.
3. **Server-side music detection tuning** (plan_music Phase 4) — tuning/export/external classifier, plus wiring the `on_publish` auto-start hook for `music_config.autoStart`. Phases 1-3 (client-side, server-side HLS analysis, RTMP fallback) are done.
4. **AI Agent vision/image inference** (plan_agent Phase 4) — replace the `analyseImage()` stub with a real vision-capable LLM call.
5. **Write the two skipped integration tests** (`dsk-integration.test.js`, `stt-integration.test.js`) once Playwright/Chromium and HLS/ffmpeg/MediaMTX test infra is available — currently `test.skip`.
6. **Prove out Hetzner burst autoscaling end-to-end** — the orchestrator/worker-daemon path is wired (job dispatch, caption forwarding, S3 upload) but real-world burst-provisioning under load remains unproven; bump `lcyt-orchestrator`/`lcyt-worker-daemon` package versions once it is.
7. Lower priority / polish: plan_help (screenshot capture for the help page), plan_userprojects Phase 4 (QR codes, tally light, time-limited sessions), plan_cloudfleet optional enhancements (Helm chart, Litestream, Postgres, ServiceMonitor, CI CFCR push).
8. **plan_translate** remains in draft — worth a decision on whether to formally schedule it (closes the gap where STT/CLI captions can't be server-side translated) or shelve it.

**Recommended starting point:** item 1 (OBS mixer dispatch) — smallest, most concretely scoped, no dependencies.
