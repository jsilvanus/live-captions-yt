/**
 * Server settings registry (plan_env_to_ui_settings.md).
 *
 * The single source of truth for every lcyt-backend server-level env var —
 * replaces the drifting `.env.example` / CLAUDE.md tables as the thing code
 * actually reads against. One declarative entry per setting:
 *
 *   key         dotted, category-prefixed DB/UI identifier, e.g. 'contact.email'
 *   env         the legacy environment variable name (override + back-compat)
 *   type        'string' | 'int' | 'bool' | 'enum' | 'csv' | 'secret'
 *   default     the *coerced* default value (already the right JS type)
 *   category    grouping for the admin UI
 *   tier        'ui'  — Tier B: DB-backed, admin-editable, env overrides
 *               'env' — Tier A: env-only forever (bootstrap/secret/executed-value),
 *                       surfaced read-only in the admin UI
 *   apply       'hot'     — read site is per-request/operation; a DB write takes
 *                           effect immediately
 *               'timer'   — a background interval re-arms on change
 *               'manager' — a plugin manager needs a reconfigure() call (falls
 *                           back to restart-required where none exists yet)
 *               'restart' — value is captured once at process/module-load time;
 *                           a DB write only takes effect on next restart
 *   boolStyle   only for type 'bool': how the raw env string maps to a boolean
 *               'is1'      — value === '1' → true, everything else → false
 *               'not0'     — value === '0' → false, everything else → true
 *               'presence' — any non-empty value → true (absence → false)
 *               (default: 'is1')
 *   secret      true → value is masked in the admin UI/API and never audit-logged
 *   enum        allowed values, only for type 'enum'
 *   description shown in the admin UI
 *
 * Where this table and the actual read site disagreed during transcription,
 * the code won (see packages/lcyt-backend/CLAUDE.md's own note to that effect).
 */

