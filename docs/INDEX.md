# LCYT Documentation Index

Welcome to the LCYT documentation. This is your navigation hub for all guides, API references, and architectural documentation.

## ðŸ“š Start Here

**New to LCYT?** Start with these quick-start guides:

- [**README.md**](../README.md) â€” Project overview, packages table, quick start
- [**CLAUDE.md**](../CLAUDE.md) â€” Complete codebase reference (1500+ lines, detailed)
- [**Getting Started Guide**](./guide-web/getting-started.md) â€” Step-by-step setup

## ðŸš€ User Guides

### CLI Usage
- [Full-screen mode](./guide-cli/full-screen.md) â€” Rich TUI with blessed
- [Interactive mode](./guide-cli/interactive.md) â€” Line-by-line caption entry
- [Single caption](./guide-cli/single-caption.md) â€” Quick one-off sending

### Web UI
- [Overview](./guide-web/overview.md) â€” Web app layout and navigation
- [Sending captions](./guide-web/sending-captions.md) â€” How to send captions
- [Caption settings](./guide-web/caption-settings.md) â€” Formatting options
- [General settings](./guide-web/general-settings.md) â€” App configuration
- [Translation](./guide-web/translation.md) â€” Multi-language captions
- [Video player](./guide-web/video-player.md) â€” HLS viewer
- [Embed widgets](./guide-web/embed.md) â€” Embeddable iframe widgets
- [Minimal backend](./guide-web/minimal-backend.md) â€” Lightweight setup
- [Status & actions](./guide-web/status-actions.md) â€” Quick status bar
- [Keyboard shortcuts](./guide-web/keyboard-shortcuts.md) â€” Key bindings
- [Flow diagram](./guide-web/flow.md) â€” Architecture visualization

## ðŸ”§ Installation & Deployment

