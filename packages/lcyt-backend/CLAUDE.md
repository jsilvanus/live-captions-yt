# `packages/lcyt-backend` — Express Relay Backend (v1.0.0)

HTTP relay: clients authenticate with API keys + JWT tokens, backend sends captions to YouTube on their behalf. Supports multi-user sessions, user account registration/login, and per-user project key management.

**Entry:** `src/index.js` (graceful shutdown: SIGTERM/SIGINT, closes sender/DB/server)
**App factory:** `src/server.js`

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `FFMPEG_RUNNER` | ffmpeg execution backend: `local` (default), `docker`, `worker` | `local` |
| `FFMPEG_IMAGE` | Docker image for ffmpeg when `FFMPEG_RUNNER=docker` | none |
| `DOCKER_BUILD_TIMEOUT_MS` | Timeout for Docker image builds (ms) | none |
| `WORKER_DAEMON_URL` | Worker daemon URL when `FFMPEG_RUNNER=worker` | none |
| `BRIDGE_DOWNLOAD_BASE_URL` | Base URL for bridge agent downloads | none |
| `BACKUP_DAYS` | Number of daily DB backups to retain | none |
| `BACKUP_DIR` | Directory for DB backup files | none |
| `ICONS_DIR` | Directory for icon assets served at `/icons/*` | none |
| `BACKEND_URL` | Server's own URL (used internally for DSK renderer etc.) | none |
| `FFMPEG_WRAPPER` | Custom ffmpeg wrapper script path | none |
| `JWT_SECRET` | HS256 signing key | auto-generated (warns) |
| `ADMIN_KEY` | Admin endpoint auth | none (disables admin) |
| `DB_PATH` | SQLite file path | `./lcyt-backend.db` |
| `SESSION_TTL` | Session timeout (ms) | 7200000 (2h) |
| `CLEANUP_INTERVAL` | Session cleanup sweep interval (ms) | 300000 (5m) |
| `PORT` | HTTP port | 3000 |
| `STATIC_DIR` | Serve static files from this directory | none |
| `PUBLIC_URL` | Server's public URL (used in generated .env files) | none |
| `TRUST_PROXY` | Express `trust proxy` value | `true` |
| `REVOKED_KEY_TTL_DAYS` | Days before revoked keys are purged | 30 |
| `REVOKED_KEY_CLEANUP_INTERVAL` | Revoked key cleanup interval (ms) | 86400000 (24h) |
| `ALLOWED_DOMAINS` | Comma-separated domains for session CORS filter | `lcyt.fi,www.lcyt.fi,localhost` |
| `ALLOWED_RTMP_DOMAINS` | Domains allowed to use `/stream` relay endpoints; falls back to `ALLOWED_DOMAINS` | (falls back) |
| `USAGE_PUBLIC` | If set, /usage endpoint needs no auth | unset |
| `FREE_APIKEY_ACTIVE` | If set to `1`, enables free API key self-registration endpoint | unset |
| `USE_USER_LOGINS` | Set to `0` to disable user registration/login (`/auth` routes) | enabled |
| `FEATURE_GATE_ENFORCE` | If set to `1`, enables feature-gate middleware on `/captions`, `/mic`, `/stats` (Phase 2 of plan_userprojects) | unset (gates are no-ops by default) |
| `HLS_SUBS_ROOT` | Directory for WebVTT subtitle segment files | `/tmp/hls-subs` |
| `HLS_SUBS_SEGMENT_DURATION` | Subtitle segment length in seconds | `6` |
| `HLS_SUBS_WINDOW_SIZE` | Number of subtitle segments to keep per language | `10` |
| `HLS_ROOT` | HLS output directory for video+audio streams | `/tmp/hls-video` |
| `HLS_LOCAL_RTMP` | Local nginx-rtmp base URL for HLS/preview | `rtmp://127.0.0.1:1935` |
| `HLS_RTMP_APP` | RTMP application name for HLS/preview | `live` |
| `RADIO_HLS_ROOT` | HLS output directory for audio-only streams (ffmpeg mode) | `/tmp/hls` |
| `RADIO_LOCAL_RTMP` | Local nginx-rtmp URL for radio streams (ffmpeg mode) | `rtmp://127.0.0.1:1935` |
| `RADIO_RTMP_APP` | RTMP application name for radio (ffmpeg mode) | `live` |
| `RADIO_HLS_SOURCE` | Radio HLS backend: `ffmpeg` (default) or `mediamtx` (no ffmpeg, uses MediaMTX) | `ffmpeg` |
| `MEDIAMTX_HLS_BASE_URL` | MediaMTX HLS base URL used by NginxManager for internal proxy_pass directives | `http://127.0.0.1:8080` |
| `NGINX_RADIO_CONFIG_PATH` | Path to nginx include file managed by NginxManager; empty = no-op mode | (unset) |
| `NGINX_TEST_CMD` | Command to test nginx config before reloading | `nginx -t` |
| `NGINX_RELOAD_CMD` | Command to reload nginx after NginxManager writes config | `nginx -s reload` |
| `NGINX_RADIO_PREFIX` | Public URL prefix for slug-based radio proxy locations | `/r` |
| `RTMP_HOST` | RTMP host for RTMP relay | none |
| `RTMP_APP` / `RTMP_APPLICATION` | RTMP application name for relay | none |
| `RTMP_RELAY_ACTIVE` | If set to `1`, enables RTMP relay functionality | unset |
| `RTMP_CONTROL_URL` | nginx-rtmp control URL (legacy fallback for `dropPublisher`) | none |
| `MEDIAMTX_API_URL` | MediaMTX v3 REST API base URL; activates MediaMTX `dropPublisher` path when set | none |
| `MEDIAMTX_API_USER` | Basic-auth username for the MediaMTX API | none |
| `MEDIAMTX_API_PASSWORD` | Basic-auth password for the MediaMTX API | none |
| `PREVIEW_ROOT` | Directory for JPEG thumbnail files | `/tmp/previews` |
| `PREVIEW_INTERVAL_S` | Seconds between thumbnail updates | `5` |
| `GRAPHICS_DIR` | Image storage directory for DSK overlays | `/data/images` |
| `GRAPHICS_ENABLED` | If set to `1`, enables image upload/management | unset |
| `GRAPHICS_MAX_FILE_BYTES` | Max uploaded image size in bytes | 5242880 (5 MB) |
| `GRAPHICS_MAX_STORAGE_BYTES` | Max total image storage per key in bytes | 52428800 (50 MB) |
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Web client ID (for client-side token flow) | none |
| `CONTACT_EMAIL` | Contact info returned by `GET /contact` | none |
| `CONTACT_NAME` | Contact name returned by `GET /contact` | none |
| `CONTACT_PHONE` | Contact phone returned by `GET /contact` | none |
| `CONTACT_WEBSITE` | Contact website returned by `GET /contact` | none |
| `FILES_DIR` | Local directory for per-key caption files (local adapter) | `/data/files` |
| `FILE_STORAGE` | Caption file storage backend: `local` (default) or `s3` | `local` |
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | none |
| `S3_REGION` | S3 region (or `auto` for Cloudflare R2) | `auto` |
| `S3_ENDPOINT` | Custom S3-compatible endpoint URL (R2, MinIO, Backblaze B2) | none |
| `S3_PREFIX` | Object key prefix within the bucket | `captions` |
| `S3_ACCESS_KEY_ID` | Static S3 credentials access key | none (uses AWS credential chain) |
| `S3_SECRET_ACCESS_KEY` | Static S3 credentials secret | none |
| `CEA` | Enable CEA-608/708 caption encoding (experimental) | unset |
| `PLAYWRIGHT_DSK_CHROMIUM` | Path to Chromium binary for DSK renderer | Playwright cache path |
| `DSK_LOCAL_SERVER` | Local server URL used by DSK renderer | `http://localhost:$PORT` |
| `DSK_LOCAL_RTMP` | Local nginx-rtmp base URL for DSK RTMP output | `rtmp://127.0.0.1:1935` |
| `DSK_RTMP_APP` | RTMP application name for DSK renderer output | `live` |
| `STT_PROVIDER` | Default STT provider: `google`, `whisper_http`, `openai` | `google` |
| `STT_DEFAULT_LANGUAGE` | Default BCP-47 language tag for STT | `en-US` |
| `STT_AUDIO_SOURCE` | Default audio source for STT: `hls`, `rtmp`, `whep` | `hls` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google service account JSON (for OAuth2 STT) | none |
| `GOOGLE_STT_KEY` | Google Cloud STT REST API key (simpler alternative to service account) | none |
| `GOOGLE_STT_MODE` | Google STT mode: `rest` (default) or `grpc` (lower latency; requires `@google-cloud/speech`) | `rest` |
| `WHISPER_HTTP_URL` | Base URL of a Whisper-compatible HTTP STT server | none |
| `WHISPER_HTTP_MODEL` | Model name to request from the Whisper HTTP server | none |
| `OPENAI_STT_URL` | Base URL for OpenAI-compatible STT endpoint | OpenAI default |
| `OPENAI_STT_API_KEY` | API key for OpenAI STT endpoint | none |
| `OPENAI_STT_MODEL` | Model name for OpenAI STT requests | `whisper-1` |
| `EMBEDDING_API_URL` | Base URL for embedding API (server-level default) | `https://api.openai.com` |
| `EMBEDDING_API_KEY` | API key for the embedding provider (server-level) | none |
| `EMBEDDING_MODEL` | Embedding model name (server-level) | `text-embedding-3-small` |