// ---------------------------------------------------------------------------
// Tier A — env-only (bootstrap / infra / secrets that gate the surface itself /
// anything executed or dereferenced as code, binary, or path). Never DB-writable;
// SettingsService.set() rejects these regardless of route-level checks. Still
// enumerated here so the admin UI can show one place with the *entire*
// effective configuration, including what it can't change.
// ---------------------------------------------------------------------------
const TIER_A = [
  { key: 'bootstrap.db_path', env: 'DB_PATH', type: 'string', default: './lcyt-backend.db', category: 'bootstrap', description: 'SQLite database file path.' },
  { key: 'bootstrap.port', env: 'PORT', type: 'int', default: 3000, category: 'bootstrap', description: 'HTTP port.' },
  { key: 'bootstrap.static_dir', env: 'STATIC_DIR', type: 'string', default: '', category: 'bootstrap', description: 'Serve a built lcyt-web bundle from this directory, if set.' },
  { key: 'bootstrap.trust_proxy', env: 'TRUST_PROXY', type: 'string', default: '1', category: 'bootstrap', description: "Express 'trust proxy' value (hop count, boolean, or passthrough string)." },
  { key: 'bootstrap.jwt_secret', env: 'JWT_SECRET', type: 'secret', default: '', secret: true, category: 'bootstrap', description: 'HS256 JWT signing key. Auto-generated (with a startup warning) when unset — restarts invalidate all outstanding tokens until this is pinned.' },
  { key: 'bootstrap.admin_key', env: 'ADMIN_KEY', type: 'secret', default: '', secret: true, category: 'bootstrap', description: 'Legacy X-Admin-Key admin auth. Admin endpoints (including this Server Settings page) are disabled without it or an is_admin user.' },
  { key: 'bootstrap.metrics_token', env: 'METRICS_TOKEN', type: 'secret', default: '', secret: true, category: 'bootstrap', description: 'Bearer token required for GET /metrics; endpoint 404s when unset.' },
  { key: 'bootstrap.ffmpeg_wrapper', env: 'FFMPEG_WRAPPER', type: 'string', default: '', category: 'bootstrap', description: 'Custom ffmpeg wrapper script path (executed).' },
  { key: 'bootstrap.ffmpeg_image', env: 'FFMPEG_IMAGE', type: 'string', default: '', category: 'bootstrap', description: 'Docker image reference for ffmpeg when FFMPEG_RUNNER=docker.' },
  { key: 'bootstrap.playwright_dsk_chromium', env: 'PLAYWRIGHT_DSK_CHROMIUM', type: 'string', default: '', category: 'bootstrap', description: 'Path to the Chromium binary used by the DSK Playwright renderer.' },
  { key: 'bootstrap.google_application_credentials', env: 'GOOGLE_APPLICATION_CREDENTIALS', type: 'string', default: '', category: 'bootstrap', description: 'Path to a Google service-account JSON file (OAuth2 STT).' },
  { key: 'bootstrap.nginx_radio_config_path', env: 'NGINX_RADIO_CONFIG_PATH', type: 'string', default: '', category: 'bootstrap', description: 'Path to the nginx include file NginxManager writes; empty = no-op mode.' },
  { key: 'bootstrap.nginx_test_cmd', env: 'NGINX_TEST_CMD', type: 'string', default: 'nginx -t', category: 'bootstrap', description: 'Shell command to test nginx config before reload (executed).' },
  { key: 'bootstrap.nginx_reload_cmd', env: 'NGINX_RELOAD_CMD', type: 'string', default: 'nginx -s reload', category: 'bootstrap', description: 'Shell command to reload nginx after a config write (executed).' },
  { key: 'bootstrap.backup_dir', env: 'BACKUP_DIR', type: 'string', default: '', category: 'bootstrap', description: 'Directory for DB backup files.' },
  { key: 'bootstrap.icons_dir', env: 'ICONS_DIR', type: 'string', default: '', category: 'bootstrap', description: "Directory for icon assets served at /icons/*." },
  { key: 'bootstrap.videos_storage_dir', env: 'VIDEOS_STORAGE_DIR', type: 'string', default: './recordings', category: 'bootstrap', description: 'Local directory MediaMTX recordings + VOD playback artifacts are written to/served from.' },
  { key: 'bootstrap.files_dir', env: 'FILES_DIR', type: 'string', default: '/data/files', category: 'bootstrap', description: 'Local directory for per-key caption files (local storage adapter).' },
  { key: 'bootstrap.graphics_dir', env: 'GRAPHICS_DIR', type: 'string', default: '/data/images', category: 'bootstrap', description: 'Image storage directory for DSK overlays.' },
  { key: 'bootstrap.hls_subs_root', env: 'HLS_SUBS_ROOT', type: 'string', default: '/tmp/hls-subs', category: 'bootstrap', description: 'Directory for WebVTT subtitle segment files.' },
  { key: 'bootstrap.hls_root', env: 'HLS_ROOT', type: 'string', default: '/tmp/hls-video', category: 'bootstrap', description: 'HLS output directory for video+audio streams.' },
  { key: 'bootstrap.radio_hls_root', env: 'RADIO_HLS_ROOT', type: 'string', default: '/tmp/hls', category: 'bootstrap', description: 'HLS output directory for audio-only streams (ffmpeg mode).' },
  { key: 'bootstrap.preview_root', env: 'PREVIEW_ROOT', type: 'string', default: '/tmp/previews', category: 'bootstrap', description: 'Directory for JPEG thumbnail files.' },
].map(e => ({ ...e, tier: 'env', apply: 'restart' }));

