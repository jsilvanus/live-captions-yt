# `packages/lcyt-backend` — Express Relay Backend (v1.0.0)

HTTP relay: clients authenticate with API keys + JWT tokens, backend sends captions to YouTube on their behalf. Supports multi-user sessions, user account registration/login, and per-user project key management.

**Entry:** `src/index.js` (graceful shutdown: SIGTERM/SIGINT, closes sender/DB/server)
**App factory:** `src/server.js`

**Database convention:** keep route handlers thin and put SQL/query helpers in `src/db/*.js` modules (for example `src/db/keys.js`, `src/db/users.js`, `src/db/orgs.js`). New backend data access should follow that pattern rather than embedding raw SQL directly in route files.

**Server settings (`plan_env_to_ui_settings.md`):** `src/settings/registry.js` is the authoritative enumeration of every setting below — types, defaults, and an `apply` mode (`hot`/`timer`/`manager`/`restart`) documenting whether a DB-saved value (via `GET/PUT/DELETE /admin/server-settings`, Admin → Server in `lcyt-web`) takes effect immediately or needs a restart. Precedence is env > DB > registry default; env-set values show as "env-locked" in the admin UI. Where this table below and the registry disagree, the registry (and the actual read site) wins — this table is retained as a human-readable reference of the env-var names and their historical defaults, not re-derived per edit. Wired to `SettingsService`: `lcyt-backend`'s own read sites (Application/Contact/Sessions & Retention categories, plus `RTMP_RELAY_ACTIVE`/`MUSIC_DETECTION_ACTIVE` route-mount gates — request-time hot gates, not module-load `if`s), `lcyt-files` (`FILE_STORAGE`/`S3_*`), `lcyt-music` (`MEDIAMTX_HLS_BASE_URL`, `HLS_LOCAL_RTMP`/`HLS_RTMP_APP`, `MUSIC_CLASSIFIER_URL`), `lcyt-rtmp` (relay/crop/STT/radio/HLS/preview managers — CEA-708 timing is genuinely hot now), `lcyt-dsk` (image upload gate/limits, DSK RTMP + renderer URLs), `lcyt-production`'s `MediaMtxClient`, and `lcyt-agent`'s embedding functions (server-default provider path; per-project `ai_config` still wins). **Not yet wired** (small, newly discovered, registered but still env-only in practice): `lcyt-agent`'s `VISION_PREVIEW_BASE_URL` and `lcyt-production`'s `CAMERA_PREVIEW_BASE_URL`/`CAMERA_THUMBNAILS_DIR` — see `CONSIDER.md`.

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
| `VIDEOS_STORAGE_DIR` | Local directory MediaMTX recordings + VOD playback artifacts are written to/served from | `./recordings` |
| `RECORDING_UPLOAD_DELAY_MS` | Grace delay before an S3-backed recording's local files are read for upload, to let MediaMTX flush the final segment after `record:no` | `3000` |
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
| `EVENT_LOG_RETENTION_DAYS` | Days before `bus_events` audit rows are purged (0 disables) | 30 |
| `EVENT_LOG_CLEANUP_INTERVAL` | `bus_events` cleanup interval (ms) | 86400000 (24h) |
| `METRICS_TOKEN` | Bearer token for `GET /metrics` (Prometheus scrape); endpoint 404s when unset | unset (disabled) |
| `METRICS_PROJECT_LABELS` | Set to `0` to drop the per-project label on Prometheus business series (bounded cardinality opt-out) | enabled |
| `USAGE_FLUSH_INTERVAL_MS` | Usage-rollup buffer flush interval (ms) | 15000 |
| `USAGE_ROLLUP_HOURLY_RETENTION_DAYS` | Days before hourly `usage_rollups` rows are compacted into daily rows (0 disables) | 90 |
| `AUDIT_LOG_RETENTION_DAYS` | Days before `audit_log` rows are purged (0 disables) | 365 |
| `STATS_RETENTION_DAYS` | Opt-in sweep of historical stats tables (`session_stats`, `caption_errors`, … — never `caption_usage`); 0 = keep forever | 0 (disabled) |
| `ROLLUP_MAINTENANCE_INTERVAL` | Compaction/retention sweep interval (ms) | 86400000 (24h) |
| `ORCHESTRATOR_URL` | Orchestrator base URL for the burst-VM accounting poller (`/compute/burst/history`) | unset (poller off) |
| `LOGIN_RATE_LIMIT_MAX` | Max **failed** `/auth/login`+`/auth/register` attempts per IP per 15 min (0 disables) | 50 |
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
| `MUSIC_DETECTION_ACTIVE` | If set to `1`, mounts the `/music` server-side analysis routes (`lcyt-music`) | unset |
| `RTMP_CONTROL_URL` | nginx-rtmp control URL (legacy fallback for `dropPublisher`) | none |
| `MEDIAMTX_API_URL` | MediaMTX v3 REST API base URL; activates MediaMTX `dropPublisher` path when set | none |
| `MEDIAMTX_API_USER` | Basic-auth username for the MediaMTX API | none |
| `MEDIAMTX_API_PASSWORD` | Basic-auth password for the MediaMTX API | none |
| `MEDIAMTX_WEBRTC_BASE_URL` | MediaMTX WebRTC HTTP base URL (WHEP audio source for STT, WebRTC preview) | `http://127.0.0.1:8889` |
| `CROP_ZMQ_PORT_BASE` | First 127.0.0.1 port for per-process zmq binds (vertical-crop live repositioning) | `5560` |
| `CROP_OUTPUT_DEFAULT` | Vertical-crop delivery size when crop_config out_w/out_h are NULL | `1080x1920` |
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
| `DSK_RTMP_APP` | RTMP application name for DSK renderer output | `dsk` |
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
PATCH /auth/me            — update own profile (name) (user Bearer token)
GET  /auth/me/export      — export user's own account data (user Bearer token)
DELETE /auth/me/data      — delete user's owned projects, keep account (user Bearer token)
DELETE /auth/me           — full account deletion (user Bearer token)
POST /auth/change-password — change password (user Bearer token)