**API routes:**
```
GET  /health              — uptime, session count, login state
GET  /contact             — server contact info (public)

POST /auth/register       — create user account (email + password)
POST /auth/login          — authenticate user → returns user JWT
GET  /auth/me             — current user info (user Bearer token)
POST /auth/change-password — change password (user Bearer token)

POST /live                — register session → returns session JWT
GET  /live                — session status (Bearer token)
DELETE /live              — tear down session (Bearer token)
POST /captions            — queue caption(s) → 202 { ok, requestId } (Bearer token)
GET  /events              — SSE stream of caption delivery results (Bearer token or ?token=)
POST /sync                — NTP clock sync (Bearer token)
GET  /stats               — per-key usage stats (Bearer token)
DELETE /stats             — GDPR right-to-erasure: anonymise key and delete personal data (Bearer token)
GET  /file                — list caption files saved for the authenticated key (Bearer token)
GET  /file/:id            — download a caption file (Bearer token or ?token=)
DELETE /file/:id          — delete a caption file (Bearer token)
GET  /usage               — per-domain caption stats (public if USAGE_PUBLIC, else X-Admin-Key)
POST /mic                 — claim/release soft mic lock for collaborative sessions (Bearer token)

GET/POST/PATCH/DELETE /keys — admin CRUD (X-Admin-Key header) OR user project CRUD (user Bearer token)
  POST   /keys?freetier   — self-service free-tier key sign-up (requires FREE_APIKEY_ACTIVE=1)

GET  /video/:key              — HLS.js player page (public, CORS *, iframe-embeddable)
GET  /video/:key/master.m3u8  — HLS master manifest (video + subtitle tracks, public)
GET  /video/:key/subs/:lang/playlist.m3u8 — HLS subtitle playlist per language (public)
GET  /video/:key/subs/:lang/:seg.vtt      — WebVTT subtitle segment file (public)
GET  /viewer/:key         — public SSE broadcast stream (no auth, CORS *); viewer targets subscribe here
GET  /stream-hls/:key/*   — HLS video+audio segments and playlist (public, rate-limited)
GET  /radio/:key/*        — audio-only HLS segments and playlist (public, rate-limited)
GET  /preview/:key/incoming.jpg — latest RTMP → JPEG thumbnail (public)

GET  /dsk/:apikey/images           — list DSK overlay images for an API key (public)
GET  /dsk/:apikey/events           — SSE stream of graphics events for DSK page (public)
GET  /dsk/:apikey/viewports/public — list public viewport definitions (public)
GET/POST/PUT/DELETE /dsk/:apikey/templates — DSK template CRUD (JWT Bearer or X-API-Key)
POST /dsk/:apikey/templates/:id/activate   — activate a template in renderer (JWT Bearer or X-API-Key)
POST /dsk/:apikey/template         — render a one-off template (JWT Bearer or X-API-Key)
POST /dsk/:apikey/broadcast        — push live data to renderer without reload (JWT Bearer or X-API-Key)
GET  /dsk/:apikey/renderer/status  — renderer running state (JWT Bearer or X-API-Key)
POST /dsk/:apikey/renderer/start   — start RTMP capture for a key (JWT Bearer or X-API-Key)
POST /dsk/:apikey/renderer/stop    — stop RTMP capture for a key (JWT Bearer or X-API-Key)
GET/POST/PUT/DELETE /dsk/:apikey/viewports — viewport CRUD (JWT Bearer or X-API-Key)
POST /dsk-rtmp/on_publish          — nginx-rtmp on_publish callback for DSK RTMP
POST /dsk-rtmp/on_publish_done     — nginx-rtmp on_publish_done callback for DSK RTMP

GET/POST/PUT/DELETE /images/:id — image upload/management for DSK overlays (JWT Bearer or X-API-Key)
GET  /youtube/config      — return YOUTUBE_CLIENT_ID for client-side OAuth (Bearer token)
GET/POST/PUT/DELETE /rtmp — RTMP relay slot management (Bearer token)
GET/POST /stream          — RTMP relay stream control (Bearer token + domain allowlist)

GET  /production/cameras  — list cameras (admin key)
POST /production/cameras  — create camera
PUT/DELETE /production/cameras/:id — update/delete camera
POST /production/cameras/:id/preset/:preset — trigger camera PTZ preset
GET  /production/mixers   — list mixers with connection status
POST /production/mixers   — create mixer
PUT/DELETE /production/mixers/:id — update/delete mixer
POST /production/mixers/:id/switch — switch mixer source
GET  /production/bridge/commands?token=xxx — SSE stream for bridge agents
POST /production/bridge/status — bridge heartbeat + command result callback
GET/POST/DELETE /production/bridge/instances — bridge instance CRUD

GET  /icons/*             — icon assets (authenticated)

GET/POST/PUT/DELETE /production/device-roles — device role CRUD (admin or user Bearer)
GET  /production/device-roles/:code/auth     — device role pin-code authentication

GET  /keys/:key/features — list project feature flags (user Bearer)
PUT  /keys/:key/features — update project feature flags (user Bearer)

GET  /keys/:key/members  — list project members (user Bearer)
POST /keys/:key/members  — invite member (user Bearer)
PUT  /keys/:key/members/:userId — update member role (user Bearer)
DELETE /keys/:key/members/:userId — remove member (user Bearer)

GET  /bridge/download/:platform — download pre-built bridge agent binary

GET  /stt/status          — current STT session state for the authenticated API key (Bearer token)
POST /stt/start           — start server-side STT { provider?, language?, audioSource?, streamKey?, confidenceThreshold? } (Bearer token)
POST /stt/stop            — stop STT session (Bearer token)
GET  /stt/events          — SSE stream of transcript events (Bearer token or ?token=)
GET  /stt/config          — get per-key STT config from DB (Bearer token)
PUT  /stt/config          — update per-key STT config (Bearer token)

GET/POST/PUT/DELETE /cues/rules — cue rule CRUD (Bearer token)
GET  /cues/events         — list recent cue events (Bearer token)

GET  /ai/config           — get per-key AI/embedding config (Bearer token)
PUT  /ai/config           — update AI provider, model, key, threshold (Bearer token)
GET  /ai/status           — server embedding capability info (Bearer token)

GET  /agent/status        — agent capabilities and config state (Bearer token)
GET  /agent/context       — current AI context window (Bearer token)
POST /agent/context       — add a context entry manually (Bearer token)
DELETE /agent/context     — clear context window (Bearer token)
GET  /agent/events        — recent agent events (Bearer token)

GET/POST/PUT/DELETE /connectors                              — API Connector CRUD, auth_config masked (Bearer token)
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests       — nested Request CRUD (Bearer token)
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests/:requestSlug/mappings — response mapping CRUD (Bearer token)
GET    /variables         — { [name]: { value, source, defaultValue, resolvedAt } } snapshot (Bearer token)
GET    /variables/events  — SSE: variable_updated (Bearer token or ?token=)
POST/PUT/DELETE /variables[/:name] — manual variable CRUD (Bearer token)
POST   /variables/refresh — fire a connector request; { connectorSlug, requestSlug, waitMs? } (Bearer token)
GET/POST/DELETE /admin/connector-network-rules[/:id] — global outbound-connector SSRF allow/deny rules (X-Admin-Key or is_admin user)
GET/POST/DELETE /orgs/:orgId/connector-network-rules[/:id] — per-org SSRF allow/deny rules, enforced (user Bearer token; GET for any org member, write for owner/admin)

GET    /admin/users                  — list users with search (X-Admin-Key)
GET    /admin/users/:id              — user detail with projects (X-Admin-Key)
POST   /admin/users                  — create user (X-Admin-Key)
PATCH  /admin/users/:id              — update user name/active (X-Admin-Key)
POST   /admin/users/:id/set-password — admin password reset (X-Admin-Key)
DELETE /admin/users/:id              — delete user (X-Admin-Key)
GET    /admin/users/:id/features     — list user feature entitlements (X-Admin-Key)
PATCH  /admin/users/:id/features     — grant/revoke user feature entitlements (X-Admin-Key)
GET    /admin/projects               — list projects with search (X-Admin-Key)
GET    /admin/projects/:key          — project detail + features + members (X-Admin-Key)
PATCH  /admin/projects/:key          — update project (X-Admin-Key)
PUT    /admin/projects/:key/features — batch update features (X-Admin-Key)
POST   /admin/batch/users            — batch user operations (X-Admin-Key)
POST   /admin/batch/projects         — batch project operations (X-Admin-Key)
GET    /admin/feature-policies                    — list tri-state site feature policies (available/self_service/denied) (X-Admin-Key)
PUT    /admin/feature-policies/:code              — set a site-wide feature policy mode (X-Admin-Key)
GET    /admin/orgs/:id/feature-overrides           — list an org's per-feature policy overrides (X-Admin-Key)
PUT    /admin/orgs/:id/feature-overrides/:code     — set an org-level override; { mode: null } clears it (X-Admin-Key)
```