// ---------------------------------------------------------------------------
// Tier B — UI-managed (DB-backed, env-overridable)
// ---------------------------------------------------------------------------
const TIER_B = [
  // --- Application -----------------------------------------------------
  { key: 'app.public_url', env: 'PUBLIC_URL', type: 'string', default: '', category: 'application', apply: 'hot', description: "Server's public URL (used in generated .env files and a few absolute-URL responses)." },
  { key: 'app.backend_url', env: 'BACKEND_URL', type: 'string', default: '', category: 'application', apply: 'hot', description: "Server's own URL, used internally (e.g. by the DSK renderer)." },
  { key: 'app.allowed_domains', env: 'ALLOWED_DOMAINS', type: 'csv', default: ['lcyt.fi', 'www.lcyt.fi', 'localhost'], category: 'application', apply: 'restart', description: 'Domains allowed to open a caption session (CORS filter). `*` allows any domain. Read at startup by lib/allowed-domains.js\'s default-parameter pattern — a DB write needs a restart to take effect.' },
  { key: 'app.allowed_rtmp_domains', env: 'ALLOWED_RTMP_DOMAINS', type: 'csv', default: null, category: 'application', apply: 'restart', description: 'Domains allowed to use the /stream relay endpoints. Falls back to Allowed Domains when unset. Baked into the RTMP router at construction time — restart required.' },
  { key: 'app.free_apikey_active', env: 'FREE_APIKEY_ACTIVE', type: 'bool', boolStyle: 'is1', default: false, category: 'application', apply: 'hot', description: 'Enables the free-tier self-service API key endpoint (POST /keys?freetier).' },
  { key: 'app.use_user_logins', env: 'USE_USER_LOGINS', type: 'bool', boolStyle: 'not0', default: true, category: 'application', apply: 'restart', confirm: true, description: 'User registration/login (/auth routes). Turning this off can lock every non-admin out — confirm before disabling.' },
  { key: 'app.feature_gate_enforce', env: 'FEATURE_GATE_ENFORCE', type: 'bool', boolStyle: 'is1', default: false, category: 'application', apply: 'hot', description: 'Enables feature-gate middleware on /captions, /mic, /stats.' },
  { key: 'app.usage_public', env: 'USAGE_PUBLIC', type: 'bool', boolStyle: 'presence', default: false, category: 'application', apply: 'hot', description: 'If enabled, GET /usage requires no auth (otherwise X-Admin-Key).' },
  { key: 'app.login_rate_limit_max', env: 'LOGIN_RATE_LIMIT_MAX', type: 'int', default: 50, category: 'application', apply: 'restart', description: 'Max failed /auth/login + /auth/register attempts per IP per 15 minutes (0 disables). The rate-limiter instance is built once at module load — restart required.' },
  { key: 'app.youtube_client_id', env: 'YOUTUBE_CLIENT_ID', type: 'string', default: '', category: 'application', apply: 'hot', description: 'Google OAuth 2.0 Web client ID, returned by GET /youtube/config for client-side YouTube OAuth.' },
  { key: 'app.bridge_download_base_url', env: 'BRIDGE_DOWNLOAD_BASE_URL', type: 'string', default: '', category: 'application', apply: 'hot', description: 'Base URL for bridge agent binary downloads.' },

  // --- Contact -----------------------------------------------------------
  { key: 'contact.name', env: 'CONTACT_NAME', type: 'string', default: '', category: 'contact', apply: 'hot', description: 'Contact name returned by GET /contact.' },
  { key: 'contact.email', env: 'CONTACT_EMAIL', type: 'string', default: '', category: 'contact', apply: 'hot', description: 'Contact e-mail returned by GET /contact. Both name and email must be set for the route to respond.' },
  { key: 'contact.phone', env: 'CONTACT_PHONE', type: 'string', default: '', category: 'contact', apply: 'hot', description: 'Contact phone returned by GET /contact.' },
  { key: 'contact.website', env: 'CONTACT_WEBSITE', type: 'string', default: '', category: 'contact', apply: 'hot', description: 'Contact website returned by GET /contact.' },

  // --- Sessions & retention ------------------------------------------------
  { key: 'retention.session_ttl', env: 'SESSION_TTL', type: 'int', default: 7_200_000, category: 'retention', apply: 'timer', description: 'Session timeout in ms.' },
  { key: 'retention.cleanup_interval', env: 'CLEANUP_INTERVAL', type: 'int', default: 300_000, category: 'retention', apply: 'timer', description: 'Session cleanup sweep interval in ms.' },
  { key: 'retention.revoked_key_ttl_days', env: 'REVOKED_KEY_TTL_DAYS', type: 'int', default: 30, category: 'retention', apply: 'timer', description: 'Days before revoked API keys are purged.' },
  { key: 'retention.revoked_key_cleanup_interval', env: 'REVOKED_KEY_CLEANUP_INTERVAL', type: 'int', default: 86_400_000, category: 'retention', apply: 'timer', description: 'Revoked-key cleanup sweep interval in ms.' },
  { key: 'retention.event_log_retention_days', env: 'EVENT_LOG_RETENTION_DAYS', type: 'int', default: 30, category: 'retention', apply: 'timer', description: 'Days before bus_events audit rows are purged (0 disables).' },
  { key: 'retention.event_log_cleanup_interval', env: 'EVENT_LOG_CLEANUP_INTERVAL', type: 'int', default: 86_400_000, category: 'retention', apply: 'timer', description: 'bus_events cleanup sweep interval in ms.' },
  { key: 'retention.audit_log_retention_days', env: 'AUDIT_LOG_RETENTION_DAYS', type: 'int', default: 365, category: 'retention', apply: 'timer', description: 'Days before audit_log rows are purged (0 disables).' },
  { key: 'retention.stats_retention_days', env: 'STATS_RETENTION_DAYS', type: 'int', default: 0, category: 'retention', apply: 'timer', description: 'Opt-in sweep of historical stats tables (0 = keep forever).' },
  { key: 'retention.usage_flush_interval_ms', env: 'USAGE_FLUSH_INTERVAL_MS', type: 'int', default: 15_000, category: 'retention', apply: 'timer', description: 'Usage-rollup buffer flush interval in ms.' },
  { key: 'retention.usage_rollup_hourly_retention_days', env: 'USAGE_ROLLUP_HOURLY_RETENTION_DAYS', type: 'int', default: 90, category: 'retention', apply: 'timer', description: 'Days before hourly usage_rollups rows are compacted into daily rows (0 disables).' },
  { key: 'retention.rollup_maintenance_interval', env: 'ROLLUP_MAINTENANCE_INTERVAL', type: 'int', default: 86_400_000, category: 'retention', apply: 'timer', description: 'Compaction/retention sweep interval in ms.' },
  { key: 'retention.backup_days', env: 'BACKUP_DAYS', type: 'int', default: 0, category: 'retention', apply: 'timer', description: 'Number of daily DB backups to retain (0 disables backups).' },
  { key: 'retention.broadcast_archive_min_age_days', env: 'BROADCAST_ARCHIVE_MIN_AGE_DAYS', type: 'int', default: 30, category: 'retention', apply: 'hot', description: 'Minimum days an archived broadcast must age before a second DELETE hard-deletes it.' },
  { key: 'retention.recording_upload_delay_ms', env: 'RECORDING_UPLOAD_DELAY_MS', type: 'int', default: 3000, category: 'retention', apply: 'hot', description: "Grace delay before an S3-backed recording's local files are read for upload, letting MediaMTX flush the final segment." },

  // --- Media pipeline ------------------------------------------------------
  { key: 'media.rtmp_relay_active', env: 'RTMP_RELAY_ACTIVE', type: 'bool', boolStyle: 'is1', default: false, category: 'media', apply: 'hot', description: 'Enables RTMP relay functionality (/rtmp, /feed-rtmp, /ingestion, /stream, /stream-hls, /radio, /preview, /crop).' },
  { key: 'media.radio_hls_source', env: 'RADIO_HLS_SOURCE', type: 'enum', enum: ['ffmpeg', 'mediamtx'], default: 'ffmpeg', category: 'media', apply: 'restart', description: 'Radio HLS backend: ffmpeg (default) or mediamtx (no ffmpeg process, topology change).' },
  { key: 'media.rtmp_host', env: 'RTMP_HOST', type: 'string', default: 'rtmp.lcyt.fi', category: 'media', apply: 'manager', description: 'RTMP host advertised for the relay ingest.' },
  { key: 'media.rtmp_app', env: 'RTMP_APP', type: 'string', default: 'stream', category: 'media', apply: 'manager', description: 'RTMP application name used when building outbound RTMP/HLS/DSK URLs.' },
  { key: 'media.rtmp_application', env: 'RTMP_APPLICATION', type: 'string', default: '', category: 'media', apply: 'manager', description: 'If set, /rtmp rejects publishes with any other RTMP application name.' },
  { key: 'media.hls_local_rtmp', env: 'HLS_LOCAL_RTMP', type: 'string', default: 'rtmp://127.0.0.1:1935', category: 'media', apply: 'manager', description: 'Local nginx-rtmp base URL for HLS/preview.' },
  { key: 'media.hls_rtmp_app', env: 'HLS_RTMP_APP', type: 'string', default: 'live', category: 'media', apply: 'manager', description: 'RTMP application name for HLS/preview.' },
  { key: 'media.hls_subs_segment_duration', env: 'HLS_SUBS_SEGMENT_DURATION', type: 'int', default: 6, category: 'media', apply: 'manager', description: 'Subtitle segment length in seconds.' },
  { key: 'media.hls_subs_window_size', env: 'HLS_SUBS_WINDOW_SIZE', type: 'int', default: 10, category: 'media', apply: 'manager', description: 'Number of subtitle segments to keep per language.' },
  { key: 'media.radio_local_rtmp', env: 'RADIO_LOCAL_RTMP', type: 'string', default: 'rtmp://127.0.0.1:1935', category: 'media', apply: 'manager', description: 'Local nginx-rtmp URL for radio streams (ffmpeg mode).' },
  { key: 'media.radio_rtmp_app', env: 'RADIO_RTMP_APP', type: 'string', default: 'live', category: 'media', apply: 'manager', description: 'RTMP application name for radio (ffmpeg mode).' },
  { key: 'media.nginx_radio_prefix', env: 'NGINX_RADIO_PREFIX', type: 'string', default: '/r', category: 'media', apply: 'manager', description: 'Public URL prefix for slug-based radio proxy locations.' },
  { key: 'media.preview_interval_s', env: 'PREVIEW_INTERVAL_S', type: 'int', default: 5, category: 'media', apply: 'manager', description: 'Seconds between thumbnail updates.' },
  { key: 'media.crop_zmq_port_base', env: 'CROP_ZMQ_PORT_BASE', type: 'int', default: 5560, category: 'media', apply: 'restart', description: 'First 127.0.0.1 port used for per-process zmq binds (vertical-crop live repositioning). Captured at module load — restart required.' },
  { key: 'media.crop_output_default', env: 'CROP_OUTPUT_DEFAULT', type: 'string', default: '1080x1920', category: 'media', apply: 'manager', description: 'Vertical-crop delivery size when crop_config out_w/out_h are NULL.' },
  { key: 'media.cea_enabled', env: 'CEA', type: 'bool', boolStyle: 'presence', default: false, category: 'media', apply: 'manager', description: 'Enables CEA-608/708 caption encoding (experimental).' },
  { key: 'media.cea708_offset_ms', env: 'CEA708_OFFSET_MS', type: 'int', default: 2000, category: 'media', apply: 'hot', description: 'CEA-708 caption timing offset in ms — ms to shift caption earlier when speechStart is absent. Read per-caption inside RtmpRelayManager.writeCaption().' },
  { key: 'media.cea708_duration_ms', env: 'CEA708_DURATION_MS', type: 'int', default: 3000, category: 'media', apply: 'hot', description: 'CEA-708 cue display duration in ms. Read per-caption inside RtmpRelayManager.writeCaption().' },
  { key: 'media.cea708_max_backtrack_ms', env: 'CEA708_MAX_BACKTRACK_MS', type: 'int', default: 5000, category: 'media', apply: 'hot', description: 'Maximum ms a CEA-708 cue may be shifted backwards from the current stream position. Read per-caption inside RtmpRelayManager.writeCaption().' },
  { key: 'media.rtmp_control_url', env: 'RTMP_CONTROL_URL', type: 'string', default: '', category: 'media', apply: 'manager', description: 'Legacy nginx-rtmp control URL fallback for dropPublisher.' },

  // --- MediaMTX --------------------------------------------------------
  { key: 'mediamtx.api_url', env: 'MEDIAMTX_API_URL', type: 'string', default: '', category: 'mediamtx', apply: 'manager', description: 'MediaMTX v3 REST API base URL; activates the MediaMTX dropPublisher path when set.' },
  { key: 'mediamtx.rtsp_base_url', env: 'MEDIAMTX_RTSP_BASE_URL', type: 'string', default: 'rtsp://127.0.0.1:8554', category: 'mediamtx', apply: 'manager', description: 'MediaMTX RTSP base URL — used by rtmp-manager to build runOnPublish fan-out read commands. Not in the original lcyt-backend/CLAUDE.md env table despite being read in code and documented in .env.example — added once the actual read site was checked.' },
  { key: 'mediamtx.rtmp_base_url', env: 'MEDIAMTX_RTMP_BASE_URL', type: 'string', default: 'rtmp://127.0.0.1:1935', category: 'mediamtx', apply: 'manager', description: 'MediaMTX RTMP base URL — where the processing ffmpeg pushes its single output back into MediaMTX for runOnPublish fan-out. Same drift note as mediamtx.rtsp_base_url above.' },
  { key: 'mediamtx.hls_base_url', env: 'MEDIAMTX_HLS_BASE_URL', type: 'string', default: 'http://127.0.0.1:8080', category: 'mediamtx', apply: 'manager', description: 'MediaMTX HLS base URL used by NginxManager for internal proxy_pass directives.' },
  { key: 'mediamtx.webrtc_base_url', env: 'MEDIAMTX_WEBRTC_BASE_URL', type: 'string', default: 'http://127.0.0.1:8889', category: 'mediamtx', apply: 'manager', description: 'MediaMTX WebRTC HTTP base URL (WHEP audio source for STT, WebRTC preview).' },
  { key: 'mediamtx.api_user', env: 'MEDIAMTX_API_USER', type: 'string', default: '', category: 'mediamtx', apply: 'manager', description: 'Basic-auth username for the MediaMTX API.' },
  { key: 'mediamtx.api_password', env: 'MEDIAMTX_API_PASSWORD', type: 'secret', default: '', secret: true, category: 'mediamtx', apply: 'manager', description: 'Basic-auth password for the MediaMTX API.' },

  // --- Compute -----------------------------------------------------------
  { key: 'compute.ffmpeg_runner', env: 'FFMPEG_RUNNER', type: 'enum', enum: ['spawn', 'local', 'docker', 'worker'], default: 'spawn', category: 'compute', apply: 'restart', description: "ffmpeg execution backend ('spawn' and 'local' are synonyms in the runner factory). Captured at composition time (factory choice) — restart required. Code default is 'spawn', not 'local' as packages/lcyt-backend/CLAUDE.md's table says." },
  { key: 'compute.worker_daemon_url', env: 'WORKER_DAEMON_URL', type: 'string', default: '', category: 'compute', apply: 'restart', description: 'Worker daemon URL when FFMPEG_RUNNER=worker.' },
  { key: 'compute.orchestrator_url', env: 'ORCHESTRATOR_URL', type: 'string', default: '', category: 'compute', apply: 'restart', description: 'Orchestrator base URL for the burst-VM accounting poller.' },
  { key: 'compute.docker_build_timeout_ms', env: 'DOCKER_BUILD_TIMEOUT_MS', type: 'int', default: 0, category: 'compute', apply: 'restart', description: 'Timeout for Docker image builds in ms.' },

  // --- Storage -------------------------------------------------------------
  { key: 'storage.file_storage', env: 'FILE_STORAGE', type: 'enum', enum: ['local', 's3'], default: 'local', category: 'storage', apply: 'manager', description: 'Caption file storage backend.' },
  { key: 'storage.s3_bucket', env: 'S3_BUCKET', type: 'string', default: '', category: 'storage', apply: 'manager', description: 'S3 bucket name (required when File Storage = s3).' },
  { key: 'storage.s3_region', env: 'S3_REGION', type: 'string', default: 'auto', category: 'storage', apply: 'manager', description: "S3 region ('auto' for Cloudflare R2)." },
  { key: 'storage.s3_endpoint', env: 'S3_ENDPOINT', type: 'string', default: '', category: 'storage', apply: 'manager', description: 'Custom S3-compatible endpoint URL (R2, MinIO, Backblaze B2).' },
  { key: 'storage.s3_prefix', env: 'S3_PREFIX', type: 'string', default: 'captions', category: 'storage', apply: 'manager', description: 'Object key prefix within the bucket.' },
  { key: 'storage.s3_access_key_id', env: 'S3_ACCESS_KEY_ID', type: 'secret', default: '', secret: true, category: 'storage', apply: 'manager', description: 'Static S3 credentials access key (uses the AWS credential chain when unset).' },
  { key: 'storage.s3_secret_access_key', env: 'S3_SECRET_ACCESS_KEY', type: 'secret', default: '', secret: true, category: 'storage', apply: 'manager', description: 'Static S3 credentials secret.' },
  { key: 'storage.files_cache_limit', env: 'FILES_CACHE_LIMIT', type: 'int', default: 0, category: 'storage', apply: 'manager', description: 'Max entries in the storage adapter resolve-cache (0 = default).' },

  // --- Graphics / DSK ------------------------------------------------------
  { key: 'graphics.enabled', env: 'GRAPHICS_ENABLED', type: 'bool', boolStyle: 'is1', default: false, category: 'graphics', apply: 'manager', description: 'Enables image upload/management and the DSK Playwright renderer. Starting/stopping the renderer live is a real process lifecycle change, not a cheap reconfigure — treat as manager-tier, verify behaviour before relying on hot toggling.' },
  { key: 'graphics.max_file_bytes', env: 'GRAPHICS_MAX_FILE_BYTES', type: 'int', default: 5 * 1024 * 1024, category: 'graphics', apply: 'hot', description: 'Max uploaded image size in bytes.' },
  { key: 'graphics.max_storage_bytes', env: 'GRAPHICS_MAX_STORAGE_BYTES', type: 'int', default: 50 * 1024 * 1024, category: 'graphics', apply: 'hot', description: 'Max total image storage per key in bytes.' },
  { key: 'graphics.dsk_local_server', env: 'DSK_LOCAL_SERVER', type: 'string', default: '', category: 'graphics', apply: 'restart', description: 'Local server URL used by the DSK renderer. Captured at module load — restart required.' },
  { key: 'graphics.dsk_local_rtmp', env: 'DSK_LOCAL_RTMP', type: 'string', default: 'rtmp://127.0.0.1:1935', category: 'graphics', apply: 'manager', description: 'Local nginx-rtmp base URL for DSK RTMP output.' },
  { key: 'graphics.dsk_rtmp_app', env: 'DSK_RTMP_APP', type: 'string', default: 'dsk', category: 'graphics', apply: 'manager', description: "RTMP application name for DSK renderer output. Code default is 'dsk' — packages/lcyt-backend/CLAUDE.md's table incorrectly said 'live' before this was checked against every actual read site." },

  // --- STT -----------------------------------------------------------------
  { key: 'stt.provider', env: 'STT_PROVIDER', type: 'enum', enum: ['google', 'whisper_http', 'openai'], default: 'google', category: 'stt', apply: 'hot', description: 'Default STT provider.' },
  { key: 'stt.default_language', env: 'STT_DEFAULT_LANGUAGE', type: 'string', default: 'en-US', category: 'stt', apply: 'hot', description: 'Default BCP-47 language tag for STT.' },
  { key: 'stt.audio_source', env: 'STT_AUDIO_SOURCE', type: 'enum', enum: ['hls', 'rtmp', 'whep'], default: 'hls', category: 'stt', apply: 'hot', description: 'Default audio source for STT.' },
  { key: 'stt.google_stt_key', env: 'GOOGLE_STT_KEY', type: 'secret', default: '', secret: true, category: 'stt', apply: 'hot', description: 'Google Cloud STT REST API key (simpler alternative to a service account).' },
  { key: 'stt.google_stt_mode', env: 'GOOGLE_STT_MODE', type: 'enum', enum: ['rest', 'grpc'], default: 'rest', category: 'stt', apply: 'hot', description: 'Google STT mode: rest (default) or grpc (lower latency, requires @google-cloud/speech).' },
  { key: 'stt.whisper_http_url', env: 'WHISPER_HTTP_URL', type: 'string', default: '', category: 'stt', apply: 'hot', description: 'Base URL of a Whisper-compatible HTTP STT server.' },
  { key: 'stt.whisper_http_model', env: 'WHISPER_HTTP_MODEL', type: 'string', default: '', category: 'stt', apply: 'hot', description: 'Model name to request from the Whisper HTTP server.' },
  { key: 'stt.openai_stt_url', env: 'OPENAI_STT_URL', type: 'string', default: '', category: 'stt', apply: 'hot', description: 'Base URL for OpenAI-compatible STT endpoint (OpenAI default when unset).' },
  { key: 'stt.openai_stt_api_key', env: 'OPENAI_STT_API_KEY', type: 'secret', default: '', secret: true, category: 'stt', apply: 'hot', description: 'API key for OpenAI STT endpoint.' },
  { key: 'stt.openai_stt_model', env: 'OPENAI_STT_MODEL', type: 'string', default: 'whisper-1', category: 'stt', apply: 'hot', description: 'Model name for OpenAI STT requests.' },

  // --- AI / embeddings -------------------------------------------------
  { key: 'ai.embedding_api_url', env: 'EMBEDDING_API_URL', type: 'string', default: 'https://api.openai.com', category: 'ai', apply: 'hot', description: 'Base URL for the server-level default embedding API. Per-project overrides in ai_config still win for their project.' },
  { key: 'ai.embedding_api_key', env: 'EMBEDDING_API_KEY', type: 'secret', default: '', secret: true, category: 'ai', apply: 'hot', description: 'API key for the server-level default embedding provider.' },
  { key: 'ai.embedding_model', env: 'EMBEDDING_MODEL', type: 'string', default: 'text-embedding-3-small', category: 'ai', apply: 'hot', description: 'Server-level default embedding model name.' },

  // --- Music ---------------------------------------------------------------
  { key: 'music.detection_active', env: 'MUSIC_DETECTION_ACTIVE', type: 'bool', boolStyle: 'is1', default: false, category: 'music', apply: 'hot', description: 'Mounts the /music server-side HLS audio analysis routes.' },
  { key: 'music.classifier_url', env: 'MUSIC_CLASSIFIER_URL', type: 'string', default: '', category: 'music', apply: 'hot', description: 'External classifier hook URL for music/speech/silence detection.' },

  // --- Metrics ---------------------------------------------------------
  { key: 'metrics.project_labels', env: 'METRICS_PROJECT_LABELS', type: 'bool', boolStyle: 'not0', default: true, category: 'metrics', apply: 'hot', description: 'Include the per-project label on Prometheus business series. Disable to bound cardinality on large fleets.' },
].map(e => ({ ...e, tier: 'ui' }));

export const REGISTRY = [...TIER_A, ...TIER_B];

export const REGISTRY_BY_KEY = new Map(REGISTRY.map(e => [e.key, e]));
export const REGISTRY_BY_ENV = new Map(REGISTRY.map(e => [e.env, e]));

export const CATEGORIES = [...new Set(REGISTRY.map(e => e.category))];

/** @returns {typeof REGISTRY[number]|undefined} */
export function getSettingDef(key) {
  return REGISTRY_BY_KEY.get(key);
}
