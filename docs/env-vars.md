# Environment variables discovered in the codebase

This document lists environment variables found across the repository, with the files where they appear and a short description. Use this as a reference when building, running, or operating the services.

## Build-time vars (also present in scripts/build.env.example)
- `APT_MIRROR` — Optional apt mirror URL for Docker build-arg.
  - Files: Dockerfile, docker-compose.yml
- `RTMP_RELAY_ACTIVE` — Build-time flag to include RTMP-relay/ffmpeg tooling.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/api.js
- `RADIO_ACTIVE` — Build-time flag to include radio (audio HLS) features.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/radio-manager.js
- `HLS_ACTIVE` — Build-time flag to include video HLS features.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/hls-manager.js
- `PREVIEW_ACTIVE` — Build-time flag to include preview thumbnail generation.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/preview-manager.js
- `GRAPHICS_ENABLED` — Build-time flag to include Chromium/Playwright for DSK.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-dsk/src/renderer.js
- `NODE_ENV` — Node environment for build (commonly `production`).
  - Files: Dockerfile, packages/lcyt-mcp-sse/Dockerfile, packages/lcyt-mcp-stdio/Dockerfile
- `VITE_BACKUP_DAYS` — Vite build-time env used in web bundle for backup retention UI.
  - Files: packages/lcyt-web/src/components/PrivacyModal.jsx, docs/plan_client.md
- `VITE_SITE_URL` — Vite build-time base/site URL baked into web bundle.
  - Files: packages/lcyt-web/src/components/ProductionBridgesPage.jsx, docs/plan_client.md
- `VITE_API_KEY` — Optional API key baked into the web bundle (secret — avoid committing).
  - Files: docs/plan_client.md, packages/lcyt-web/src/

---

## Runtime variables (file locations + short context)

- `PORT` — HTTP server port for backend/MCP services (default 3000/3001).
  - Files: packages/lcyt-backend/src/index.js, packages/lcyt-mcp-sse/src/server.js, Dockerfile, docker-compose.yml, packages/tools/tcp-echo-server/server.js

- `HOST` — Host/address binding used in some tools (e.g. tcp-echo-server).
  - Files: packages/tools/tcp-echo-server/server.js, packages/tools/tcp-echo-server/dist/bundle.cjs

- `DB_PATH` — Path to the SQLite DB file used by backend/MCP.
  - Files: packages/lcyt-mcp-sse/src/server.js, packages/lcyt-backend/src/db/index.js, docker-compose.yml

- `MCP_REQUIRE_API_KEY` — Require API key for MCP SSE server operations.
  - Files: packages/lcyt-mcp-sse/src/server.js, docker-compose.yml

- `LCYT_BACKEND_URL` — Base URL of the lcyt backend used by MCP and tools.
  - Files: packages/lcyt-mcp-sse/src/server.js, packages/lcyt-mcp-stdio/src/server.js, docker-compose.yml, docs/plan_mcp.md, python-packages/lcyt-mcp/lcyt_mcp/server.py

- `LCYT_API_KEY` — API key used as X-API-Key for DSK/editor tools (secret).
  - Files: packages/lcyt-mcp-sse/src/server.js, docker-compose.yml, docs/plan_mcp.md, python-packages/lcyt-mcp/lcyt_mcp/server.py

- `LCYT_ADMIN_KEY` — Admin key for production tools (secret).
  - Files: packages/lcyt-mcp-sse/src/server.js, docker-compose.yml, docs/plan_mcp.md, python-packages/lcyt-mcp/lcyt_mcp/server.py

- `ADMIN_KEY` — Admin API key for backend admin endpoints (secret).
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/middleware/admin.js, docker-compose.yml, packages/lcyt-backend/.env.example, scripts/deploy.sh

- `JWT_SECRET` — HS256 JWT secret used for signing session/user tokens (secret).
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml, packages/lcyt-backend/.env.example, scripts/deploy.sh

- `ALLOWED_DOMAINS` — Comma-separated domains allowed for session origin/CORS.
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/routes/live.js, packages/lcyt-backend/src/routes/usage.js, docker-compose.yml

- `ALLOWED_RTMP_DOMAINS` — Domains allowed to use RTMP relay endpoints.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-rtmp/src/routes/rtmp.js, docker-compose.yml

- `USAGE_PUBLIC` — If set, makes /usage endpoint public (no admin key needed).
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/routes/usage.js, docker-compose.yml