POST /live                — register session → returns session JWT
GET  /live                — session status (Bearer token)
DELETE /live              — tear down session (Bearer token)
POST /captions            — queue caption(s) → 202 { ok, requestId } (Bearer token); per-caption fileFormats { original|<lang>: 'text'|'youtube'|'vtt' } selects the backend caption-file format per language (default 'youtube' plain text)
GET  /events              — SSE stream of caption delivery results (Bearer token or ?token=)
GET  /events/stream       — unified SSE over the shared EventBus; canonical envelopes { topic, projectId, ts, data }; ?topics=dsk.*,cue.fired filter; project-access auth (session/user/project/device JWT or scoped lcytmcp_ token; external tokens need an events:read scope, topics further narrowed by tokenAllowsTopic). Additive — the bespoke per-plugin SSE endpoints are unchanged.
GET  /events/topics       — public catalog { baseScope, topics } of subscribable event-topic patterns; single source of truth for the Setup Hub scope picker (see routes/events-catalog.js). Includes per-variable topics: variable.<name>.changed (payload carries the new value); variable.* watches all.
POST /sync                — NTP clock sync (Bearer token)
GET  /stats               — per-key usage stats (Bearer token)
DELETE /stats             — GDPR right-to-erasure: anonymise key and delete personal data (Bearer token)
GET  /file                — list caption files saved for the authenticated key (Bearer token)
GET  /file/:id            — download a caption file (Bearer token or ?token=); ?offsetMs=±N shifts VTT cue times on the fly for VOD alignment (vtt files only)
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
GET  /radio/config        — Web Radio self-service metadata: { title, description, coverImageUrl, autoplay, enabled, live } (Bearer token)
PUT  /radio/config        — update title/description/coverImageUrl/autoplay (Bearer token)
GET  /preview/:key/incoming.jpg — latest RTMP → JPEG thumbnail (public)

GET  /crop/config         — vertical-crop config + renderer status (Bearer token; RTMP_RELAY_ACTIVE=1)
PUT  /crop/config         — update aspect/output/bitrate/transition/follow; starts/stops renderer mid-publish (Bearer token)
GET  /crop/status         — renderer state, active position/preset, repositionMode live|restart (Bearer token)
POST /crop/position       — { xNorm, yNorm, transitionMs? } free crop positioning (Bearer token)
GET/POST/PUT/DELETE /crop/presets[/:id] — crop preset CRUD; ?setId= filter (Bearer token)
POST /crop/presets/:id/activate — apply a preset live (Bearer token)
GET/POST/PUT/DELETE /crop/sets[/:id]    — preset-set (bank) CRUD; POST supports cloneFromSetId (Bearer token)
POST /crop/sets/:id/activate    — switch active set; re-applies same-named preset live (Bearer token)
GET/POST/DELETE /crop/source-map[/:id]  — production-follow mapping CRUD (Bearer token)

GET  /dsk/:apikey/images           — list DSK overlay images for an API key (public)
GET  /dsk/:apikey/events           — SSE stream of graphics events for DSK page (public)
GET  /dsk/:slugOrKey/viewports/public — list public viewport definitions + projectSlug (public; segment resolves public slug then raw api key)
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
POST /feed-rtmp/on_publish        — nginx-rtmp on_publish callback for named-feed RTMP ingest (plan_ingest_feeds.md §2a)
POST /feed-rtmp/on_publish_done   — nginx-rtmp on_publish_done callback for named-feed RTMP ingest
GET/POST /stream          — RTMP relay stream control (Bearer token + domain allowlist); slots may set sourceCameraId to relay from a named feed instead of the raw ingest, no cap on target count
GET  /ingestion/config    — RTMP ingest status: { video: {enabled,active,streamKey,ingestUrl,rotatable,live}, dsk: {enabled,ingestUrl,live} } (Bearer token; mounted only when RTMP_RELAY_ACTIVE=1)
PATCH /ingestion/config   — { video?: {enabled?}, dsk?: {enabled?} } — video flips relay_allowed (self-service, feature-gated on `ingest`); dsk is 501 (no real gate exists yet)
POST /ingestion/config/rotate — rotate the video ingest stream key, decoupling it from the api_key (Bearer token)

GET  /production/cameras  — list cameras (admin key)
POST /production/cameras  — create camera
PUT/DELETE /production/cameras/:id — update/delete camera
POST /production/cameras/:id/preset/:preset — trigger camera PTZ preset
POST /production/cameras/:id/thumbnail/capture — capture a still frame as this camera's thumbnail (webcam/mobile: from its own feed; amx/visca-ip: from the mixer program feed while this camera is live, body { apiKey, mixerId? })
GET  /production/cameras/:id/thumbnail[.jpg] — serve the saved thumbnail JPEG
GET  /production/mixers   — list mixers with connection status
POST /production/mixers   — create mixer
PUT/DELETE /production/mixers/:id — update/delete mixer
POST /production/mixers/:id/switch — switch mixer source
GET/POST /production/encoders — hardware encoder list/create (Monarch HD/HDX)
GET/PUT/DELETE /production/encoders/:id — encoder detail/update/delete
POST /production/encoders/:id/start|stop|test — encoder control (direct, frontend, or bridge-relayed)
GET  /production/bridge/commands?token=xxx — SSE stream for bridge agents
POST /production/bridge/status — bridge heartbeat + command result callback
GET/POST/DELETE /production/bridge/instances — bridge instance CRUD

