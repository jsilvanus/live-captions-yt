# LCYT Documentation Index

Welcome to the LCYT documentation. This is your navigation hub for all guides, API references, and architectural documentation.

## 📚 Start Here

**New to LCYT?** Start with these quick-start guides:

- [**README.md**](../README.md) — Project overview, packages table, quick start
- [**CLAUDE.md**](../CLAUDE.md) — Complete codebase reference (1500+ lines, detailed)
- [**Getting Started Guide**](./guide-web/getting-started.md) — Step-by-step setup

## 🚀 User Guides

### CLI Usage
- [Full-screen mode](./guide-cli/full-screen.md) — Rich TUI with blessed
- [Interactive mode](./guide-cli/interactive.md) — Line-by-line caption entry
- [Single caption](./guide-cli/single-caption.md) — Quick one-off sending

### Web UI
- [Overview](./guide-web/overview.md) — Web app layout and navigation
- [Sending captions](./guide-web/sending-captions.md) — How to send captions
- [Caption settings](./guide-web/caption-settings.md) — Formatting options
- [General settings](./guide-web/general-settings.md) — App configuration
- [Translation](./guide-web/translation.md) — Multi-language captions
- [Video player](./guide-web/video-player.md) — HLS viewer
- [Embed widgets](./guide-web/embed.md) — Embeddable iframe widgets
- [Minimal backend](./guide-web/minimal-backend.md) — Lightweight setup
- [Status & actions](./guide-web/status-actions.md) — Quick status bar
- [Keyboard shortcuts](./guide-web/keyboard-shortcuts.md) — Key bindings
- [Flow diagram](./guide-web/flow.md) — Architecture visualization

## 🔧 Installation & Deployment

- [**DEPLOY.md**](./DEPLOY.md) — Production deployment checklist
- [**FIREWALL.md**](./FIREWALL.md) — Network and firewall setup
- [**DB.md**](./DB.md) — Database schema and migrations
- [**PORTS.md**](../PORTS.md) — Port assignment reference
- [**TODO.md**](../TODO.md) — Outstanding work items
- [**env-vars.md**](./env-vars.md) — Complete environment variable reference
- [**docker-compose setup**](./compose_orchestrator.md) — Orchestrator deployment

### Platform-Specific
- [Hetzner snapshot setup](./hetzner_snapshot.md) — VM image preparation
- [Hetzner operations runbook](./hetzner_runbook.md) — Maintenance guide
- [ffmpeg Docker usage](./ffmpeg-docker-usage.md) — FFmpeg container guide

## 📖 API Reference

**API documentation by endpoint** — Full reference in [docs/api/](./api/):

| Category | Docs |
|----------|------|
| **Sessions** | [sessions.md](./api/sessions.md), [sync.md](./api/sync.md) |
| **Captions** | [captions.md](./api/captions.md), [events.md](./api/events.md) |
| **Files** | [files.md](./api/files.md), [usage.md](./api/usage.md), [stats.md](./api/stats.md) |
| **Streaming** | [stream.md](./api/stream.md), [stream-hls.md](./api/stream-hls.md), [radio.md](./api/radio.md) |
| **Viewer** | [viewer.md](./api/viewer.md), [video.md](./api/video.md), [preview.md](./api/preview.md) |
| **Graphics** | [dsk.md](./api/dsk.md), [images.md](./api/images.md) |
| **Production** | [production.md](./api/production.md) *(see plan)* |
| **Keys & Auth** | [keys.md](./api/keys.md) |
| **Server** | [health.md](./api/health.md), [contact.md](./api/contact.md), [youtube.md](./api/youtube.md) |
| **Misc** | [mic.md](./api/mic.md), [icons.md](./api/icons.md), [rtmp-callbacks.md](./api/rtmp-callbacks.md) |

**Quick reference:** [API README](./api/README.md)

## 📚 Library Documentation

### Node.js/JavaScript

Core library docs in [docs/lib/](./lib/):
- [sender.md](./lib/sender.md) — YoutubeLiveCaptionSender class
- [backend-sender.md](./lib/backend-sender.md) — BackendCaptionSender relay client
- [config.md](./lib/config.md) — Configuration management
- [errors.md](./lib/errors.md) — Error types
- [logger.md](./lib/logger.md) — Logging utilities
- [README](./lib/README.md) — Full library index