- `FREE_APIKEY_ACTIVE` — Enables self-service free-tier API key signup.
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/routes/keys.js, docker-compose.yml

- `USE_USER_LOGINS` — Set to '0' to disable user registration/login routes.
  - Files: packages/lcyt-backend/src/server.js

- `GRAPHICS_ENABLED` — Runtime toggle to enable DSK/graphics endpoints (also used as build-arg).
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/routes/images.js, Dockerfile, docker-compose.yml

- `GRAPHICS_DIR` — Directory for uploaded DSK images.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/caption-processor.js, packages/plugins/lcyt-dsk/src/routes/images.js

- `GRAPHICS_MAX_FILE_BYTES` — Max bytes per uploaded DSK image.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/routes/images.js

- `GRAPHICS_MAX_STORAGE_BYTES` — Max total image storage per API key for DSK images.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/routes/images.js

- `PLAYWRIGHT_DSK_CHROMIUM` — Path to Chromium binary used by Playwright for DSK renderer.
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, Dockerfile

- `DSK_LOCAL_SERVER` — Local server URL for DSK renderer to fetch templates.
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, Dockerfile

- `DSK_LOCAL_RTMP` — Local nginx-rtmp base URL used by DSK renderer for RTMP output.
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js, packages/plugins/lcyt-dsk/src/routes/dsk-templates.js

- `DSK_RTMP_APP` — RTMP application name used by DSK renderer.
  - Files: packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js, packages/plugins/lcyt-dsk/src/routes/dsk-templates.js

- `RTMP_HOST` — Default RTMP host for RTMP relay behaviour.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-rtmp/src/rtmp-manager.js, docker-compose.yml

- `RTMP_APP` — Default RTMP application name used by relay endpoints.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-rtmp/src/rtmp-manager.js, docker-compose.yml

- `RTMP_APPLICATION` — Alternative env name used in code/tests for RTMP app name.
  - Files: packages/plugins/lcyt-rtmp/src/rtmp-manager.js, packages/lcyt-backend/test/rtmp.test.js

- `RTMP_CONTROL_URL` — Optional nginx-rtmp control URL used by RTMP manager.
  - Files: packages/plugins/lcyt-rtmp/src/rtmp-manager.js

- `HLS_ROOT` — Filesystem root for video HLS output.
  - Files: packages/plugins/lcyt-rtmp/src/hls-manager.js, docker-compose.yml

- `HLS_LOCAL_RTMP` — Local RTMP base URL used by HLS/preview ffmpeg pipelines.
  - Files: packages/plugins/lcyt-rtmp/src/hls-manager.js, packages/plugins/lcyt-rtmp/src/preview-manager.js

- `HLS_RTMP_APP` — RTMP application name for video HLS/preview.
  - Files: packages/plugins/lcyt-rtmp/src/hls-manager.js, packages/plugins/lcyt-rtmp/src/preview-manager.js

- `HLS_SUBS_ROOT` — Directory for WebVTT subtitle segment files.
  - Files: packages/plugins/lcyt-rtmp/src/hls-subs-manager.js, docker-compose.yml

- `HLS_SUBS_SEGMENT_DURATION` — Duration in seconds for WebVTT subtitle segments.
  - Files: packages/plugins/lcyt-rtmp/src/hls-subs-manager.js

- `HLS_SUBS_WINDOW_SIZE` — Number of WebVTT subtitle segments to keep per language.
  - Files: packages/plugins/lcyt-rtmp/src/hls-subs-manager.js

- `RADIO_HLS_ROOT` — Filesystem root for audio HLS output.
  - Files: packages/plugins/lcyt-rtmp/src/radio-manager.js, docker-compose.yml

- `RADIO_LOCAL_RTMP` — Local RTMP base URL used by radio HLS pipelines.
  - Files: packages/plugins/lcyt-rtmp/src/radio-manager.js, packages/plugins/lcyt-rtmp/src/preview-manager.js

- `RADIO_RTMP_APP` — RTMP application name used by radio HLS.
  - Files: packages/plugins/lcyt-rtmp/src/radio-manager.js

- `PREVIEW_ROOT` — Directory where preview JPEG thumbnails are stored.
  - Files: packages/plugins/lcyt-rtmp/src/preview-manager.js, docker-compose.yml