GET  /icons/*             — icon assets (authenticated)

GET/POST/PUT/DELETE /production/device-roles — device role CRUD (admin or user Bearer)
GET  /production/device-roles/:code/auth     — device role pin-code authentication

GET  /keys/:key/features — list project feature flags (user Bearer)
PUT  /keys/:key/features — update project feature flags (user Bearer)

GET  /keys/:key/slug        — current public slug + org-policy required prefix (member or X-Admin-Key)
GET  /keys/:key/slug/check  — ?slug= availability probe with reason (member or X-Admin-Key)
PUT  /keys/:key/slug        — { slug: string|null } set/clear public slug; org prefix policy enforced for users, bypassed for X-Admin-Key

GET  /keys/:key/members  — list project members (user Bearer)
POST /keys/:key/members  — invite member (user Bearer)
PUT  /keys/:key/members/:userId — update member role (user Bearer)
DELETE /keys/:key/members/:userId — remove member (user Bearer)

GET  /bridge/download/:platform — download pre-built bridge agent binary

GET  /stt/status                       — current STT session state for the authenticated API key (Bearer token)
POST /stt/start                        — start server-side STT { provider?, language?, audioSource?, streamKey?, confidenceThreshold? } (Bearer token)
POST /stt/stop                         — stop STT session (Bearer token)
GET  /stt/events                       — SSE stream of transcript events (Bearer token or ?token=)
GET  /stt/config                       — get per-key STT config from DB (Bearer token)
PUT  /stt/config                       — update per-key STT config (Bearer token)
GET  /stt/source-languages             — get predefined source language list for the project (Bearer token; Phase 5)
POST /stt/source-languages             — add a language to the predefined list { lang, label?, sortOrder? } (Bearer token; Phase 5)
PUT  /stt/source-languages/:id         — update a source language entry (Bearer token; Phase 5)
DELETE /stt/source-languages/:id       — remove a source language from the predefined list (Bearer token; Phase 5)
POST /stt/config/source-language       — fast-switch active language { lang } — validates against predefined list, restarts STT if running (Bearer token; Phase 5)

GET    /targets           — list server-persisted caption delivery targets for the API key (Bearer token)
POST   /targets           — create a target { type, streamKey?/url?/headers?/viewerKey?, enabled?, noBatch? } (Bearer token)
PUT    /targets/:id       — update a target (Bearer token)
DELETE /targets/:id       — delete a target (Bearer token)
PUT    /targets/reorder   — persist a new sort order in one call, body { order: string[] } (Bearer token)

GET    /broadcasts              — list broadcasts (?status=, ?from=, ?to= calendar range, ?includeArchived=1) (plan/broadcasts; Bearer token)
POST   /broadcasts              — create a broadcast (draft) (Bearer token)
GET    /broadcasts/active       — active-broadcast pointer: { activeBroadcastId, broadcast, projectName } (plan/broadcasts_next; Bearer token)
DELETE /broadcasts/active       — clear the active-broadcast pointer (Bearer token)
POST   /broadcasts/:id/activate — set the project's active-broadcast pointer (404 unknown, 409 archived) (Bearer token)
GET    /broadcasts/:id          — one broadcast + linked reusable assets (Bearer token)
PUT    /broadcasts/:id          — edit title/description/schedule/status (Bearer token)
DELETE /broadcasts/:id          — first call archives (202); a second call on an already-archived broadcast hard-deletes it, but 409s until archived ≥ BROADCAST_ARCHIVE_MIN_AGE_DAYS (default 30). Hard delete nulls broadcast_id on produced rows (Bearer token)
POST   /broadcasts/:id/restore  — un-archive (Bearer token)
POST   /broadcasts/:id/duplicate — clone (title + reusable-asset links, never produced content); cross-project targetApiKey is 501 (deep-copy TODO) (Bearer token)
POST   /broadcasts/:id/assets            — link a reusable asset { assetType, assetRef, sortOrder? } (Bearer token)
DELETE /broadcasts/:id/assets/:rowId     — unlink a reusable asset (Bearer token)
GET    /broadcasts/:id/files             — list caption files pinned to this broadcast (broadcast_files join; rows carry { id: link-row id, fileId, filename, … }) (Bearer token)
POST   /broadcasts/:id/files             — pin a caption file { fileId } (Bearer token)
DELETE /broadcasts/:id/files/:fileId     — unpin a caption file (by caption_files id, not link-row id) (Bearer token)

GET    /translation/config              — combined read: { vendor, targets } (Bearer token)
PUT    /translation/config/vendor       — update vendor + credentials (Bearer token)
POST   /translation/config/targets      — create a language/destination translation target (Bearer token)
PUT    /translation/config/targets/:id  — update a translation target (Bearer token)
DELETE /translation/config/targets/:id  — delete a translation target (Bearer token)

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
POST /agent/generate-template | /agent/edit-template | /agent/suggest-styles — AI DSK template generation (Bearer token)

POST   /mcp-tokens        — create a personal MCP access token { label, scopes? } → { id, token } (raw token shown once); optional `scopes` array restricts the token (`resource:verb` like `events:read` + dotted event-topic patterns like `dsk.*`); omit/empty = full access (Bearer token). Surfaced in the Setup Hub "MCP access" card's create form.
GET    /mcp-tokens        — list this project's tokens (label + timestamps, hash/raw never returned) (Bearer token)
DELETE /mcp-tokens/:id    — revoke a token (Bearer token)

GET    /ai/providers               — providers visible to this project: granted site-scope + own project-scope, masked (Bearer token)
POST   /ai/providers               — create a project-scope provider (Bearer token)
PUT/DELETE /ai/providers/:id       — own project-scope providers only; a granted site provider is read-only here (403) (Bearer token)
POST   /ai/providers/:id/discover  — trigger Ollama /api/tags discovery now (Bearer token)
GET    /ai/providers/:id/models    — provider's model catalog (Bearer token)
GET/POST/PUT/DELETE /admin/ai-providers[/:id] — site-scope provider CRUD (X-Admin-Key or is_admin user)
POST   /admin/ai-providers/:id/discover     — trigger discovery (X-Admin-Key or is_admin user)
GET/POST/PUT/DELETE /admin/ai-providers/:id/models[/:modelId] — model catalog CRUD, ollama providers only (X-Admin-Key or is_admin user)
GET/PUT /admin/ai-providers/:id/grants[/:apiKey] — which projects have this site provider granted (X-Admin-Key or is_admin user)

GET  /roles/catalog                — list the ai_roles catalog: Tracker, Describer, Setup/Asset Control/Graphics Editor/Production Assistant, Planner (public)
GET/PUT /roles/:roleCode/config    — get/update this project's config for a role (Bearer token)
POST /roles/:roleCode/message      — one agentic_chat turn for setup_assistant/asset_control_assistant/dsk_designer (Bearer token)
GET  /roles/:roleCode/events       — SSE for any role except planner: tool_call_started/tool_call_result/staged_action/reply (chat-dialog roles), tracker_update/describer_update (vision roles), assistant_suggestion/assistant_action (Bearer token)
POST /roles/:roleCode/start | /roles/:roleCode/stop — start/stop the Tracker/Describer continuous-vision loop (Bearer token)
GET  /roles/:roleCode/status       — Tracker/Describer running state, lastUpdateAt, lastError (Bearer token)
POST /roles/assistant/prompt       — one-off human nudge into Production Assistant's context (Bearer token)
GET  /roles/assistant/suggestions  — pending suggestions queue (confirm mode) (Bearer token)
POST /roles/assistant/suggestions/:id/confirm | /reject — execute or discard a pending suggestion (Bearer token)
POST /roles/planner/assist         — { currentPlan?, goal, templateId? } → { ok, content }; supersedes the removed /agent/generate-rundown|edit-rundown (Bearer token)

GET/POST/PUT/DELETE /connectors                              — API Connector CRUD, auth_config masked (Bearer token); GET embeds each connector's requests ({ ...connector, requests: [...] }) so a caller needing every request across every connector (e.g. the Production connectorPolls widget) gets it in one round trip instead of N follow-up GET /connectors/:slug/requests calls
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests       — nested Request CRUD (Bearer token)
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests/:requestSlug/mappings — response mapping CRUD (Bearer token)
PUT    /connectors/:connectorSlug/requests/:requestSlug/poll — { enabled } toggle constant poll: a session-long, pointer-independent background refresh, explicitly separate from the !api:/api:/api!: metacode tiers (plan_live_variables.md §2) (Bearer token)
GET    /variables         — { [name]: { value, source, defaultValue, resolvedAt } } snapshot (Bearer token)
GET    /variables/events  — SSE: variable_updated (Bearer token or ?token=)
POST/PUT/DELETE /variables[/:name] — manual variable CRUD (Bearer token)
POST   /variables/refresh — fire a connector request; { connectorSlug, requestSlug, waitMs? } (Bearer token)
GET/POST/DELETE /admin/connector-network-rules[/:id] — global outbound-connector SSRF allow/deny rules (X-Admin-Key or is_admin user)
GET/POST/DELETE /orgs/:orgId/connector-network-rules[/:id] — per-org SSRF allow/deny rules, enforced (user Bearer token; GET for any org member, write for owner/admin)

GET    /orgs                — list orgs the user belongs to (user Bearer token)
POST   /orgs                — create org; creator becomes owner (user Bearer token)
GET    /orgs/:id            — org detail (any member)
PATCH  /orgs/:id            — update name/slug/projectSlugPolicy ('none'|'prefix': require "<orgslug>-" prefix on project public slugs) (owner only)
DELETE /orgs/:id            — delete org (owner only); member projects are detached (api_keys.org_id → NULL), never deleted
GET    /orgs/:id/audit      — org audit trail: queryable action log scoped to the org (owner/admin only; plan_metering_audit §5.5)
GET    /orgs/:id/usage      — org usage rollups: per-project breakdown for owner/admin, aggregated totals for other members (any member; plan_metering_audit §6.1)
GET    /orgs/:id/members    — list members (any member)
POST   /orgs/:id/members    — invite member by email (owner/admin)
PATCH  /orgs/:id/members/:userId — change member role; roles: owner/admin/editor/operator/viewer (owner/admin; owner changes owner-only)
DELETE /orgs/:id/members/:userId — remove member, self-removal allowed, owner cannot be removed (owner/admin)
GET    /orgs/:id/projects   — list projects attached to the org (any member)
GET    /orgs/:id/features   — org feature codes (any member)
PUT    /orgs/:id/features   — update org feature codes (owner/admin)

GET  /music/status          — server-side music analysis session state (Bearer token; mounted only when MUSIC_DETECTION_ACTIVE=1)
POST /music/start | /music/stop — start/stop server-side HLS audio analysis (Bearer token)
GET  /music/events/history  — paginated music/speech/silence event history (Bearer token)
GET  /music/:key/live       — public SSE stream of live sound-label/BPM events (no auth)
GET/PUT /music/config       — per-key detector settings (Bearer token)

GET    /admin/users                  — list users with search (X-Admin-Key)
GET    /admin/users/:id              — user detail with projects (X-Admin-Key)
POST   /admin/users                  — create user (X-Admin-Key)
PATCH  /admin/users/:id              — update user name/active (X-Admin-Key)
POST   /admin/users/:id/set-password — admin password reset (X-Admin-Key)
DELETE /admin/users/:id?force=true   — delete user (X-Admin-Key); without force, 409s if the user has active projects or owns an organization; with force, projects are unlinked (user_id → NULL) and owned orgs are transferred to another member or torn down if the user was the sole member (reassignOrDeleteOwnedOrgs)
GET    /admin/users/:id/features     — list user feature entitlements (X-Admin-Key)
PATCH  /admin/users/:id/features     — grant/revoke user feature entitlements (X-Admin-Key)
GET    /admin/projects               — list projects with search (X-Admin-Key)
GET    /admin/projects/:key          — project detail + features + members (X-Admin-Key)
PATCH  /admin/projects/:key          — update project (X-Admin-Key)
PUT    /admin/projects/:key/features — batch update features (X-Admin-Key)
POST   /admin/batch/users            — batch user operations (X-Admin-Key)
POST   /admin/batch/projects         — batch project operations (X-Admin-Key)
GET    /admin/audit-log              — query unified audit log with filters (X-Admin-Key or is_admin user)
GET    /admin/export/users           — export all users + feature entitlements as JSON (X-Admin-Key or is_admin user)
GET    /admin/export/projects        — export all projects + features as JSON (X-Admin-Key or is_admin user)
POST   /admin/import/users           — import users from JSON export { users, options? } (X-Admin-Key or is_admin user)
POST   /admin/import/projects        — import projects from JSON export { projects, options? } (X-Admin-Key or is_admin user)
GET    /admin/orgs                       — list all orgs with search/pagination (X-Admin-Key)
GET    /admin/feature-policies                    — list tri-state site feature policies (available/self_service/denied) (X-Admin-Key)
PUT    /admin/feature-policies/:code              — set a site-wide feature policy mode (X-Admin-Key)
GET    /admin/orgs/:id/feature-overrides           — list an org's per-feature policy overrides (X-Admin-Key)
PUT    /admin/orgs/:id/feature-overrides/:code     — set an org-level override; { mode: null } clears it (X-Admin-Key)
```

**Key internals:**
- `src/db.js` — Re-exports from `src/db/index.js` (modular). `better-sqlite3` (synchronous) — this install enables `PRAGMA foreign_keys` **by default** (verified: `new Database(':memory:').pragma('foreign_keys', {simple:true})` returns `1`; no explicit pragma statement exists anywhere in the codebase, none is needed), so every `REFERENCES ... ON DELETE CASCADE`/`SET NULL` in `schema.js` is live and enforced, and every plain `REFERENCES` with no `ON DELETE` clause is a real, enforced NO-ACTION constraint — deleting a referenced parent row throws `SQLITE_CONSTRAINT_FOREIGNKEY` if child rows exist. Core tables: `users`, `api_keys` (with `user_id` FK, and now `org_id` FK, plus a rotatable `ingest_stream_key` — `plan_selfservice_config_backend.md` §2), `caption_usage`, `session_stats`, `caption_errors`, `sessions`, `caption_targets`/`translation_vendor_config`/`translation_targets` (server-persisted target/translation config — §1). Additional tables for graphics, radio, HLS, RTMP relay, and production control. Additive migrations run on startup. All `api_keys(key)`-referencing core child tables (`caption_targets`, `translation_vendor_config`, `translation_targets`, `project_features`, `project_members` [→ `project_member_permissions` cascades transitively], `project_device_roles`) declare `ON DELETE CASCADE`, so `deleteKey()` (`src/db/keys.js`) doesn't need to clean them up manually — it does still explicitly delete rows in the tables that key off `api_key` **without** a declared FK at all (`caption_usage`, `session_stats`, `caption_errors`, `auth_events`, `sessions`, `caption_files`, `icons`, `viewer_key_daily_stats`, `mcp_tokens`, plus `rtmp_stream_stats`/`rtmp_relays` when present), inside one `db.transaction(...)`, since those would otherwise silently orphan rather than error.
- `src/db/schema.js` — also defines `organizations` and `org_members` (from `plan_team_org_backend.md`; served by `src/routes/orgs.js`'s `/orgs` CRUD/membership routes and the lcyt-web `/team` page) and `site_feature_policies`/`org_feature_overrides` (`plan_site_feature_policies.md` — tri-state `available`/`self_service`/`denied` policy per feature code, with per-org overrides; `resolveFeaturePolicy(db, apiKey, featureCode)` in `src/db/project-features.js` implements the baseline-plus-override resolution and is wired into `routes/project-features.js`'s self-service toggle route). Admin management of these lives in `routes/admin.js` (`GET/PUT /admin/feature-policies`, `GET/PUT /admin/orgs/:id/feature-overrides`) — no admin frontend page for it yet.
- `src/store.js` — In-memory session store. Session = `{ sessionId, apiKey, streamKey, domain, sender, extraTargets, token, startedAt, lastActivity, sequence, syncOffset, emitter, _sendQueue }`. `sender` is null in target-array mode. `extraTargets` holds all targets including `youtube`, `viewer`, and `generic` types. `emitter` is a per-session `EventEmitter` that stays the plugins' in-process fan-in (captions/mic/stats emit on it, the cue engine listens on its generic `event` channel). `SessionStore._bridgeEmitterToBus` mirrors every emitter event onto the shared `EventBus` (`this.eventBus`) keyed by the project, carrying `sessionId` as envelope meta; `/events` consumes from the bus filtered to its `sessionId`, so caption/mic/close/plugin events also reach `/events/stream`, in-process listeners, and the audit log without touching any emit site. `_sendQueue` serialises concurrent YouTube sends so sequence numbers stay monotonic.
- `src/routes/stt.js` — `createSttRouter(auth, sttManager, db, jwtSecret)`: server-side STT routes (`/stt/*`). Delegates to `SttManager` from `lcyt-rtmp`. Supports `google`, `whisper_http`, `openai` providers and `hls`, `rtmp`, `whep` audio sources. **SSE events** on `GET /stt/events`: `connected`, `transcript`, `stt_started`, `stt_stopped`, `stt_error`. The `?token=`/Bearer SSE auth verifies with `jwt.verify(token, jwtSecret)` (previously an unverified base64 decode of the payload — same class of bug fixed in `lcyt-connectors`' `/variables/events`, see that plugin's `CLAUDE.md`).
- `src/middleware/auth.js` — JWT Bearer verification (session tokens: `{ sessionId, apiKey }`).
- `src/middleware/feature-gate.js` — `createRequireFeature(db, code)` + `createRequireKeyFeature(db, code)`: opt-in feature gate middleware, no-op unless `FEATURE_GATE_ENFORCE=1`.
- `src/routes/admin.js` — `createAdminRouter(db)`: admin panel routes (`/admin/*`). User CRUD with search/pagination, project management with cross-entity `user:email` search, batch operations (activate/deactivate/delete users; revoke/activate/delete projects), feature flag management, user feature entitlement management (`GET/PATCH /admin/users/:id/features`), data export/import (`GET /admin/export/{users,projects}`, `POST /admin/import/{users,projects}`), and unified audit log queries (`GET /admin/audit-log`). All routes require `X-Admin-Key` header or `is_admin` user JWT.
- The RTMP/HLS/radio/preview/STT managers previously lived in `lcyt-backend`; they were extracted to `packages/plugins/lcyt-rtmp`. The backend imports them via `import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp'`.
- The Cue Engine (`lcyt-cues`) provides inline cue metacode processing, phrase/fuzzy/semantic/event matching, sound-cue listeners, and CRUD routes. Imported via `import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues'`.
- The AI Agent (`lcyt-agent`) owns AI configuration, embedding computation, context window management, LLM-based event cue evaluation, the AI model provider registry (`ai_providers`/`ai_provider_models`/`ai_provider_grants`), and the AI Roles Framework (role catalog, the shared `agentic_chat` turn loop, Production Assistant's suggestion queue, Tracker/Describer vision roles). Imported via `import { initAgent, createAgentRouter, createAiRouter, computeEmbeddings, createAdminAiProvidersRouter, createProjectAiProvidersRouter, createRolesRouter, createRolesChatRouter, createProductionAssistantRouter, createVisionRolesRouter, createPlannerRouter } from 'lcyt-agent'` — see that plugin's `CLAUDE.md` for the full composition-root wiring example (it's the only file that holds `lcyt-backend`'s caption-target helpers, `lcyt-production`'s device registry, `lcyt-dsk`'s image helpers, and the running `AgentEngine` all together, needed to build the shared tool registry from `lcyt-tools`).
- `src/ai/index.js` — Backward-compatible re-exports from `lcyt-agent` so existing imports from `lcyt-backend/src/ai/` continue to work.
- `src/db/mcp-tokens.js` — Personal MCP access token DB helpers (`mcp_tokens` table, in `db/schema.js`): `createMcpToken`/`listMcpTokens`/`revokeMcpToken`/`verifyMcpToken` (raw token format `lcytmcp_<64 hex>`, only the SHA-256 hash is stored). Scope helpers: `tokenHasScope(scopes, 'resource:verb')` gates `/events/stream` on `events:read`; `tokenAllowsTopic(scopes, topic)` narrows which dotted event-bus topics (`dsk.*`, `cue.fired`, `variable.<name>.changed`, `*`) a token receives. Both treat empty/NULL scopes as full access; `tokenAllowsTopic` reuses the bus's `topicMatches`. (External tokens only reach `/events/stream`; the rest of the project surface is JWT-only, so there is no per-resource REST scope helper.) `verifyMcpToken` is also imported directly by `lcyt-mcp-http` (via `lcyt-backend/db`) so that server's `authenticate()` accepts either a raw `api_keys.key` or an `mcp_tokens`-issued token, resolving to the same per-connection `apiKey` scoping either way.
- `src/routes/mcp-tokens.js` — `createMcpTokensRouter(db, auth)`: the `/mcp-tokens` CRUD routes above.
- `packages/lcyt-tools` (imported as `lcyt-tools`) — the shared tool-schema/handler registry (`plan/mcp`) consumed by `lcyt-agent`'s `agentic_chat` turn loop over an in-process MCP `Client`/`Server` pair. See its own `CLAUDE.md`.
- API Connectors & Variables (`lcyt-connectors`) owns the `{{ }}` variable system and outbound API connector CRUD/resolution engine. Imported via `import { initConnectors, createConnectorsRouter, createVariablesRouter } from 'lcyt-connectors'`; `initConnectors(db, { filesControl: { resolveStorage } })` runs its own migrations and returns `{ bus, engine, scheduler, pollScheduler }` — `pollScheduler` (constant poll, plan_live_variables.md §2) is passed as `createConnectorsRouter(db, auth, pollScheduler)`'s third argument so its `PUT .../poll` toggle route can start/stop the session-long background refresh.
- `src/middleware/user-auth.js` — JWT Bearer verification for user tokens (`{ type: 'user', userId, email }`).
- `src/middleware/cors.js` — Dynamic CORS: only allows registered session domains; never exposes admin routes.
- `src/middleware/admin.js` — `X-Admin-Key` constant-time comparison.
- `src/caption-files.js` — Pure caption-text utilities: `composeCaptionText`, `formatVttTime`, `buildVttCue`. File I/O was extracted to `lcyt-files`.
- `src/caption-file-writer.js` — `createSessionCaptionFileWriter({ db, resolveStorage })` → `(session, { text, translations, fileFormats, timestamp })`: backend caption-file archiving for delivery paths that bypass `POST /captions`. Injected into `lcyt-rtmp`'s `SttManager` via `setDeliveryHelpers` so server-STT transcripts + translations are archived with the same per-language format rules as the captions route.
- `src/caption-fanout.js` — `createCaptionFanout({ db })` → `fanOutToTargets(session, captions)`: extra-target delivery (YouTube senders, generic webhooks, viewer SSE) with Phase 5 per-target routed composition (`translation_targets.caption_target_id` + per-row `show_original`) and viewer-owner registration. Extracted from `routes/captions.js` and shared with server-STT via `setDeliveryHelpers`; when an entry has no `composedText` it computes the default composition from `captionLang`/`translations`/`showOriginal` (the STT case). Fire-and-forget per target.
- `src/backup.js` — DB backup utilities.
- `src/dsk-bus.js` — `DskBus`: DSK graphics SSE registry + per-key graphics state. The SSE subscriber/broadcast bookkeeping now delegates to the shared `EventBus` (`lcyt/event-bus`, injected from `server.js`); `emitDskEvent`/`addDskSubscriber` publish/subscribe canonical `dsk.*` topics while the bespoke `/dsk/:apikey/events` stream keeps its exact legacy event names + raw payloads via `rename`/`envelope:false`. The graphics-state Map stays local (not SSE plumbing). Same delegation pattern in `lcyt-connectors`' `VariablesBus` and `lcyt-agent`'s `RolesBus`.
- `src/routes/events-stream.js` — `createEventsStreamRouter(eventBus)`: the unified `GET /events/stream` endpoint (see routes above). Scoped external tokens are narrowed per-event via `tokenAllowsTopic` so topic scoping holds even when `?topics` is omitted.
- `src/db/bus-events.js` — `bus_events` audit log helpers (`insertBusEvent`/`deleteBusEventsOlderThan`/`listBusEvents`) + `attachBusAuditLog(eventBus, db)` which taps the bus and persists only the curated `AUDITED_TOPICS` allowlist (governance topics `role.assistant.assistant_action`/`_suggestion`, plus `cue.fired`/`dsk.graphics_changed`/`dsk.templates_changed`/`bridge.command_result`/`target.*`/`translation.*`). High-frequency topics (`caption.sent`, `session.mic_state`, `dsk.text`, `variable.updated`, `stt.transcript`) are deliberately excluded. Insert-only; an audit trail, **not** a replay buffer. Retention via `EVENT_LOG_RETENTION_DAYS` (timer in `index.js`).
- `src/ffmpeg/index.js` — ffmpeg runner factory: selects `local-runner`, `docker-runner`, or `worker-runner` based on `FFMPEG_RUNNER` env var. Exports `createFfmpegRunner()`.
- `src/ffmpeg/local-runner.js` — Spawns ffmpeg directly via `child_process.spawn`.
- `src/ffmpeg/docker-runner.js` — Runs ffmpeg inside a Docker container (`FFMPEG_IMAGE`).
- `src/ffmpeg/worker-runner.js` — Delegates ffmpeg jobs to the worker daemon (`WORKER_DAEMON_URL`).
- `src/ffmpeg/pipe-utils.js` — Shared pipe/stream utilities for ffmpeg runners.
- `src/storage/s3.js` — S3 utilities for backend-owned (non-caption-file) objects: `isS3Enabled()`, `buildS3Url()` (unsigned path-style read URL, used by `routes/videos.js`'s VOD playback proxy), and `uploadDirectoryToS3(localDir, storageKeyPrefix)` (authenticated `@aws-sdk/client-s3` PutObject, optional dependency — recursively uploads a local recording directory under `${storageKeyPrefix}/<relative path>`, the same layout `buildS3Url` reads from). Deliberately a separate, simpler key scheme from `lcyt-files`' per-caption-file S3 adapter (no `S3_PREFIX`/`keyDir()` involved) — see `db/videos.js`'s `syncVideoRecordingToStorage()` for the only caller.
- `src/routes/device-roles.js` — Device role CRUD + pin-code auth for production devices.
- `src/routes/project-features.js` — Per-project feature flag CRUD.
- `src/routes/project-members.js` — Project membership CRUD (invite, role update, remove).
- `src/routes/orgs.js` — Organization CRUD + membership routes (`/orgs/*`, backed by `src/db/orgs.js`); role hierarchy owner/admin/editor/operator/viewer. `deleteOrganization()` detaches member projects (`api_keys.org_id = NULL`) before deleting the org row — `api_keys.org_id` has no `ON DELETE` action, so under this install's live `PRAGMA foreign_keys` enforcement (see below) a bare `DELETE FROM organizations` would otherwise throw `SQLITE_CONSTRAINT_FOREIGNKEY` whenever the org still has projects. `reassignOrDeleteOwnedOrgs(db, userId)` resolves `organizations.owner_user_id` (NOT NULL, no `ON DELETE` action) ahead of a user delete: promotes another member to owner if one exists, otherwise tears the org down the same way — used by both `deleteUserAccount()` (self-service `DELETE /auth/me`) and `DELETE /admin/users/:id?force=true`.
- `src/routes/project-slug.js` — `/keys/:key/slug[/check]` public-slug routes (`plan_dsk_viewport_settings` Phase 1). Slug helpers (`validatePublicSlugFormat`, `RESERVED_PUBLIC_SLUGS`, `checkPublicSlugAvailability`, `setPublicSlug`, `resolveKeyByPublicSlug`, `getRequiredSlugPrefix`) live in `src/db/keys.js`; `api_keys.public_slug` is unique-indexed; `PATCH /admin/projects/:key` accepts `publicSlug` with the org prefix policy bypassed.
- `src/routes/bridge-download.js` — Bridge agent binary download endpoint.
- `src/routes/account.js` — User account routes (profile, settings).
- `src/routes/session.js` — Session management routes.
- `src/routes/content.js` — Content router factory (aggregates file, video, viewer routes).
- `src/db/device-roles.js` — Device role DB helpers (`prod_device_roles` table).
- `src/db/project-features.js` — Project feature flag DB helpers (`project_features` table).
- `src/db/project-members.js` — Project membership DB helpers (`project_members` table).
- `src/db/users.js` — User CRUD (`createUser`, `getUserByEmail`, `getUserById`, `updateUserPassword`). `deleteUserAccount()` (self-service full account deletion) runs, in order: `deleteOwnedProjectsForUser()`, `reassignOrDeleteOwnedOrgs()` (resolves any orgs the user owns — see `src/routes/orgs.js` above), `clearUserReferences()` (nulls the user out of every nullable `invited_by`/`granted_by`/`set_by`/`updated_by` FK column across `org_members`/`project_members`/`project_features`/`user_features`/`site_feature_policies`/`org_feature_overrides`), then deletes `org_members` and the `users` row — this order is load-bearing under live FK enforcement, not stylistic.
- `src/db/index.js` — DB init + all table migrations (users, api_keys, sessions, etc.); re-exported by `src/db.js`.
- `src/routes/auth.js` — User registration/login/me/change-password routes.
- `src/routes/keys.js` — API key CRUD (admin + user project management).
- `src/routes/events.js` — SSE delivery-result stream (authenticated, session owner).
- `src/routes/viewer.js` — Public SSE broadcast stream `GET /viewer/:key` — no auth, CORS `*`.
- `src/routes/targets.js` — Server-persisted caption delivery target CRUD (`caption_targets` table; `/targets/*`).
- `src/routes/translation.js` — Server-persisted translation vendor + language config CRUD (`translation_vendor_config`/`translation_targets` tables; `/translation/config*`).
- `src/db/caption-targets.js` — Caption target DB helpers (`caption_targets` table).
- `src/db/broadcasts.js` — Broadcast entity DB helpers (`broadcasts` + `broadcast_assets` tables; plan/broadcasts): CRUD, calendar/status list, archive/restore, cooling-off hard-delete (`BROADCAST_ARCHIVE_MIN_AGE_DAYS`, default 30), same-project `duplicateBroadcast`, and session-lifecycle binding (`autoCreateForSession`/`bindSessionStart`/`completeBroadcast`). Produced-content tables (`sessions`/`session_stats`/`caption_files`) carry a nullable `broadcast_id`; `POST /live`'s optional `broadcastId` binds a session (1:1 per run) or auto-creates a `live` broadcast, and the session-end paths write `session_stats.broadcast_id` + call `completeBroadcast`. `src/routes/broadcasts.js` mounts the routes (in `content.js` under `scoped('broadcast')`).
- `src/db/translation-config.js` — Translation vendor + target DB helpers (`translation_vendor_config`/`translation_targets` tables).
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
6. **Project-access middleware** (`middleware/project-access.js`, `createProjectAccessMiddleware(db, jwtSecret, { requiredScope, jwtOnly })`) gates the project-scoped routers. `req.auth` = `{ kind, projectId, projectRole, scopes?, … }`. **A token's access = its scopes** (session/user/project/device JWTs and full-access/NULL-scope external tokens have full delegation and bypass scope checks; scoped external tokens are limited):
   - **REST routers** (DSK, connectors/variables/actions, roles, cues, STT/targets/translation, ai/agent, mcp-tokens) are mounted with `scopedAuth('<resource>')` — a colon-less `requiredScope` is checked as `<resource>:<verb>` with the verb inferred from the HTTP method (`GET`→`read`, else `write`). So a scoped external token needs e.g. `variable:read` to `GET /variables`, `dsk:write` to mutate DSK. Event scopes and REST scopes are **independent** — a `dsk.*` topic scope grants no REST access.
   - **Unified event stream** `GET /events/stream` — external tokens gated on exact `requiredScope: 'events:read'`, topics narrowed by `tokenAllowsTopic`. `GET /events/topics` is public.
   - **Legacy per-plugin SSE** now only includes `/stt/events` (JWT-only). Variables and role events are consumed via `/events/stream`.

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
