# Test Coverage

*Last updated: 2026-10-06. Run on `main` at 7c2e6f9 (+ the 2026-10-06 fixes): 3,888 of 3,889 Node tests pass (1 skipped, `lcyt-compute`), plus 552 Vitest tests in `lcyt-web`. Python packages not re-run. CI discovers packages by glob (`.github/workflows/integration-tests.yml`).*

Tests per package (`npm test`): `lcyt` 126, `lcyt-cli` 76, `lcyt-backend` 1,222, `lcyt-web` 509 (+552 Vitest), `lcyt-mcp-stdio` 27, `lcyt-mcp-http` 71, `lcyt-bridge` 152, `lcyt-compute` 89, `lcyt-tools` 26, `lcyt-actions` 38, `lcyt-agent` 225, `lcyt-connectors` 112, `lcyt-cues` 135, `lcyt-dsk` 120, `lcyt-files` 91, `lcyt-music` 99, `lcyt-platforms` 195, `lcyt-production` 331, `lcyt-rtmp` 249.

**Everything that talks to another machine or a third party is tested against fakes only:** the fffleet fleet (`lcyt-compute`, perception, DSK, relay), the auditor STT service, MediaMTX, YouTube, and local `deer` embeddings. See the 2026-10-06 status report for the bring-up plan.

Per-package test coverage detail (covered / gaps) now lives alongside each package's own documentation, in that package's `CLAUDE.md` (e.g. `packages/lcyt-backend/CLAUDE.md`, `packages/plugins/lcyt-rtmp/CLAUDE.md`). This file holds only the repo-wide summary and the cross-package priority list.

## Coverage Summary

| Package | Source LOC | Test LOC | Coverage | Priority | Key Gaps |
|---------|-----------|----------|----------|----------|-----------|
| `packages/lcyt` | 1,016 | 1,267 | Excellent | Low | `logger.js`, `config.js` (no direct tests) |
| `packages/lcyt-cli` | 1,836 | ~900 | Moderate | Low | Blessed rendering (requires full blessed mock) |
| `packages/lcyt-backend` | ~3,500 | ~2,750 | Good | Low | graceful shutdown (`index.js`), `db/sequences.js`, `db/helpers.js` |
| `packages/plugins/lcyt-rtmp` | ~2,500 | ~600 | Moderate | Medium | `SttManager` audio-source switching (rtmp/whep), grpc streaming path, `NginxManager` reload; the `auditor` provider is tested against a fake service only |
| `packages/plugins/lcyt-connectors` | ~900 | ~700 | Good | Low | `InputBar.jsx` pointer-effect/prefetch-interval wiring is not covered by a test of its own (the connector/request/variable management UI exists) |
| `packages/plugins/lcyt-platforms` | ~1,400 | ~1,600 | Good | Medium | **Nothing is verified against the live YouTube API** â€” by explicit scope decision, all tests stub `fetch` and assert request shapes against the published Data API v3 / Analytics v2 contracts. A real-channel smoke test is still owed. No test covers a real OAuth round-trip. |
| `packages/plugins/lcyt-agent` | ~3,600 | ~2,850 | Good | Medium | Bridge-relayed provider support for the `agentic_chat` turn loop and vision adapters (direct providers only today); the `deer` chat provider kind is a deliberate no-op (deferred) |
| `packages/lcyt-compute` | ~1,500 | ~1,400 | Good | Medium | Never run against a real fffleet orchestrator/worker; stdin-open for stream jobs and worker network reachability unverified |
| `packages/plugins/lcyt-actions` / `lcyt-cues` / `lcyt-production` | ~6,000 | ~5,000 | Good | Medium | Perception detector never run on real footage; cue actions only against fake devices; semantic cue defaults come from two hand-labelled services |
| `packages/plugins/lcyt-dsk` / `lcyt-music` / `lcyt-files` | ~4,500 | ~3,200 | Good | Low | DSK fleet executor and worker image never run on a real worker |
| `packages/lcyt-tools` | ~500 | ~300 | Good | Low | External MCP transport wiring (`lcyt-mcp-stdio`/`lcyt-mcp-http`) not built â€” only the in-process bridge is tested/consumed today |
| `packages/lcyt-bridge` | 490 | ~400 | Good | Low | `tray.js` (desktop-only), entry-point env-var validation |
| `packages/lcyt-mcp-stdio` | 272 | ~300 | Good | Low | Edge cases only |
| `packages/lcyt-mcp-http` | 1,083 | ~450 | Good | Low | Full MCP tool-call flow via Streamable HTTP (requires MCP client harness) |
| `packages/lcyt-web` | 5,000+ | ~1,000 | Good | Low | React components (sidebar, dashboard, pages, panels), embed pages, production pages |
| `python-packages/lcyt` | 1,053 | 1,200 | Excellent | Low | None identified |
| `python-packages/lcyt-backend` | 1,135 | 800 | Good | Low | `middleware/cors.py`, incomplete feature parity with Node.js backend |
| `python-packages/lcyt-mcp` | 252 | 300 | Good | Low | None identified |

See each package's own `CLAUDE.md` for the detailed "Test Coverage" breakdown (test files, what's covered, specific gaps) behind this summary row.

## Top Priorities for Next Test Expansion

Items marked âœ… were completed 2026-03-16 or 2026-03-17.

1. âœ… **`packages/lcyt-backend` ffmpeg managers** *(Critical â†’ Done)* â€” manager tests moved to `lcyt-rtmp` plugin (52+ tests).
2. âœ… **`packages/lcyt-backend` 5 untested routes** *(High â†’ Done)* â€” `auth.test.js`, `video.test.js`, `preview-route.test.js`, `stream.test.js`, `youtube.test.js` added (69 tests).
3. âœ… **`packages/lcyt-cli/src/interactive-ui.js`** *(High â†’ Done)* â€” `interactive-ui.test.js` added (49 tests).
4. âœ… **`packages/lcyt-web` pure utilities** *(High â†’ Done)* â€” `fileUtils.test.js` + `i18n.test.js` added (38 tests).
5. âœ… **`packages/lcyt-web` React hooks + Vitest setup** *(Medium â†’ Done)* â€” Vitest + jsdom added; `useSession.test.jsx` (25 tests), `useFileStore.test.jsx` (35 tests), `AppProviders.test.jsx` (15 tests) added (75 tests total).
6. âœ… **`packages/lcyt-backend/src/middleware/cors.js`** *(Medium â†’ Done)* â€” `cors.test.js` added (19 tests).
7. âœ… **`packages/lcyt-backend/src/caption-files.js`** *(Medium â†’ Done)* â€” `caption-files.test.js` added (21 tests, pure functions).
8. âœ… **`packages/lcyt-web` useSentLog + ToastContainer** *(Medium â†’ Done)* â€” `useSentLog.test.jsx` (30 tests) + `useToast.test.jsx` (18 tests) added.
9. âœ… **`packages/lcyt-mcp-http/src/server.js` HTTP routes** *(Medium â†’ Done)* â€” `server.test.js` added (6 tests).
10. **`packages/lcyt-backend/src/index.js`** *(Low)* â€” graceful shutdown (SIGTERM/SIGINT) not tested; tightly coupled to process signals and server startup.
11. **`packages/plugins/lcyt-rtmp` STT gRPC path** *(Medium)* â€” `GoogleSttAdapter` gRPC streaming (requires `@google-cloud/speech` installed) not covered by CI.
12. **`packages/lcyt-backend/src/routes/stt.js`** *(Medium)* â€” server-side STT HTTP routes untested.