**Packages:**
- [`lcyt` npm package](../packages/lcyt/README.md) — Core library
- [`lcyt-cli` npm package](../packages/lcyt-cli/README.md) — CLI tool

### Python

Python library docs in [docs/lib/python/](./lib/python/):
- [sender.md](./lib/python/sender.md) — YoutubeLiveCaptionSender class
- [backend-sender.md](./lib/python/backend-sender.md) — Relay client
- [config.md](./lib/python/config.md) — Configuration
- [errors.md](./lib/python/errors.md) — Error types
- [README](./lib/python/README.md) — Full library index

**Packages:**
- [lcyt PyPI package](../python-packages/lcyt/README.md) — Core library
- [lcyt-backend package](../python-packages/lcyt-backend/README.md) — Flask backend

## 🤖 AI & MCP Integration

MCP (Model Context Protocol) documentation in [docs/mcp/](./mcp/):

- [MCP overview](./mcp/README.md) — What is MCP?
- [Stdio transport](./mcp/stdio.md) — Local process invocation
- [SSE transport](./mcp/sse.md) — HTTP Server-Sent Events
- [All tools reference](./mcp/tools.md) — Complete tool listing
- [Individual tool docs](./mcp/tools/) — Per-tool details
  - [start.md](./mcp/tools/start.md)
  - [send-caption.md](./mcp/tools/send-caption.md)
  - [send-batch.md](./mcp/tools/send-batch.md)
  - [sync-clock.md](./mcp/tools/sync-clock.md)
  - [get-status.md](./mcp/tools/get-status.md)
  - [privacy.md](./mcp/tools/privacy.md)
  - [privacy-deletion.md](./mcp/tools/privacy-deletion.md)

**Packages:**
- [lcyt-mcp-stdio](../packages/lcyt-mcp-stdio/README.md) — Stdio server
- [lcyt-mcp-sse](../packages/lcyt-mcp-sse/README.md) — SSE server
- [lcyt-mcp (Python)](../python-packages/lcyt-mcp/README.md) — Python server

## 🏗️ Architecture & Planning

### Implementation Plans

All plans in [docs/plans/](./plans/) — See [PLANS.md](./PLANS.md) for full index:

**Core Features:**
- [plan_admin.md](./plans/plan_admin.md) — Admin panel (users, projects)
- [plan_backend.md](./plans/plan_backend.md) — Backend architecture
- [plan_captions.md](./plans/plan_captions.md) — Caption system
- [plan_cea.md](./plans/plan_cea.md) — CEA-608/708 encoding
- [plan_client.md](./plans/plan_client.md) — Web UI architecture
- [plan_ui.md](./plans/plan_ui.md) — UI layout and design

**Advanced Features:**
- [plan_agent.md](./plans/plan_agent.md) — AI agent plugin
- [plan_cues.md](./plans/plan_cues.md) — Cue engine plugin
- [plan_dsk.md](./plans/plan_dsk.md) — DSK graphics overlays
- [plan_files3.md](./plans/plan_files3.md) — S3 file storage
- [plan_hls_sidecar.md](./plans/plan_hls_sidecar.md) — HLS subtitle sidecars
- [plan_mcp.md](./plans/plan_mcp.md) — MCP integration
- [plan_music.md](./plans/plan_music.md) — Music detection plugin
- [plan_prod.md](./plans/plan_prod.md) — Production control
- [plan_rtmp.md](./plans/plan_rtmp.md) — RTMP relay
- [plan_server_stt.md](./plans/plan_server_stt.md) — Server-side STT
- [plan_setup_wizard.md](./plans/plan_setup_wizard.md) — Onboarding
- [plan_sync.md](./plans/plan_sync.md) — NTP clock sync
- [plan_translate.md](./plans/plan_translate.md) — Translation system
- [plan_translations.md](./plans/plan_translations.md) — i18n implementation
- [plan_userprojects.md](./plans/plan_userprojects.md) — User accounts & projects

**Infrastructure:**
- [plan_backend_split.md](./plans/plan_backend_split.md) — Microservices split
- [plan_cache.md](./plans/plan_cache.md) — Caching strategy
- [plan_cloudfleet.md](./plans/plan_cloudfleet.md) — Kubernetes deployment
- [plan_dock_ffmpeg.md](./plans/plan_dock_ffmpeg.md) — Docker ffmpeg runner
- [plan_mediamtx.md](./plans/plan_mediamtx.md) — MediaMTX integration
- [plan_metacode_refactor.md](./plans/plan_metacode_refactor.md) — Metacode system refactor

