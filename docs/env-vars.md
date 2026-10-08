# Environment variables discovered in the codebase

This document lists environment variables found across the repository, with the files where they appear and a short description. Use this as a reference when building, running, or operating the services.

## Build-time vars (also present in scripts/build.env.example)
- `APT_MIRROR` â€” Optional apt mirror URL for Docker build-arg.
  - Files: Dockerfile, docker-compose.yml
- `RTMP_RELAY_ACTIVE` â€” Build-time flag to include RTMP-relay/ffmpeg tooling.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/api.js
- `RADIO_ACTIVE` â€” Build-time flag to include radio (audio HLS) features.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/radio-manager.js
- `HLS_ACTIVE` â€” Build-time flag to include video HLS features.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/hls-manager.js
- `PREVIEW_ACTIVE` â€” Build-time flag to include preview thumbnail generation.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-rtmp/src/preview-manager.js
- `GRAPHICS_ENABLED` â€” Build-time flag to include Chromium/Playwright for DSK.
  - Files: Dockerfile, docker-compose.yml, packages/plugins/lcyt-dsk/src/renderer.js
- `NODE_ENV` â€” Node environment for build (commonly `production`).
  - Files: Dockerfile, packages/lcyt-mcp-http/Dockerfile, packages/lcyt-mcp-stdio/Dockerfile
- `VITE_BACKUP_DAYS` â€” Vite build-time env used in web bundle for backup retention UI.
  - Files: packages/lcyt-web/src/components/PrivacyModal.jsx, docs/plan_client.md
- `VITE_SITE_URL` â€” Vite build-time base/site URL baked into web bundle.
  - Files: packages/lcyt-web/src/components/ProductionBridgesPage.jsx, docs/plan_client.md
- `VITE_API_KEY` â€” Optional API key baked into the web bundle (secret â€” avoid committing).
  - Files: docs/plan_client.md, packages/lcyt-web/src/

---

## Runtime variables (file locations + short context)

- `PORT` â€” HTTP server port for backend/MCP services (default 3000/3001).
  - Files: packages/lcyt-backend/src/index.js, packages/lcyt-mcp-http/src/server.js, Dockerfile, docker-compose.yml, packages/tools/tcp-echo-server/server.js

- `HOST` â€” Host/address binding used in some tools (e.g. tcp-echo-server).
  - Files: packages/tools/tcp-echo-server/server.js, packages/tools/tcp-echo-server/dist/bundle.cjs

- `DB_PATH` â€” Path to the SQLite DB file used by backend/MCP.
  - Files: packages/lcyt-mcp-http/src/server.js, packages/lcyt-backend/src/db/index.js, docker-compose.yml

- `MCP_REQUIRE_API_KEY` â€” Require API key for MCP Streamable HTTP server operations.
  - Files: packages/lcyt-mcp-http/src/server.js, docker-compose.yml

- `LCYT_BACKEND_URL` â€” Base URL of the lcyt backend used by MCP and tools.
  - Files: packages/lcyt-mcp-http/src/server.js, packages/lcyt-mcp-stdio/src/server.js, docker-compose.yml, docs/plan_mcp.md, python-packages/lcyt-mcp/lcyt_mcp/server.py

- `LCYT_API_KEY` â€” API key used as X-API-Key for DSK/editor tools (secret).
  - Files: packages/lcyt-mcp-http/src/server.js, docker-compose.yml, docs/plan_mcp.md, python-packages/lcyt-mcp/lcyt_mcp/server.py

- `LCYT_ADMIN_KEY` â€” Admin key for production tools (secret).
  - Files: packages/lcyt-mcp-http/src/server.js, docker-compose.yml, docs/plan_mcp.md, python-packages/lcyt-mcp/lcyt_mcp/server.py

- `ADMIN_KEY` â€” Admin API key for backend admin endpoints (secret).
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/middleware/admin.js, docker-compose.yml, packages/lcyt-backend/.env.example, scripts/deploy.sh

