# Copilot instructions for live-captions-yt

Purpose
- Short, actionable guidance for future Copilot/Copilot-CLI sessions working in this repository.

1) Build, test, and lint commands
- Root (npm workspaces):
  - Install: `npm install` (run at repo root)
  - Build core library: `npm run build` (builds packages/lcyt)
  - Run all Node tests: `npm test` (runs across workspaces)
  - Start CLI: `npm start` (runs packages/lcyt-cli)
  - Start Node backend: `npm run start:backend` (runs packages/lcyt-backend)
  - Web dev server: `npm run web` (runs packages/lcyt-web)
  - Build web: `npm run build:web`; preview: `npm run preview:web`
  - Build site: `npm run build:site`
  - Screenshots capture: `npm run screenshots`

- Single-package test commands (useful for fast iteration):
  - Any package: `npm test -w packages/<name>` (runs that package's test script)
  - lcyt-web unit tests (node:test): `npm test -w packages/lcyt-web` (runs `node --test test/*.test.js`)
  - lcyt-web component tests (Vitest/jsdom): `npm run test:components -w packages/lcyt-web` (runs `vitest run`)

- Python packages:
  - Install: `pip install -r requirements.txt` from `python-packages/<pkg>` (e.g., `python-packages/lcyt-backend`)
  - Tests: run `pytest` from the target python package directory

- Linting: repository has no centralized `lint` script or enforced ESLint config at root. Individual packages may carry inline eslint comments; do not assume a single linter target.

2) High-level architecture (big picture)
- Monorepo (npm workspaces + python-packages):
  - Core Node library: `packages/lcyt/` (library used by other packages)
  - CLI: `packages/lcyt-cli/`
  - Backend relay: `packages/lcyt-backend/` (Express.js, pluginable)
  - Web UI: `packages/lcyt-web/` (Vite + React + wouter; many contexts/hooks)
  - MCP servers: `packages/lcyt-mcp-stdio/` (stdio transport) and `packages/lcyt-mcp-http/` (streamable HTTP/SSE)
  - Plugins: `packages/plugins/*` (feature plugins imported by backend)
  - Orchestrator / Worker: `packages/lcyt-orchestrator/`, `packages/lcyt-worker-daemon/` (ffmpeg jobs, autoscaling)
  - Python mirrors: `python-packages/` (Flask backend and Python library)
  - Android TV viewer: `android/lcyt-tv/`

- Caption delivery flow (important cross-file concept):
  - Client POSTs `POST /live` to backend with `{ apiKey, domain, targets: [...] }` (preferred target-array mode) or legacy `{ streamKey }`.
  - Backend creates one `YoutubeLiveCaptionSender` per youtube target and stores senders in session (session.sender or session.extraTargets).
  - `BackendCaptionSender` implements `start({targets})`, `send()`, `sendBatch()`; backend routes delivery and handles retries.

- Plugin architecture (backend):
  - Plugins export `init*()` (migrations/background services) and `create*Router()`/`create*Routers()` to mount Express routers.
  - Injected deps: `db` (SQLite), `store` (SessionStore), `auth` (JWT middleware), `relayManager` (from lcyt-rtmp).
  - Plugins live under `packages/plugins/*` and are workspace members.

- Metacode: core metacode handoff in `packages/lcyt-backend/src/metacode.js`; plugin-owned processors handle plugin metacode (DSK, cues, etc.). See `docs/METACODE.md`.

3) Key repository-specific conventions
- Error hierarchy: use typed exceptions — `LCYTError` base → `ConfigError`, `NetworkError` (has `statusCode`), `ValidationError` (has `field`). Prefer throwing the most specific subtype.
- Timestamp handling (critical):
  - Node.js: numeric epoch >= 1000 = milliseconds. ISO strings use `YYYY-MM-DDTHH:MM:SS.mmm` (no trailing Z).
  - Python: numeric epoch >= 1000 = seconds. ISO strings same format (no trailing Z).
  - YouTube requires timestamps within 60s of server time and body must end with a newline.
- Logging: use `lcyt/logger` not `console.*`. For MCP contexts, set `LCYT_LOG_STDERR=1` or use `--log-stderr` for CLI so protocol messages remain on stdout.
- Configuration precedence:
  - CLI: CLI args > `~/.lcyt-config.json` > defaults
  - Server: environment variables only (12-factor). Ensure `JWT_SECRET` and `ADMIN_KEY` for production.
- Frontend localStorage key pattern: keys use `lcyt.{category}.{key}` (see `packages/lcyt-web/src/lib/storageKeys.js`).
- Testing frameworks:
  - Many Node packages rely on Node's built-in `node:test` runner (`node --test` pattern).
  - lcyt-web component tests use Vitest + jsdom. Use `test:components` target for those.
- Package-local docs: every package/plugin contains a `CLAUDE.md` with per-package developer notes, env vars, and test/coverage details — prefer reading that when editing inside the package folder.

4) AI/assistant and other agent files to include
- Use per-package `CLAUDE.md` as authoritative package-level guidance (exists widely across `packages/*` and `python-packages/*`).
- If working inside `packages/lcyt-web`, apply the `packages/lcyt-web/CLAUDE.md` custom instructions (routing, contexts, test details).
- Other AI assistant files (if present) that Copilot should incorporate: `.cursorrules`, `AGENTS.md`, `CONVENTIONS.md`, `.windsurfrules`, etc. (none found at root; CLAUDE.md files are primary).

5) MCP servers note (for Copilot sessions)
- Repo includes MCP servers: `packages/lcyt-mcp-stdio` and `packages/lcyt-mcp-http`. DSK rendering uses Playwright/Chromium (see `packages/plugins/lcyt-dsk/`).
- If a Copilot session needs runtime Emulators (Playwright, SSE), prefer local dev runs (`npm run web`, `node packages/lcyt-mcp-http/src/server.js`) or docker-compose stacks defined at repo root.

6) Where to look first when changing code
- For cross-cutting features: start with `packages/lcyt/` (core behaviors), `packages/lcyt-backend/` (routing/session), and the plugin under `packages/plugins/*` that owns the feature.
- For UI work: `packages/lcyt-web/` — read its `CLAUDE.md` and `src/contexts` first (AppProviders, ConnectionContext, CaptionContext, useSession hook).
- For MCP/assistant code: prefer `packages/lcyt-mcp-stdio/` and `packages/lcyt-mcp-http/` README + their `CLAUDE.md`.

Summary
- This file collects the repository's canonical scripts, the cross-package architecture notes, and the important conventions (timestamps, errors, logging, plugins, tests). When editing package code, open that package's `CLAUDE.md` first.

If anything here should be expanded (more package-specific scripts, CI workflows, or explicit lint rules), say which package to prioritise and an automated update can be produced.
