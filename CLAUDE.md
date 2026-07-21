# live-captions-yt

## Overview

Monorepo for **LCYT** — a full-featured platform for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API. Ships as a Node.js library + CLI, Python library, Express/Flask relay backends, a browser web UI, a Model Context Protocol (MCP) server for AI assistant integration, a DSK graphics overlay system, a production control layer for cameras/mixers, a bridge agent for AV hardware, server-side speech-to-text transcription, and a compute orchestration layer for horizontal scaling.

---

## Repository Structure

```
live-captions-yt/
├── packages/                   # Node.js workspace packages (npm workspaces)
│   ├── lcyt/                   # Core library (published to npm as `lcyt`)
│   ├── lcyt-cli/               # CLI tool (published to npm as `lcyt-cli`)
│   ├── lcyt-backend/           # Express.js HTTP relay backend
│   ├── lcyt-bridge/            # Production control bridge agent (TCP relay to AMX/Roland)
│   ├── lcyt-mcp-stdio/         # MCP server (stdio transport)
│   ├── lcyt-mcp-http/          # MCP server (Streamable HTTP transport)
│   ├── lcyt-site/              # Marketing/docs website (Astro)
│   ├── lcyt-web/               # Browser-based web UI (Vite + React + wouter)
│   ├── lcyt-orchestrator/      # Compute orchestrator — worker registration, job dispatch, Hetzner autoscaling
│   ├── lcyt-worker-daemon/     # Minimal worker daemon — ffmpeg job orchestration, S3 upload
│   ├── lcyt-tools/             # Shared AI tool-schema/handler registry (MCP + agentic_chat roles)
│   ├── shared-styles/          # Shared CSS design tokens consumed by lcyt-site and lcyt-web
│   ├── tools/                  # Standalone utilities
│   │   └── tcp-echo-server/    # TCP echo server for bridge connection testing
│   └── plugins/                # Plugin packages (npm workspaces glob: packages/plugins/*)
│       ├── lcyt-agent/         # AI Agent plugin (AI config, embeddings, LLM event evaluation)
│       ├── lcyt-connectors/    # API Connectors & Variables plugin ({{ }} bindings, metacode-triggered refresh)
│       ├── lcyt-cues/          # Cue Engine plugin (phrase/fuzzy/semantic/event cue matching)
│       ├── lcyt-dsk/           # DSK graphics plugin (Playwright renderer, templates, overlays)
│       ├── lcyt-files/         # Caption file storage plugin (local FS + S3 + WebDAV adapters)
│       ├── lcyt-music/         # Music detection plugin (audio classification, BPM estimation)
│       ├── lcyt-production/    # Production control library (cameras, mixers, bridge)
│       └── lcyt-rtmp/          # RTMP relay plugin (HLS, radio, preview, STT, caption injection)
├── python-packages/            # Python packages
│   ├── lcyt/                   # Core Python library (published to PyPI as `lcyt`)
│   ├── lcyt-backend/           # Flask backend (cPanel/Passenger compatible)
│   └── lcyt-mcp/               # Python MCP server
├── android/                    # Native Android apps
│   └── lcyt-tv/                # Android TV caption viewer (Kotlin + Compose for TV)
├── docker/                     # Docker build contexts for containerised services
│   ├── lcyt-ffmpeg/            # ffmpeg Docker image (used by DockerFfmpegRunner)
│   ├── lcyt-dsk-renderer/      # Chromium DSK renderer Docker image
│   ├── lcyt-bridge/            # Plain Node.js container deployment mode for lcyt-bridge
│   ├── lcyt-bridge-ollama/     # Example: lcyt-bridge + ollama/ollama on a private compose network
│   └── mediamtx.yml            # MediaMTX configuration template
├── ops/                        # Operational runbooks
│   └── runbooks/               # Deployment and maintenance runbooks
├── ci/                         # CI helper scripts
│   └── test-docker.sh          # Docker integration test runner
├── python/                     # LEGACY — do not use; canonical source is python-packages/
├── scripts/                    # Shell deployment scripts + screenshot capture
├── docs/                       # Planning docs, API guides, todo lists
│   ├── PLANS.md                # Index of all plans with status (implemented/pending/draft/…)
│   ├── TEST_COVERAGE.md        # Repo-wide test coverage summary + priority list
│   └── plans/                  # Individual plan files (plan_*.md)
├── .env.example                # Example environment variables
├── docker-compose.yml          # Compose stack for local development
├── docker-compose.orchestrator.yml # Compose stack with orchestrator + worker daemon
├── PORTS.md                    # Port assignment reference
├── TODO.md                     # Outstanding work items
├── CONSIDER.md                 # Skipped code-review/simplify findings, logged for a future pass
├── package.json                # Root workspace manifest
└── CLAUDE.md                   # This file
```