- `JWT_SECRET` â€” HS256 JWT secret used for signing session/user tokens (secret).
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml, packages/lcyt-backend/.env.example, scripts/deploy.sh

- `ALLOWED_DOMAINS` â€” Comma-separated domains allowed for session origin/CORS.
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/routes/live.js, packages/lcyt-backend/src/routes/usage.js, docker-compose.yml

- `ALLOWED_RTMP_DOMAINS` â€” Domains allowed to use RTMP relay endpoints.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-rtmp/src/routes/rtmp.js, docker-compose.yml

- `USAGE_PUBLIC` â€” If set, makes /usage endpoint public (no admin key needed).
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/routes/usage.js, docker-compose.yml

- `FREE_APIKEY_ACTIVE` â€” Enables self-service free-tier API key signup.
  - Files: packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/routes/keys.js, docker-compose.yml

- `USE_USER_LOGINS` â€” Set to '0' to disable user registration/login routes.
- `LCYT_INSTALL_MODE` â€” `local` drops login (local admin, owns all projects); off by default. See docs/DEPLOY.md.
  - Files: packages/lcyt-backend/src/local-mode.js, packages/lcyt-backend/src/server.js, packages/lcyt-backend/src/index.js
- `LCYT_LOCAL_ALLOW_REMOTE` â€” `1` lets local mode listen on a non-loopback `HOST` (Docker).
  - Files: packages/lcyt-backend/src/server.js

- `GRAPHICS_ENABLED` â€” Runtime toggle to enable DSK/graphics endpoints (also used as build-arg).
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/routes/images.js, Dockerfile, docker-compose.yml

- `GRAPHICS_DIR` â€” Directory for uploaded DSK images.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/caption-processor.js, packages/plugins/lcyt-dsk/src/routes/images.js

- `GRAPHICS_MAX_FILE_BYTES` â€” Max bytes per uploaded DSK image.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/routes/images.js

- `GRAPHICS_MAX_STORAGE_BYTES` â€” Max total image storage per API key for DSK images.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-dsk/src/routes/images.js

- `PLAYWRIGHT_DSK_CHROMIUM` â€” Path to Chromium binary used by Playwright for DSK renderer.
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, Dockerfile

- `DSK_LOCAL_SERVER` â€” Local server URL for DSK renderer to fetch templates.
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, Dockerfile

- `DSK_LOCAL_RTMP` â€” Local nginx-rtmp base URL used by DSK renderer for RTMP output.
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js, packages/plugins/lcyt-dsk/src/routes/dsk-templates.js

- `DSK_RTMP_APP` â€” RTMP application name used by DSK renderer.
  - Files: packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js, packages/plugins/lcyt-dsk/src/routes/dsk-templates.js

- `RTMP_HOST` â€” Default RTMP host for RTMP relay behaviour.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-rtmp/src/rtmp-manager.js, docker-compose.yml

- `RTMP_APP` â€” Default RTMP application name used by relay endpoints.
  - Files: packages/lcyt-backend/src/server.js, packages/plugins/lcyt-rtmp/src/rtmp-manager.js, docker-compose.yml

- `RTMP_APPLICATION` â€” Alternative env name used in code/tests for RTMP app name.
  - Files: packages/plugins/lcyt-rtmp/src/rtmp-manager.js, packages/lcyt-backend/test/rtmp.test.js

- `RTMP_CONTROL_URL` â€” Optional nginx-rtmp control URL used by RTMP manager.
  - Files: packages/plugins/lcyt-rtmp/src/rtmp-manager.js

  - Files: packages/plugins/lcyt-rtmp/src/hls-manager.js, docker-compose.yml

- `HLS_LOCAL_RTMP` â€” Local RTMP base URL used by HLS/preview ffmpeg pipelines.
  - Files: packages/plugins/lcyt-rtmp/src/hls-manager.js, packages/plugins/lcyt-rtmp/src/preview-manager.js