### System Documentation

- [**METACODE.md**](./METACODE.md) — Caption metadata system (graphics, cues, sound)
- [**GUIDE.md**](./GUIDE.md) — General user guide reference

## 📦 Package & Plugin Documentation

### Main Packages

| Package | README |
|---------|--------|
| **lcyt** | [packages/lcyt/README.md](../packages/lcyt/README.md) |
| **lcyt-cli** | [packages/lcyt-cli/README.md](../packages/lcyt-cli/README.md) |
| **lcyt-backend** | [packages/lcyt-backend/README.md](../packages/lcyt-backend/README.md) |
| **lcyt-web** | [packages/lcyt-web/README.md](../packages/lcyt-web/README.md) |
| **lcyt-bridge** | [packages/lcyt-bridge/README.md](../packages/lcyt-bridge/README.md) |
| **lcyt-orchestrator** | [packages/lcyt-orchestrator/README.md](../packages/lcyt-orchestrator/README.md) |
| **lcyt-site** | [packages/lcyt-site/README.md](../packages/lcyt-site/README.md) |
| **lcyt-mcp-stdio** | [packages/lcyt-mcp-stdio/README.md](../packages/lcyt-mcp-stdio/README.md) |
| **lcyt-mcp-sse** | [packages/lcyt-mcp-sse/README.md](../packages/lcyt-mcp-sse/README.md) |
| **lcyt-worker-daemon** | [packages/lcyt-worker-daemon/README.md](../packages/lcyt-worker-daemon/README.md) |

### Plugin Packages

| Plugin | README | Purpose |
|--------|--------|---------|
| **lcyt-agent** | [packages/plugins/lcyt-agent/README.md](../packages/plugins/lcyt-agent/README.md) | AI config, embeddings, LLM |
| **lcyt-cues** | [packages/plugins/lcyt-cues/README.md](../packages/plugins/lcyt-cues/README.md) | Cue engine (phrase/fuzzy/semantic matching) |
| **lcyt-dsk** | [packages/plugins/lcyt-dsk/README.md](../packages/plugins/lcyt-dsk/README.md) | DSK graphics overlays |
| **lcyt-files** | [packages/plugins/lcyt-files/README.md](../packages/plugins/lcyt-files/README.md) | File storage (local/S3/WebDAV) |
| **lcyt-music** | [packages/plugins/lcyt-music/README.md](../packages/plugins/lcyt-music/README.md) | Audio classification & BPM |
| **lcyt-production** | [packages/plugins/lcyt-production/README.md](../packages/plugins/lcyt-production/README.md) | Camera & mixer control |
| **lcyt-rtmp** | [packages/plugins/lcyt-rtmp/README.md](../packages/plugins/lcyt-rtmp/README.md) | RTMP relay, HLS, radio, STT |

### Python Packages

| Package | README |
|---------|--------|
| **lcyt** | [python-packages/lcyt/README.md](../python-packages/lcyt/README.md) |
| **lcyt-backend** | [python-packages/lcyt-backend/README.md](../python-packages/lcyt-backend/README.md) |
| **lcyt-mcp** | [python-packages/lcyt-mcp/README.md](../python-packages/lcyt-mcp/README.md) |

### Tools & Infrastructure

| Package | README |
|---------|--------|
| **tcp-echo-server** | [packages/tools/tcp-echo-server/README.md](../packages/tools/tcp-echo-server/README.md) |
| **lcyt-ffmpeg Docker** | [docker/lcyt-ffmpeg/README.md](../docker/lcyt-ffmpeg/README.md) |
| **lcyt-dsk-renderer Docker** | [docker/lcyt-dsk-renderer/README.md](../docker/lcyt-dsk-renderer/README.md) |
| **Kubernetes CloudFleet** | [k8s/cloudfleet/README.md](../k8s/cloudfleet/README.md) |

## 📝 File Organization

