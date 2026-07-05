# Test Coverage

*Last updated: 2026-07-05 (lcyt-connectors plugin added: API Connectors & Variables)*

Per-package test coverage detail (covered / gaps) now lives alongside each package's own documentation, in that package's `CLAUDE.md` (e.g. `packages/lcyt-backend/CLAUDE.md`, `packages/plugins/lcyt-rtmp/CLAUDE.md`). This file holds only the repo-wide summary and the cross-package priority list.

## Coverage Summary

| Package | Source LOC | Test LOC | Coverage | Priority | Key Gaps |
|---------|-----------|----------|----------|----------|-----------|
| `packages/lcyt` | 1,016 | 1,267 | Excellent | Low | `logger.js`, `config.js` (no direct tests) |
| `packages/lcyt-cli` | 1,836 | ~900 | Moderate | Low | Blessed rendering (requires full blessed mock) |
| `packages/lcyt-backend` | ~3,500 | ~2,750 | Good | Low | graceful shutdown (`index.js`), `db/sequences.js`, `db/helpers.js` |
| `packages/plugins/lcyt-rtmp` | ~2,500 | ~600 | Moderate | Medium | `SttManager` audio-source switching (rtmp/whep), grpc streaming path, `NginxManager` reload |
| `packages/plugins/lcyt-connectors` | ~900 | ~700 | Good | Low | `InputBar.jsx` pointer-effect/prefetch-interval wiring (no test file covers `InputBar.jsx` at all yet); frontend Connector/Request/Variable management UI not built |
| `packages/lcyt-orchestrator` | ~400 | ~200 | Moderate | Low | `autoscaler.js`, full burst-provisioning E2E |
| `packages/lcyt-worker-daemon` | ~200 | ~150 | Moderate | Low | `uploader.js`, S3 upload errors |
| `packages/lcyt-bridge` | 490 | ~400 | Good | Low | `tray.js` (desktop-only), entry-point env-var validation |
| `packages/lcyt-mcp-stdio` | 272 | ~300 | Good | Low | Edge cases only |
| `packages/lcyt-mcp-http` | 1,083 | ~450 | Good | Low | Full MCP tool-call flow via Streamable HTTP (requires MCP client harness) |
| `packages/lcyt-web` | 5,000+ | ~1,000 | Good | Low | React components (sidebar, dashboard, pages, panels), embed pages, production pages |
| `python-packages/lcyt` | 1,053 | 1,200 | Excellent | Low | None identified |
| `python-packages/lcyt-backend` | 1,135 | 800 | Good | Low | `middleware/cors.py`, incomplete feature parity with Node.js backend |
| `python-packages/lcyt-mcp` | 252 | 300 | Good | Low | None identified |

See each package's own `CLAUDE.md` for the detailed "Test Coverage" breakdown (test files, what's covered, specific gaps) behind this summary row.

## Top Priorities for Next Test Expansion

Items marked ✅ were completed 2026-03-16 or 2026-03-17.

1. ✅ **`packages/lcyt-backend` ffmpeg managers** *(Critical → Done)* — manager tests moved to `lcyt-rtmp` plugin (52+ tests).
2. ✅ **`packages/lcyt-backend` 5 untested routes** *(High → Done)* — `auth.test.js`, `video.test.js`, `preview-route.test.js`, `stream.test.js`, `youtube.test.js` added (69 tests).
3. ✅ **`packages/lcyt-cli/src/interactive-ui.js`** *(High → Done)* — `interactive-ui.test.js` added (49 tests).
4. ✅ **`packages/lcyt-web` pure utilities** *(High → Done)* — `fileUtils.test.js` + `i18n.test.js` added (38 tests).
5. ✅ **`packages/lcyt-web` React hooks + Vitest setup** *(Medium → Done)* — Vitest + jsdom added; `useSession.test.jsx` (25 tests), `useFileStore.test.jsx` (35 tests), `AppProviders.test.jsx` (15 tests) added (75 tests total).
6. ✅ **`packages/lcyt-backend/src/middleware/cors.js`** *(Medium → Done)* — `cors.test.js` added (19 tests).
7. ✅ **`packages/lcyt-backend/src/caption-files.js`** *(Medium → Done)* — `caption-files.test.js` added (21 tests, pure functions).
8. ✅ **`packages/lcyt-web` useSentLog + ToastContainer** *(Medium → Done)* — `useSentLog.test.jsx` (30 tests) + `useToast.test.jsx` (18 tests) added.
9. ✅ **`packages/lcyt-mcp-http/src/server.js` HTTP routes** *(Medium → Done)* — `server.test.js` added (6 tests).
10. **`packages/lcyt-backend/src/index.js`** *(Low)* — graceful shutdown (SIGTERM/SIGINT) not tested; tightly coupled to process signals and server startup.
11. **`packages/plugins/lcyt-rtmp` STT gRPC path** *(Medium)* — `GoogleSttAdapter` gRPC streaming (requires `@google-cloud/speech` installed) not covered by CI.
12. **`packages/lcyt-backend/src/routes/stt.js`** *(Medium)* — server-side STT HTTP routes untested.
13. **`packages/lcyt-orchestrator` autoscaler** *(Low)* — `autoscaler.js` not covered; burst provisioning E2E requires Hetzner mock server.