- [**DEPLOY.md**](./DEPLOY.md) â€” Production deployment checklist
- [**FIREWALL.md**](./FIREWALL.md) â€” Network and firewall setup
- [**DB.md**](./DB.md) â€” Database schema and migrations
- [**PORTS.md**](../PORTS.md) â€” Port assignment reference
- [**TODO.md**](../TODO.md) â€” Outstanding work items
- [**env-vars.md**](./env-vars.md) â€” Complete environment variable reference
- [**Distributed compute (fffleet)**](./DEPLOY.md#distributed-mode-fffleet) â€” `FFMPEG_RUNNER=fleet`, FFFLEET_URL

### Platform-Specific
- [ffmpeg Docker usage](./ffmpeg-docker-usage.md) â€” FFmpeg container guide

## ðŸ“– API Reference

**API documentation by endpoint** â€” Full reference in [docs/api/](./api/):

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

## ðŸ“š Library Documentation

### Node.js/JavaScript

Core library docs in [docs/lib/](./lib/):
- [sender.md](./lib/sender.md) â€” YoutubeLiveCaptionSender class
- [backend-sender.md](./lib/backend-sender.md) â€” BackendCaptionSender relay client
- [config.md](./lib/config.md) â€” Configuration management
- [errors.md](./lib/errors.md) â€” Error types
- [logger.md](./lib/logger.md) â€” Logging utilities
- [README](./lib/README.md) â€” Full library index

**Packages:**
- [`lcyt` npm package](../packages/lcyt/README.md) â€” Core library
- [`lcyt-cli` npm package](../packages/lcyt-cli/README.md) â€” CLI tool

### Python

Python library docs in [docs/lib/python/](./lib/python/):
- [sender.md](./lib/python/sender.md) â€” YoutubeLiveCaptionSender class
- [backend-sender.md](./lib/python/backend-sender.md) â€” Relay client
- [config.md](./lib/python/config.md) â€” Configuration
- [errors.md](./lib/python/errors.md) â€” Error types
- [README](./lib/python/README.md) â€” Full library index

**Packages:**
- [lcyt PyPI package](../python-packages/lcyt/README.md) â€” Core library
- [lcyt-backend package](../python-packages/lcyt-backend/README.md) â€” Flask backend

## ðŸ¤– AI & MCP Integration

MCP (Model Context Protocol) documentation in [docs/mcp/](./mcp/):

- [MCP overview](./mcp/README.md) â€” What is MCP?
- [Stdio transport](./mcp/stdio.md) â€” Local process invocation
- [Streamable HTTP transport](./mcp/http.md) â€” Remote HTTP clients
- [All tools reference](./mcp/tools.md) â€” Complete tool listing
- [Individual tool docs](./mcp/tools/) â€” Per-tool details
  - [start.md](./mcp/tools/start.md)
  - [send-caption.md](./mcp/tools/send-caption.md)
  - [send-batch.md](./mcp/tools/send-batch.md)
  - [sync-clock.md](./mcp/tools/sync-clock.md)
  - [get-status.md](./mcp/tools/get-status.md)
  - [privacy.md](./mcp/tools/privacy.md)
  - [privacy-deletion.md](./mcp/tools/privacy-deletion.md)

**Packages:**
- [lcyt-mcp-stdio](../packages/lcyt-mcp-stdio/README.md) â€” Stdio server
- [lcyt-mcp-http](../packages/lcyt-mcp-http/README.md) â€” Streamable HTTP server
- [lcyt-mcp (Python)](../python-packages/lcyt-mcp/README.md) â€” Python server

## ðŸ—ï¸ Architecture & Planning

### Implementation Plans

All plans in [docs/plans/](./plans/) â€” See [PLANS.md](./PLANS.md) for full index:

**Core Features:**
- [plan_admin.md](./plans/plan_admin.md) â€” Admin panel (users, projects)
- [plan_backend.md](./plans/plan_backend.md) â€” Backend architecture
- [plan_captions.md](./plans/plan_captions.md) â€” Caption system
- [plan_cea.md](./plans/plan_cea.md) â€” CEA-608/708 encoding
- [plan_client.md](./plans/plan_client.md) â€” Web UI architecture
- [plan_ui.md](./plans/plan_ui.md) â€” UI layout and design

**Advanced Features:**
- [plan_agent.md](./plans/plan_agent.md) â€” AI agent plugin
- [plan_cues.md](./plans/plan_cues.md) â€” Cue engine plugin
- [plan_dsk.md](./plans/plan_dsk.md) â€” DSK graphics overlays
- [plan_files3.md](./plans/plan_files3.md) â€” S3 file storage
- [plan_hls_sidecar.md](./plans/plan_hls_sidecar.md) â€” HLS subtitle sidecars
- [plan_mcp.md](./plans/plan_mcp.md) â€” MCP integration
- [plan_music.md](./plans/plan_music.md) â€” Music detection plugin
- [plan_prod.md](./plans/plan_prod.md) â€” Production control
- [plan_rtmp.md](./plans/plan_rtmp.md) â€” RTMP relay
- [plan_server_stt.md](./plans/plan_server_stt.md) â€” Server-side STT
- [plan_setup_wizard.md](./plans/plan_setup_wizard.md) â€” Onboarding
- [plan_sync.md](./plans/plan_sync.md) â€” NTP clock sync
- [plan_translate.md](./plans/plan_translate.md) â€” Translation system
- [plan_translations.md](./plans/plan_translations.md) â€” i18n implementation
- [plan_userprojects.md](./plans/plan_userprojects.md) â€” User accounts & projects

**Infrastructure:**
- [plan_backend_split.md](./plans/plan_backend_split.md) â€” Microservices split
- [plan_cache.md](./plans/plan_cache.md) â€” Caching strategy
- [plan_cloudfleet.md](./plans/plan_cloudfleet.md) â€” Kubernetes deployment
- [plan_dock_ffmpeg.md](./plans/plan_dock_ffmpeg.md) â€” Docker ffmpeg runner â†’ distributed Hetzner compute (implemented, then superseded by the external fffleet project; the orchestrator and worker daemon were retired 2026-10-05)
- [plan_mediamtx.md](./plans/plan_mediamtx.md) â€” MediaMTX integration
- [plan_metacode_refactor.md](./plans/plan_metacode_refactor.md) â€” Metacode system refactor

### System Documentation

- [**METACODE.md**](./METACODE.md) â€” Caption metadata system (graphics, cues, sound)
- [**GUIDE.md**](./GUIDE.md) â€” General user guide reference

## ðŸ“¦ Package & Plugin Documentation

### Main Packages

| Package | README |
|---------|--------|
| **lcyt** | [packages/lcyt/README.md](../packages/lcyt/README.md) |
| **lcyt-cli** | [packages/lcyt-cli/README.md](../packages/lcyt-cli/README.md) |
| **lcyt-backend** | [packages/lcyt-backend/README.md](../packages/lcyt-backend/README.md) |
| **lcyt-web** | [packages/lcyt-web/README.md](../packages/lcyt-web/README.md) |
| **lcyt-bridge** | [packages/lcyt-bridge/README.md](../packages/lcyt-bridge/README.md) |
| **lcyt-site** | [packages/lcyt-site/README.md](../packages/lcyt-site/README.md) |
| **lcyt-mcp-stdio** | [packages/lcyt-mcp-stdio/README.md](../packages/lcyt-mcp-stdio/README.md) |
| **lcyt-mcp-http** | [packages/lcyt-mcp-http/README.md](../packages/lcyt-mcp-http/README.md) |

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

## ðŸ“ File Organization

```
docs/
â”œâ”€â”€ INDEX.md                    â† YOU ARE HERE
â”œâ”€â”€ PLANS.md                    â† Plan index with status
â”œâ”€â”€ GUIDE.md                    â† User guide index
â”œâ”€â”€ DB.md                       â† Database schema
â”œâ”€â”€ DEPLOY.md                   â† Deployment guide
â”œâ”€â”€ FIREWALL.md                 â† Network setup
â”œâ”€â”€ METACODE.md                 â† Metacode system
â”œâ”€â”€ env-vars.md                 â† Environment variables
â”œâ”€â”€ ffmpeg-docker-usage.md      â† Docker ffmpeg
â”‚
â”œâ”€â”€ api/                        â† API endpoint docs
â”‚   â”œâ”€â”€ README.md
â”‚   â”œâ”€â”€ sessions.md, captions.md, events.md
â”‚   â”œâ”€â”€ files.md, usage.md, stats.md
â”‚   â”œâ”€â”€ stream.md, stream-hls.md, radio.md
â”‚   â”œâ”€â”€ viewer.md, video.md, preview.md
â”‚   â”œâ”€â”€ dsk.md, images.md, icons.md
â”‚   â””â”€â”€ [20+ more endpoint docs]
â”‚
â”œâ”€â”€ lib/                        â† JavaScript/Node.js library docs
â”‚   â”œâ”€â”€ README.md
â”‚   â”œâ”€â”€ sender.md, backend-sender.md, config.md
â”‚   â”œâ”€â”€ errors.md, logger.md
â”‚   â””â”€â”€ python/                 â† Python library docs
â”‚       â”œâ”€â”€ README.md
â”‚       â””â”€â”€ [similar structure]
â”‚
â”œâ”€â”€ guide-cli/                  â† CLI usage guides
â”‚   â”œâ”€â”€ full-screen.md
â”‚   â”œâ”€â”€ interactive.md
â”‚   â””â”€â”€ single-caption.md
â”‚
â”œâ”€â”€ guide-web/                  â† Web UI guides
â”‚   â”œâ”€â”€ getting-started.md
â”‚   â”œâ”€â”€ overview.md
â”‚   â”œâ”€â”€ sending-captions.md
â”‚   â”œâ”€â”€ settings/
â”‚   â”œâ”€â”€ features/ (translate, video, embed, etc.)
â”‚   â””â”€â”€ [13+ guide files]
â”‚
â”œâ”€â”€ mcp/                        â† MCP integration docs
â”‚   â”œâ”€â”€ README.md
â”‚   â”œâ”€â”€ stdio.md, http.md
â”‚   â”œâ”€â”€ tools.md
â”‚   â””â”€â”€ tools/                  â† Individual tool docs
â”‚
â”œâ”€â”€ plans/                      â† Implementation plans
â”‚   â”œâ”€â”€ [31+ plan_*.md files]
â”‚   â”œâ”€â”€ PR_phase6-7_hetzner.md
â”‚   â””â”€â”€ TODO_plan.md
â”‚
â””â”€â”€ todo_*.md                   â† Legacy TODO files
```

## ðŸ” Quick Navigation

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

## ðŸ†˜ Getting Help

1. **Read the relevant guide** for your use case (from "By Role" above)
2. **Check implementation plans** in [docs/plans/](./plans/) for deep dives
3. **Search CLAUDE.md** for architectural details
4. **Review API docs** for endpoint specifics
5. **Check package READMEs** for library/component usage

## ðŸ“Š Documentation Status

| Category | Files | Status | Last Updated |
|----------|-------|--------|--------------|
| Root docs | 16 | âœ… Complete | 2026-06-26 |
| API docs | 22 | âœ… Complete | 2026-06-26 |
| User guides | 16 | âœ… Complete | 2026-06-26 |
| Library docs | 8 | âœ… Complete | 2026-06-26 |
| MCP docs | 16 | âœ… Complete | 2026-06-26 |
| Plans | 31 | âœ… Complete | 2026-06-26 |
| Package READMEs | 20 | âœ… Complete | 2026-06-26 |
| Plugin READMEs | 7 | âœ… Complete | 2026-06-26 |

---

**Last updated:** 2026-06-26  
**Total documentation files:** 170+  
**Navigation:** Use this index to find what you need, then drill down to specific docs.