```
docs/
├── INDEX.md                    ← YOU ARE HERE
├── PLANS.md                    ← Plan index with status
├── GUIDE.md                    ← User guide index
├── DB.md                       ← Database schema
├── DEPLOY.md                   ← Deployment guide
├── FIREWALL.md                 ← Network setup
├── METACODE.md                 ← Metacode system
├── env-vars.md                 ← Environment variables
├── ffmpeg-docker-usage.md      ← Docker ffmpeg
├── compose_orchestrator.md     ← Orchestrator compose
├── hetzner_snapshot.md         ← VM preparation
├── hetzner_runbook.md          ← Operations runbook
│
├── api/                        ← API endpoint docs
│   ├── README.md
│   ├── sessions.md, captions.md, events.md
│   ├── files.md, usage.md, stats.md
│   ├── stream.md, stream-hls.md, radio.md
│   ├── viewer.md, video.md, preview.md
│   ├── dsk.md, images.md, icons.md
│   └── [20+ more endpoint docs]
│
├── lib/                        ← JavaScript/Node.js library docs
│   ├── README.md
│   ├── sender.md, backend-sender.md, config.md
│   ├── errors.md, logger.md
│   └── python/                 ← Python library docs
│       ├── README.md
│       └── [similar structure]
│
├── guide-cli/                  ← CLI usage guides
│   ├── full-screen.md
│   ├── interactive.md
│   └── single-caption.md
│
├── guide-web/                  ← Web UI guides
│   ├── getting-started.md
│   ├── overview.md
│   ├── sending-captions.md
│   ├── settings/
│   ├── features/ (translate, video, embed, etc.)
│   └── [13+ guide files]
│
├── mcp/                        ← MCP integration docs
│   ├── README.md
│   ├── stdio.md, sse.md
│   ├── tools.md
│   └── tools/                  ← Individual tool docs
│
├── plans/                      ← Implementation plans
│   ├── [31+ plan_*.md files]
│   ├── PR_phase6-7_hetzner.md
│   └── TODO_plan.md
│
└── todo_*.md                   ← Legacy TODO files
```

## 🔍 Quick Navigation

### By Role

**End User / Operator:**
- Start: [Getting Started](./guide-web/getting-started.md)
- Send captions: [Sending Captions](./guide-web/sending-captions.md)
- Setup: [General Settings](./guide-web/general-settings.md)

**Developer / System Administrator:**
- Setup: [DEPLOY.md](./DEPLOY.md) and [FIREWALL.md](./FIREWALL.md)
- API: [API Reference](./api/)
- Architecture: [CLAUDE.md](../CLAUDE.md)

**API Integration:**
- Node.js: [lcyt docs](./lib/)
- Python: [lcyt docs](./lib/python/)
- REST: [API Reference](./api/)

**AI Integration:**
- MCP: [MCP docs](./mcp/)
- Setup: [MCP overview](./mcp/README.md)

### By Feature

- **Captions:** [Sending](./guide-web/sending-captions.md), [API](./api/captions.md), [Format](./lib/sender.md)
- **Streaming:** [RTMP](./plans/plan_rtmp.md), [HLS](./api/video.md), [STT](./plans/plan_server_stt.md)
- **Graphics:** [DSK](./plans/plan_dsk.md), [Metacodes](./METACODE.md)
- **Production:** [Control](./plans/plan_prod.md), [Bridge agent](../packages/lcyt-bridge/README.md)
- **Translation:** [System](./plans/plan_translations.md), [Guide](./guide-web/translation.md)
- **AI:** [Agent](./plans/plan_agent.md), [MCP](./mcp/)

## 🆘 Getting Help

1. **Read the relevant guide** for your use case (from "By Role" above)
2. **Check implementation plans** in [docs/plans/](./plans/) for deep dives
3. **Search CLAUDE.md** for architectural details
4. **Review API docs** for endpoint specifics
5. **Check package READMEs** for library/component usage

## 📊 Documentation Status

| Category | Files | Status | Last Updated |
|----------|-------|--------|--------------|
| Root docs | 16 | ✅ Complete | 2026-06-26 |
| API docs | 22 | ✅ Complete | 2026-06-26 |
| User guides | 16 | ✅ Complete | 2026-06-26 |
| Library docs | 8 | ✅ Complete | 2026-06-26 |
| MCP docs | 16 | ✅ Complete | 2026-06-26 |
| Plans | 31 | ✅ Complete | 2026-06-26 |
| Package READMEs | 20 | ✅ Complete | 2026-06-26 |
| Plugin READMEs | 7 | ✅ Complete | 2026-06-26 |

---

**Last updated:** 2026-06-26  
**Total documentation files:** 170+  
**Navigation:** Use this index to find what you need, then drill down to specific docs.