- `PREVIEW_INTERVAL_S` — Seconds between thumbnail updates for preview manager.
  - Files: packages/plugins/lcyt-rtmp/src/preview-manager.js

- `SESSION_TTL` — Session TTL (ms) used for in-memory session expiry.
  - Files: packages/lcyt-backend/src/store.js, packages/lcyt-backend/src/routes/live.js, docker-compose.yml

- `CLEANUP_INTERVAL` — Interval (ms) for session cleanup sweeps.
  - Files: packages/lcyt-backend/src/store.js, docker-compose.yml

- `FILES_DIR` — Base directory for storing caption files and downloads.
  - Files: packages/lcyt-backend/src/routes/files.js, packages/lcyt-backend/src/caption-files.js, packages/lcyt-backend/test/files.test.js

- `ICONS_DIR` — Filesystem directory used for icon assets.
  - Files: packages/lcyt-backend/src/routes/icons.js

- `BACKUP_DAYS` — Number of days to retain backups.
  - Files: packages/lcyt-backend/src/index.js, packages/lcyt-backend/.env.example

- `BACKUP_DIR` — Filesystem path where daily DB backups are written.
  - Files: packages/lcyt-backend/src/index.js, packages/lcyt-backend/.env.example, docker-compose.yml

- `REVOKED_KEY_TTL_DAYS` — Days before revoked API keys are purged.
  - Files: packages/lcyt-backend/src/index.js, docker-compose.yml

- `REVOKED_KEY_CLEANUP_INTERVAL` — Interval for revoked-key cleanup sweeps.
  - Files: packages/lcyt-backend/src/index.js, docker-compose.yml

- `TRUST_PROXY` — Express trust proxy setting.
  - Files: packages/lcyt-backend/src/server.js

- `STATIC_DIR` — Directory to serve static files from (optional).
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml

- `PUBLIC_URL` — Public URL used in generated .env downloads and UI links.
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml

- `CONTACT_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `CONTACT_WEBSITE` — Contact metadata returned by GET /contact.
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml

- `YOUTUBE_CLIENT_ID` — Google OAuth Web client ID for GET /youtube/config endpoint.
  - Files: packages/lcyt-backend/src/routes/youtube.js, docker-compose.yml, packages/lcyt-backend/test/youtube.test.js

- `BACKEND_URL` — Override backend origin used for player manifests and CORS checks.
  - Files: packages/plugins/lcyt-rtmp/src/routes/stream-hls.js, packages/lcyt-backend/src/routes/video.js, packages/plugins/lcyt-rtmp/src/routes/radio.js

- `LCYT_WEB_URL` — Public web UI base URL used by MCP and DSK.
  - Files: packages/lcyt-mcp-sse/src/speech.js, packages/lcyt-mcp-sse/src/server.js, docker-compose.yml

- `SPEECH_PUBLIC_URL` — Public URL used by MCP speech/ASR capture endpoints.
  - Files: packages/lcyt-mcp-sse/src/speech.js, packages/lcyt-mcp-sse/src/server.js, docker-compose.yml

- `LCYT_LOG_STDERR` — If '1', route logs to stderr (used by MCP stdio).
  - Files: packages/lcyt-mcp-stdio/Dockerfile, docs/mcp/sse.md, docs/mcp/stdio.md, packages/lcyt-cli/bin/lcyt

- `MCP_SESSION_TTL_MS` — Session TTL (ms) specific to MCP sessions.
  - Files: packages/lcyt-mcp-sse/src/server.js, docker-compose.yml

- `FILES_BASE_DIR` — Alias/default base dir for files operations.
  - Files: packages/lcyt-backend/src/caption-files.js, packages/lcyt-backend/src/routes/files.js, packages/lcyt-backend/test/files.test.js

- `CEA708_OFFSET_MS`, `CEA708_DURATION_MS`, `CEA708_MAX_BACKTRACK_MS` — CEA-708 caption timing offsets.
  - Files: packages/plugins/lcyt-rtmp/src/rtmp-manager.js

- `DOTENV_KEY` — Optional key used in lcyt-bridge built bundle to read dotenv values.
  - Files: packages/lcyt-bridge/dist/bundle.cjs

---

If you'd like, I can:
- Commit these two files in a branch and open a PR.
- Expand `docs/env-vars.md` into separate per-service env examples (`packages/lcyt-backend/.env.example`, `packages/lcyt-mcp-sse/.env.example`, etc.).