**Key internals:**
- `src/db.js` — Re-exports from `src/db/index.js` (modular). `better-sqlite3` (synchronous). Core tables: `users`, `api_keys` (with `user_id` FK, and now `org_id` FK), `caption_usage`, `session_stats`, `caption_errors`, `sessions`. Additional tables for graphics, radio, HLS, RTMP relay, and production control. Additive migrations run on startup.
- `src/db/schema.js` — also defines `organizations` and `org_members` (schema-only so far, from `plan_team_org_backend.md` — no org CRUD/membership routes yet, `/team` is still a "Coming soon" placeholder) and `site_feature_policies`/`org_feature_overrides` (`plan_site_feature_policies.md` — tri-state `available`/`self_service`/`denied` policy per feature code, with per-org overrides; `resolveFeaturePolicy(db, apiKey, featureCode)` in `src/db/project-features.js` implements the baseline-plus-override resolution and is wired into `routes/project-features.js`'s self-service toggle route). Admin management of these lives in `routes/admin.js` (`GET/PUT /admin/feature-policies`, `GET/PUT /admin/orgs/:id/feature-overrides`) — no admin frontend page for it yet.
- `src/store.js` — In-memory session store. Session = `{ sessionId, apiKey, streamKey, domain, sender, extraTargets, token, startedAt, lastActivity, sequence, syncOffset, emitter, _sendQueue }`. `sender` is null in target-array mode. `extraTargets` holds all targets including `youtube`, `viewer`, and `generic` types. `emitter` is a per-session `EventEmitter` for SSE routing. `_sendQueue` serialises concurrent YouTube sends so sequence numbers stay monotonic.
- `src/routes/stt.js` — `createSttRouter()`: server-side STT routes (`/stt/*`). Delegates to `SttManager` from `lcyt-rtmp`. Supports `google`, `whisper_http`, `openai` providers and `hls`, `rtmp`, `whep` audio sources. **SSE events** on `GET /stt/events`: `connected`, `transcript`, `stt_started`, `stt_stopped`, `stt_error`.
- `src/middleware/auth.js` — JWT Bearer verification (session tokens: `{ sessionId, apiKey }`).
- `src/middleware/feature-gate.js` — `createRequireFeature(db, code)` + `createRequireKeyFeature(db, code)`: opt-in feature gate middleware, no-op unless `FEATURE_GATE_ENFORCE=1`.
- `src/routes/admin.js` — `createAdminRouter(db)`: admin panel routes (`/admin/*`). User CRUD with search/pagination, project management with cross-entity `user:email` search, batch operations (activate/deactivate/delete users; revoke/activate/delete projects), feature flag management, user feature entitlement management (`GET/PATCH /admin/users/:id/features`). All routes require `X-Admin-Key` header.
- The RTMP/HLS/radio/preview/STT managers previously lived in `lcyt-backend`; they were extracted to `packages/plugins/lcyt-rtmp`. The backend imports them via `import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp'`.
- The Cue Engine (`lcyt-cues`) provides inline cue metacode processing, phrase/fuzzy/semantic/event matching, sound-cue listeners, and CRUD routes. Imported via `import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues'`.
- The AI Agent (`lcyt-agent`) owns AI configuration, embedding computation, context window management, and LLM-based event cue evaluation. Imported via `import { initAgent, createAgentRouter, createAiRouter, computeEmbeddings } from 'lcyt-agent'`.
- `src/ai/index.js` — Backward-compatible re-exports from `lcyt-agent` so existing imports from `lcyt-backend/src/ai/` continue to work.
- API Connectors & Variables (`lcyt-connectors`) owns the `{{ }}` variable system and outbound API connector CRUD/resolution engine. Imported via `import { initConnectors, createConnectorsRouter, createVariablesRouter } from 'lcyt-connectors'`; `initConnectors(db, { filesControl: { resolveStorage } })` runs its own migrations and returns `{ bus, engine }`.
- `src/middleware/user-auth.js` — JWT Bearer verification for user tokens (`{ type: 'user', userId, email }`).
- `src/middleware/cors.js` — Dynamic CORS: only allows registered session domains; never exposes admin routes.
- `src/middleware/admin.js` — `X-Admin-Key` constant-time comparison.
- `src/caption-files.js` — Pure caption-text utilities: `composeCaptionText`, `formatVttTime`, `buildVttCue`. File I/O was extracted to `lcyt-files`.
- `src/backup.js` — DB backup utilities.
- `src/dsk-bus.js` — `DskBus`: DSK graphics SSE subscriber registry and per-key graphics state, extracted from SessionStore so `lcyt-dsk` does not depend on session lifecycle.
- `src/ffmpeg/index.js` — ffmpeg runner factory: selects `local-runner`, `docker-runner`, or `worker-runner` based on `FFMPEG_RUNNER` env var. Exports `createFfmpegRunner()`.
- `src/ffmpeg/local-runner.js` — Spawns ffmpeg directly via `child_process.spawn`.
- `src/ffmpeg/docker-runner.js` — Runs ffmpeg inside a Docker container (`FFMPEG_IMAGE`).
- `src/ffmpeg/worker-runner.js` — Delegates ffmpeg jobs to the worker daemon (`WORKER_DAEMON_URL`).
- `src/ffmpeg/pipe-utils.js` — Shared pipe/stream utilities for ffmpeg runners.
- `src/storage/s3.js` — S3 upload utilities (used by backend-level S3 operations).
- `src/routes/device-roles.js` — Device role CRUD + pin-code auth for production devices.
- `src/routes/project-features.js` — Per-project feature flag CRUD.
- `src/routes/project-members.js` — Project membership CRUD (invite, role update, remove).
- `src/routes/bridge-download.js` — Bridge agent binary download endpoint.
- `src/routes/account.js` — User account routes (profile, settings).
- `src/routes/session.js` — Session management routes.
- `src/routes/content.js` — Content router factory (aggregates file, video, viewer routes).
- `src/db/device-roles.js` — Device role DB helpers (`prod_device_roles` table).
- `src/db/project-features.js` — Project feature flag DB helpers (`project_features` table).
- `src/db/project-members.js` — Project membership DB helpers (`project_members` table).
- `src/db/users.js` — User CRUD (`createUser`, `getUserByEmail`, `getUserById`, `updateUserPassword`).
- `src/db/index.js` — DB init + all table migrations (users, api_keys, sessions, etc.); re-exported by `src/db.js`.
- `src/routes/auth.js` — User registration/login/me/change-password routes.
- `src/routes/keys.js` — API key CRUD (admin + user project management).
- `src/routes/events.js` — SSE delivery-result stream (authenticated, session owner).
- `src/routes/viewer.js` — Public SSE broadcast stream `GET /viewer/:key` — no auth, CORS `*`.
- `src/routes/radio.js` — Audio-only HLS streaming (public, rate-limited).
- `src/routes/stream-hls.js` — Video+audio HLS streaming (public, rate-limited).
- `src/routes/preview.js` — RTMP → JPEG thumbnail serving (public).
- `src/routes/youtube.js` — YouTube OAuth client ID endpoint.
- `src/routes/video.js` — `GET /video/:key` — HLS.js player, master manifest, subtitle playlist + segment serving.
- `src/routes/stats.js` — Per-key usage stats + GDPR erasure.
- `src/routes/usage.js` — Per-domain caption statistics.
- `src/routes/mic.js` — Soft mic lock for collaborative sessions.

**SSE events** (on `GET /events`): `connected`, `caption_result`, `caption_error`, `session_closed`, `mic_state`, `cue_fired`. Plugin events are forwarded generically via `session.emitter.emit('event', { type, data })`.

**Admin CLI:** `bin/lcyt-backend-admin` — local key management + user management.
- Key commands: `list`, `add`, `update`, `revoke`, `delete`, `renew`, `info`, `clean`
- User commands: `users list`, `users info`, `users add`, `users set-password`, `users deactivate`, `users activate`, `users delete`

**Docker:** `Dockerfile` — node:20-slim, exposes port 3000.

**Tests:** `packages/lcyt-backend/test/*.test.js` — uses `node:test`.

## Authentication

1. **Session JWT Bearer** (`Authorization: Bearer <token>`) — session-level; payload `{ sessionId, apiKey }`. Used for `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic`.
2. **User JWT Bearer** (`Authorization: Bearer <token>`) — user-level; payload `{ type: 'user', userId, email }`. Used for `/auth/me`, `/auth/change-password`, user-owned `/keys` routes. 30-day TTL.
3. **Admin API key** (`X-Admin-Key` header) — server-level; for `/keys` admin routes. Uses constant-time comparison.
4. **DSK Editor API key** (`X-API-Key` header) — API key auth for DSK template management and image routes (no live session required). Falls through to JWT Bearer if header absent (`editorAuthOrBearer` middleware).
5. Sessions are ephemeral (in-memory). Session ID = SHA-256 of `apiKey:streamKey:domain` where `streamKey` defaults to `''` in target-array mode.

## User Management

User accounts (`USE_USER_LOGINS` is enabled by default; set to `0` to disable):
- Users register with email + password via `POST /auth/register`.
- Login returns a 30-day user JWT via `POST /auth/login`.
- Authenticated users can create/rename/revoke their own API keys (projects) via `GET/POST/PATCH/DELETE /keys` with a user Bearer token.
- The `api_keys` table has a `user_id` FK linking project keys to their owner.
- Admin CLI supports full user CRUD: `lcyt-backend-admin users [list|info|add|set-password|deactivate|activate|delete]`.

## Test Coverage

**Test files:** 26 test files (608 tests total as of 2026-03-17) covering all primary routes plus newly added tests. RTMP/HLS/preview manager tests moved to `packages/plugins/lcyt-rtmp/test/`.

**Added 2026-03-16:**
- `test/auth.test.js` (20 tests) — Full auth lifecycle with in-memory SQLite: register, login, `GET /me`, `POST /change-password`, disabled logins (503).
- `test/video.test.js` (17 tests) — HLS player HTML (themes, CORS, Cache-Control), master manifest, subtitle playlist, segment serving, CORS preflight. Uses lightweight mock managers.
- `test/preview-route.test.js` (10 tests) — JPEG thumbnail serving with real temp-dir JPEG; key validation, 404, 200, CORS, Cache-Control, If-Modified-Since, OPTIONS.
- `test/stream.test.js` (22 tests) — RTMP relay slot CRUD with in-memory DB + mock `RtmpRelayManager`: auth, `relay_allowed` check, POST/GET/PUT/DELETE /stream, PUT /stream/active.

**Added 2026-03-17:**
- `test/cors.test.js` (19 tests) — `createCorsMiddleware`: free-tier signup, admin routes (no CORS), permissive routes (POST /live, GET /health, GET /contact, OPTIONS), dynamic origin matching via session store.
- `test/caption-files.test.js` (21 tests) — Pure-function exports: `composeCaptionText` (all translation/showOriginal branches), `formatVttTime` (edge cases: 0ms, sub-second, multi-hour), `buildVttCue` (format, end newline).

**Added 2026-03-29:**
- `test/admin.test.js` (32 tests) — Admin panel API (`/admin/*`): auth enforcement, user CRUD with search/pagination, user detail with projects, create/update/deactivate/delete users, admin password reset, project listing with cross-entity `user:email` search, project detail with features/members, project update, feature batch update, batch user operations (activate/deactivate/delete), batch project operations (revoke/activate/delete/features).

**Gaps (Low):**
- **Core:** `server.js` (Express factory), `index.js` (graceful shutdown on SIGTERM/SIGINT), `routes/stt.js` (server-side STT routes).
- **DB:** `db/sequences.js`, `db/helpers.js`.

---

See root `CLAUDE.md` for the Caption Target Architecture and Plugin Architecture conventions, and each plugin's own `CLAUDE.md` (`packages/plugins/*`) for the managers this backend wires in.