- `HLS_RTMP_APP` â€” RTMP application name for video HLS/preview.
  - Files: packages/plugins/lcyt-rtmp/src/hls-manager.js, packages/plugins/lcyt-rtmp/src/preview-manager.js

- `HLS_SUBS_ROOT` â€” Directory for WebVTT subtitle segment files.
  - Files: packages/plugins/lcyt-rtmp/src/hls-subs-manager.js, docker-compose.yml

- `HLS_SUBS_SEGMENT_DURATION` â€” Duration in seconds for WebVTT subtitle segments.
  - Files: packages/plugins/lcyt-rtmp/src/hls-subs-manager.js

- `HLS_SUBS_WINDOW_SIZE` â€” Number of WebVTT subtitle segments to keep per language.
  - Files: packages/plugins/lcyt-rtmp/src/hls-subs-manager.js

- `RADIO_HLS_ROOT` â€” Filesystem root for audio HLS output.
  - Files: packages/plugins/lcyt-rtmp/src/radio-manager.js, docker-compose.yml

- `RADIO_LOCAL_RTMP` â€” Local RTMP base URL used by radio HLS pipelines.
  - Files: packages/plugins/lcyt-rtmp/src/radio-manager.js, packages/plugins/lcyt-rtmp/src/preview-manager.js

- `RADIO_RTMP_APP` â€” RTMP application name used by radio HLS.
  - Files: packages/plugins/lcyt-rtmp/src/radio-manager.js

- `PREVIEW_ROOT` â€” Directory where preview JPEG thumbnails are stored.
  - Files: packages/plugins/lcyt-rtmp/src/preview-manager.js, docker-compose.yml

- `PREVIEW_INTERVAL_S` â€” Seconds between thumbnail updates for preview manager.
  - Files: packages/plugins/lcyt-rtmp/src/preview-manager.js

- `SESSION_TTL` â€” Session TTL (ms) used for in-memory session expiry.
  - Files: packages/lcyt-backend/src/store.js, packages/lcyt-backend/src/routes/live.js, docker-compose.yml

- `CLEANUP_INTERVAL` â€” Interval (ms) for session cleanup sweeps.
  - Files: packages/lcyt-backend/src/store.js, docker-compose.yml

- `FILES_DIR` â€” Base directory for storing caption files and downloads.
  - Files: packages/lcyt-backend/src/routes/files.js, packages/lcyt-backend/src/caption-files.js, packages/lcyt-backend/test/files.test.js

- `ICONS_DIR` â€” Filesystem directory used for icon assets.
  - Files: packages/lcyt-backend/src/routes/icons.js

- `BACKUP_DAYS` â€” Number of days to retain backups.
  - Files: packages/lcyt-backend/src/index.js, packages/lcyt-backend/.env.example

- `BACKUP_DIR` â€” Filesystem path where daily DB backups are written.
  - Files: packages/lcyt-backend/src/index.js, packages/lcyt-backend/.env.example, docker-compose.yml

- `REVOKED_KEY_TTL_DAYS` â€” Days before revoked API keys are purged.
  - Files: packages/lcyt-backend/src/index.js, docker-compose.yml

- `REVOKED_KEY_CLEANUP_INTERVAL` â€” Interval for revoked-key cleanup sweeps.
  - Files: packages/lcyt-backend/src/index.js, docker-compose.yml

- `TRUST_PROXY` â€” Express trust proxy setting.
  - Files: packages/lcyt-backend/src/server.js

- `STATIC_DIR` â€” Directory to serve static files from (optional).
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml

- `PUBLIC_URL` â€” Public URL used in generated .env downloads and UI links.
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml

- `CONTACT_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `CONTACT_WEBSITE` â€” Contact metadata returned by GET /contact.
  - Files: packages/lcyt-backend/src/server.js, docker-compose.yml

- `YOUTUBE_CLIENT_ID` â€” Google OAuth Web client ID for GET /youtube/config endpoint.
  - Files: packages/lcyt-backend/src/routes/youtube.js, docker-compose.yml, packages/lcyt-backend/test/youtube.test.js

- `BACKEND_URL` â€” Override backend origin used for player manifests and CORS checks.
  - Files: packages/plugins/lcyt-rtmp/src/routes/stream-hls.js, packages/lcyt-backend/src/routes/video.js, packages/plugins/lcyt-rtmp/src/routes/radio.js

- `LCYT_WEB_URL` â€” Public web UI base URL used by MCP and DSK.
  - Files: packages/lcyt-mcp-http/src/speech.js, packages/lcyt-mcp-http/src/server.js, docker-compose.yml

- `SPEECH_PUBLIC_URL` â€” Public URL used by MCP speech/ASR capture endpoints.
  - Files: packages/lcyt-mcp-http/src/speech.js, packages/lcyt-mcp-http/src/server.js, docker-compose.yml

- `LCYT_LOG_STDERR` â€” If '1', route logs to stderr (used by MCP stdio).
  - Files: packages/lcyt-mcp-stdio/Dockerfile, docs/mcp/http.md, docs/mcp/stdio.md, packages/lcyt-cli/bin/lcyt

- `MCP_SESSION_TTL_MS` â€” Session TTL (ms) specific to MCP sessions.
  - Files: packages/lcyt-mcp-http/src/server.js, docker-compose.yml

- `FILES_BASE_DIR` â€” Alias/default base dir for files operations.
  - Files: packages/lcyt-backend/src/caption-files.js, packages/lcyt-backend/src/routes/files.js, packages/lcyt-backend/test/files.test.js

- `CEA708_OFFSET_MS`, `CEA708_DURATION_MS`, `CEA708_MAX_BACKTRACK_MS` â€” CEA-708 caption timing offsets.
  - Files: packages/plugins/lcyt-rtmp/src/rtmp-manager.js

- `DOTENV_KEY` â€” Optional key used in lcyt-bridge built bundle to read dotenv values.
  - Files: packages/lcyt-bridge/dist/bundle.cjs

---

If you'd like, I can:
- Commit these two files in a branch and open a PR.
- Expand `docs/env-vars.md` into separate per-service env examples (`packages/lcyt-backend/.env.example`, `packages/lcyt-mcp-http/.env.example`, etc.).

## Compute fleet and STT (added 2026-10-06)

- `FFMPEG_RUNNER` â€” `spawn` (default), `local`, `docker` or `fleet`. `worker` was removed.
  - Files: packages/lcyt-compute/src/ffmpeg/index.js
- `FFFLEET_URL`, `FFFLEET_CLIENT_ID`, `FFFLEET_CLIENT_SECRET`, `FFFLEET_TOKEN`, `FFFLEET_FALLBACK` â€” fffleet orchestrator address, login and local fallback (`none` fails instead of running ffmpeg here).
  - Files: packages/lcyt-compute/src/ffmpeg/fleet-runner.js, packages/plugins/lcyt-production/src/perception-manager.js
- `DSK_RENDER_EXECUTOR` â€” `local` (default) or `fleet` (per-viewport DSK streams as fffleet jobs; needs `DSK_PAGE_BASE_URL`).
  - Files: packages/plugins/lcyt-dsk/src/renderer.js, packages/plugins/lcyt-dsk/src/fleet-viewports.js
- `STT_PROVIDER` â€” `google`, `whisper_http`, `openai` or `auditor`; `STT_AUDIO_SOURCE` â€” `hls`, `rtmp` or `whep` (ignored by `auditor`).
  - Files: packages/plugins/lcyt-rtmp/src/stt-manager.js
- `AUDITOR_STT_URL`, `AUDITOR_STT_API_KEY`, `AUDITOR_STT_SOURCE_URL` â€” liturgos-auditor service address, key and the stream URL it pulls (`{streamKey}` template).
  - Files: packages/plugins/lcyt-rtmp/src/stt-adapters/auditor-live.js, packages/lcyt-backend/src/settings/registry.js