> **Plugin packages** are under `packages/plugins/` and matched by the workspace glob `packages/plugins/*`. They are imported by `lcyt-backend` as named packages (`lcyt-dsk`, `lcyt-production`, `lcyt-rtmp`).

> **Nested docs:** every package and plugin directory listed above has its own `CLAUDE.md` with source-file breakdowns, env vars, API routes, and test-coverage detail — it loads automatically when you're working inside that directory. This file only covers what's true repo-wide. See the [Package Index](#package-index) below for the full list.

---

## Setup

```bash
# Must run at repo root — creates workspace symlinks in node_modules/
npm install
```

For Python:
```bash
# From python-packages/lcyt-backend/
pip install -r requirements.txt
# or: pip install -e ../lcyt -e .
```

---

## Root Scripts

```bash
npm run build          # Build lcyt CJS output (ESM→CJS transformer)
npm test               # Run tests across all Node.js packages
npm start              # Run lcyt-cli
npm run start:backend  # Run lcyt-backend Express server
npm run web            # Run lcyt-web Vite dev server
npm run build:web      # Build lcyt-web for production → packages/lcyt-web/dist/
npm run build:site     # Build lcyt-web then lcyt-site (Astro)
npm run preview:web    # Preview the lcyt-web production build locally
npm run screenshots    # Run Playwright screenshot capture (scripts/screenshots/capture.mjs)
```

---

## Package Index

Each row's `CLAUDE.md` is only loaded when Claude reads or edits files in that directory — this root file stays small for everything else.

| Package | CLAUDE.md |
|---|---|
| Core library (Node) | `packages/lcyt/CLAUDE.md` |
| CLI tool | `packages/lcyt-cli/CLAUDE.md` |
| Express relay backend | `packages/lcyt-backend/CLAUDE.md` |
| Production control bridge agent | `packages/lcyt-bridge/CLAUDE.md` |
| Compute orchestrator | `packages/lcyt-orchestrator/CLAUDE.md` |
| Worker daemon | `packages/lcyt-worker-daemon/CLAUDE.md` |
| TCP echo test server | `packages/tools/tcp-echo-server/CLAUDE.md` |
| MCP server (stdio) | `packages/lcyt-mcp-stdio/CLAUDE.md` |
| MCP server (Streamable HTTP) | `packages/lcyt-mcp-http/CLAUDE.md` |
| Marketing site | `packages/lcyt-site/CLAUDE.md` |
| Web UI | `packages/lcyt-web/CLAUDE.md` |
| Caption file storage plugin | `packages/plugins/lcyt-files/CLAUDE.md` |
| Production control plugin | `packages/plugins/lcyt-production/CLAUDE.md` |
| RTMP relay plugin (+ server-side STT) | `packages/plugins/lcyt-rtmp/CLAUDE.md` |
| DSK graphics plugin | `packages/plugins/lcyt-dsk/CLAUDE.md` |
| Cue engine plugin | `packages/plugins/lcyt-cues/CLAUDE.md` |
| Music detection plugin | `packages/plugins/lcyt-music/CLAUDE.md` |
| AI agent plugin | `packages/plugins/lcyt-agent/CLAUDE.md` |
| Shared AI tool-schema/handler registry | `packages/lcyt-tools/CLAUDE.md` |
| API Connectors & Variables plugin | `packages/plugins/lcyt-connectors/CLAUDE.md` |
| Named Actions plugin | `packages/plugins/lcyt-actions/CLAUDE.md` |
| Core library (Python) | `python-packages/lcyt/CLAUDE.md` |
| Flask backend (Python) | `python-packages/lcyt-backend/CLAUDE.md` |
| MCP server (Python) | `python-packages/lcyt-mcp/CLAUDE.md` |
| Android TV viewer | `android/lcyt-tv/CLAUDE.md` |

`packages/shared-styles/README.md` documents the shared CSS design tokens; it's plain CSS, no CLAUDE.md needed.

---

## Testing

### Node.js
Uses Node's built-in `node:test` — no external test framework.

```bash
npm test                                        # all packages
npm test -w packages/<name>                     # single package
```

### React components and hooks (lcyt-web only)
`packages/lcyt-web` also uses **Vitest** for React hook/component tests that need a DOM — see `packages/lcyt-web/CLAUDE.md`.

### Python
Uses `pytest`, run from `python-packages/lcyt-backend/`.

See each package's own `CLAUDE.md` for its test file layout and current coverage gaps, and `docs/TEST_COVERAGE.md` for the repo-wide summary and priority list.

---

## Key Conventions

### Error Hierarchy
All packages define a typed exception hierarchy: `LCYTError` (base) → `ConfigError`, `NetworkError` (has `statusCode`), `ValidationError` (has `field`). Always raise/throw the most specific type.

### Database access convention
Backend route handlers should stay thin and delegate SQL/data-access work to `packages/lcyt-backend/src/db/*.js` modules. New query logic, row shaping, and write-path helpers belong there, not inline inside route files. This applies to the org/team routes and should be treated as the default pattern for future backend work.

### Skipped Review Findings
When a `/code-review` or `/simplify` pass surfaces a real finding that is deliberately **not** fixed (too invasive for the current diff, out of scope, requires a wider API change, or the "fix" wouldn't actually be simpler), log it in `CONSIDER.md` at the repo root instead of letting it evaporate at the end of the turn — what was found, why it was skipped, and where. Don't silently drop skipped findings from a review summary; either fix them or write them down.

### Artifacts
Whenever a Claude Artifact is published from work in this repo (screenshots, reports, demos), add a row to `Artifacts.md` at the repo root — link, which plan/project it documents, and a short description. Don't let a published link exist only in chat history.

### Timestamp Handling
| Platform | Numeric value | ISO string |
|---|---|---|
| **Node.js** | >= 1000 → milliseconds | `YYYY-MM-DDTHH:MM:SS.mmm` |
| **Python** | >= 1000 → **seconds** | `YYYY-MM-DDTHH:MM:SS.mmm` |

No trailing `Z` in ISO strings — YouTube's API format.

### Caption Target Architecture

Captions are delivered to one or more **targets** configured in the lcyt-web CC → Targets tab. See `packages/lcyt-backend/CLAUDE.md` for the full session/store mechanics.

**Target-array mode (current, recommended):** the client sends `POST /live` with `{ apiKey, domain, targets: [...] }` (no top-level `streamKey`); the backend creates one `YoutubeLiveCaptionSender` per enabled YouTube target and stores all senders in `session.extraTargets`.

**Legacy single-target mode (backward compatible):** the client sends `POST /live` with `{ apiKey, domain, streamKey }`; the backend creates one primary sender in `session.sender` and uses its real YouTube response for the SSE result.

**Target types:**
| Type | Config field | Delivery mechanism |
|---|---|---|
| `youtube` | `streamKey` | `YoutubeLiveCaptionSender` per target; HTTP POST to YouTube ingestion API |
| `viewer` | `viewerKey` | `broadcastToViewers(key, payload)` → SSE `GET /viewer/:key` (public, no auth) |
| `generic` | `url`, `headers` | HTTP POST JSON `{ source, sequence, captions: [...] }` to arbitrary endpoint |

`BackendCaptionSender` (`packages/lcyt/src/backend-sender.js`): `streamKey` is optional (omit for target-array mode); `start({ targets })` registers targets server-side; `send()`/`sendBatch()` always behave the same — the backend handles routing.

**Server-persisted targets (`GET/POST/PUT/DELETE /targets`, `packages/lcyt-backend/src/routes/targets.js`):** the `caption_targets` table is the server-side source of truth for a project's configured targets, independent of any `POST /live` call. `POST /live`'s `targets` field is an **explicit override** — when present (including an explicit empty array `[]`), it is used as-is, exactly as before; when the field is **omitted entirely**, the server loads the project's saved, enabled `caption_targets` rows instead, so a thin client can start a session with just `{ apiKey, domain }`. On the idempotent reconnect path, this same undefined-vs-provided distinction gates whether the running session's `extraTargets` are touched at all, so a reconnect that omits `targets` no longer wipes an already-configured session (see `plan_selfservice_config_backend.md` §1).

### Plugin Architecture

Backend plugins live in `packages/plugins/` and follow this pattern:
- Export `init*()` — runs DB migrations and starts background services; called once at startup.
- Export `create*Router()` / `create*Routers()` — returns Express router(s) to mount.
- Injected dependencies: `db` (SQLite instance), `store` (SessionStore), `auth` (JWT middleware), `relayManager` (from `lcyt-rtmp`, not inline in `lcyt-backend`).
- Plugin packages are workspace members via the glob `packages/plugins/*` in `package.json`.
- `lcyt-rtmp` is the canonical source for `RtmpRelayManager`, `HlsManager`, `RadioManager`, `PreviewManager`, `HlsSubsManager`, `SttManager`, `NginxManager`, and `MediaMtxClient`.

See each plugin's own `CLAUDE.md` (`packages/plugins/*/CLAUDE.md`) for its specific routes, DB tables, and metacode handling.

### Metacode Organization

- Plugin metacode handling stays inside plugin-owned processors: the DSK `graphics` metacode in `packages/plugins/lcyt-dsk/src/caption-processor.js`, the `cue` metacode in `packages/plugins/lcyt-cues/src/cue-processor.js`.
- The `!api:`/`api:`/`api!:` trigger metacodes (and `{{name}}` insertion) are handled differently from the others: parsing lives in `packages/lcyt-web/src/lib/metacode-parser.js` as usual, but the trigger side effect (firing a connector request) is invoked directly by the frontend (`InputBar.jsx`'s pointer effect and `doSend()`) calling `POST /variables/refresh` — there is no backend caption-processor stage for it, since a connector call isn't a per-caption text transform. See `packages/plugins/lcyt-connectors/CLAUDE.md`.
- Core backend metacode handoff lives in `packages/lcyt-backend/src/metacode.js`.
- Frontend metacode parser/runtime/planner helpers live in `packages/lcyt-web/src/lib/metacode-*.js` — see `packages/lcyt-web/CLAUDE.md`.
- See `docs/METACODE.md` and `docs/plans/plan_metacode_refactor.md` for the current scoped refactor plan.

### Logger
Use the `lcyt/logger` module rather than `console.*` directly. For MCP contexts, set `LCYT_LOG_STDERR=1` to avoid writing to stdout (which the MCP protocol uses).

### Configuration
- CLI config: `~/.lcyt-config.json`. Precedence: CLI args > config file > defaults.
- Server config (`lcyt-backend`): env for bootstrap (ports, paths, secrets that gate the process itself, anything executed) plus overrides; DB/UI (Admin → Server, `plan_env_to_ui_settings.md`) for the rest. Precedence is env > DB > built-in default — `packages/lcyt-backend/src/settings/registry.js` is the authoritative enumeration of every setting, replacing the drifting `.env.example`/CLAUDE.md tables as the thing code actually reads against. Warn at startup if `JWT_SECRET` / `ADMIN_KEY` are missing (both stay env-only forever).

### Legacy Python Source
`python/` at the repo root is **legacy**. Do not add code there. All Python development goes in `python-packages/`.

---

## Test Coverage

See `docs/TEST_COVERAGE.md` for the repo-wide coverage summary table and test-expansion priority list. Per-package detail (test files, what's covered, specific gaps) lives in each package's own `CLAUDE.md`.
