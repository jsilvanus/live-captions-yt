/**
 * Get a full api_keys row by key value.
 * Used by RTMP routes to read per-key config (e.g. cea708_delay_ms).
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {object|null}
 */
export function getKey(db, key) {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key) ?? null;
}

/**
 * Resolve an incoming nginx-rtmp/MediaMTX stream `name` to the api_key it
 * belongs to. When a project has rotated its ingest stream key
 * (`api_keys.ingest_stream_key`), broadcasters publish using that rotated
 * value instead of the literal api_key — this looks it up. Falls back to
 * treating `name` as the literal api_key when no rotated key matches
 * (today's behavior, unchanged for any key that has never rotated).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} name  nginx-rtmp `$name` / MediaMTX stream name
 * @returns {string} the resolved api_key
 */
export function resolveApiKeyFromIngestStreamKey(db, name) {
  const row = db.prepare('SELECT key FROM api_keys WHERE ingest_stream_key = ?').get(name);
  return row ? row.key : name;
}

// ─── RTMP relay config per API key (fan-out: arbitrary number of slots —
// plan_ingest_feeds.md §1b removed the earlier 4-slot cap) ────────────────────

/**
 * Check whether RTMP relay is allowed for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isRelayAllowed(db, apiKey) {
  const row = db.prepare('SELECT relay_allowed FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.relay_allowed === 1 : false;
}

// ─── Radio (RTMP → audio-only HLS) ───────────────────────────────────────────

/**
 * Check whether the audio-only HLS "radio" feature is enabled for an API key.
 * The api_key must have radio_enabled = 1 (set by admin via PATCH /keys/:key).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isRadioEnabled(db, apiKey) {
  const row = db.prepare('SELECT radio_enabled FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.radio_enabled === 1 : false;
}

// ─── HLS (RTMP → video+audio HLS embed) ──────────────────────────────────────

/**
 * Check whether the video+audio HLS embed feature is enabled for an API key.
 * The api_key must have hls_enabled = 1 (set by admin via PATCH /keys/:key).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isHlsEnabled(db, apiKey) {
  const row = db.prepare('SELECT hls_enabled FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.hls_enabled === 1 : false;
}

// ─── Per-key CORS origin for embeddable player endpoints ──────────────────────

/**
 * Get the CORS `Access-Control-Allow-Origin` value for the embeddable player.js
 * and HLS endpoints of an API key.  Defaults to `'*'` (allow all origins) when
 * the key does not exist or the column is NULL.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {string}  e.g. `'*'` or `'https://example.com'`
 */
export function getEmbedCors(db, apiKey) {
  const row = db.prepare('SELECT embed_cors FROM api_keys WHERE key = ?').get(apiKey);
  return row?.embed_cors || '*';
}

/**
 * Check whether the user has activated the RTMP relay for this key.
 * relay_active is a user-controlled toggle (set via PUT /stream/active).
 * Both relay_allowed (admin permission) and relay_active (user toggle) must be
 * true for the fan-out to start when nginx sends an on_publish callback.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isRelayActive(db, apiKey) {
  const row = db.prepare('SELECT relay_active FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.relay_active === 1 : false;
}

/**
 * Set the relay_active flag for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {boolean} active
 * @returns {boolean} true if the key was found and updated
 */
export function setRelayActive(db, apiKey, active) {
  const result = db.prepare('UPDATE api_keys SET relay_active = ? WHERE key = ?').run(active ? 1 : 0, apiKey);
  return result.changes > 0;
}

/**
 * Map a raw rtmp_relays row to a plain object.
 * @param {object} row
 * @returns {object}
 */
function formatRelayRow(row) {
  return {
    id:           row.id,
    apiKey:       row.api_key,
    slot:         row.slot,
    targetUrl:    row.target_url,
    targetName:   row.target_name  || null,
    captionMode:  row.caption_mode || 'http',
    recordOnStart: row.record_on_start === 1,
    recordOnButton: row.record_on_button === 1,
    // Per-slot transcoding options (null = use stream copy for this slot)
    scale:        row.scale        || null,
    fps:          row.fps          ?? null,
    videoBitrate: row.video_bitrate || null,
    audioBitrate: row.audio_bitrate || null,
    // 'program' (raw ingest, default) or 'crop' ({key}-crop vertical rendition) —
    // ignored when sourceCameraId is set (plan_ingest_feeds.md §1b)
    sourceView:   row.source_view  || 'program',
    // Optional named-feed source: a prod_cameras.id. Takes priority over
    // sourceView when set. sourceCameraKey is the resolved MediaMTX path
    // (prod_cameras.camera_key) — joined in at read time so rtmp-manager.js
    // (which has no db handle of its own) can use it directly.
    sourceCameraId:  row.source_camera_id || null,
    sourceCameraKey: row.source_camera_key || null,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

// LEFT JOIN so rows with no source_camera_id (the common case) still return —
// prod_cameras is owned by lcyt-production but shares the same db instance
// repo-wide (same cross-plugin-query pattern as resolveRelaySourceCameraKey()).
// prod_cameras may not exist at all in a deployment/test that only runs
// lcyt-rtmp's own migrations (e.g. lcyt-backend/test/stream.test.js's bare
// in-memory db) — probe once and fall back to the plain query, same
// defensive pattern lcyt-dsk's camera-thumbnail.js uses for pre-migration
// schemas elsewhere in the repo.
// Keyed by db instance (not a single module-level flag) — a test process can
// legitimately hold multiple db instances with different schemas at once.
const _hasProdCamerasCache = new WeakMap();
export function hasProdCamerasTable(db) {
  if (!_hasProdCamerasCache.has(db)) {
    _hasProdCamerasCache.set(db, !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='prod_cameras'"
    ).get());
  }
  return _hasProdCamerasCache.get(db);
}

function relaysSelectSql(db) {
  return hasProdCamerasTable(db)
    ? `SELECT r.*, c.camera_key AS source_camera_key FROM rtmp_relays r LEFT JOIN prod_cameras c ON c.id = r.source_camera_id`
    : `SELECT r.* FROM rtmp_relays r`;
}

/**
 * Get all configured relay slots for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object[]} ordered by slot ascending
 */
export function getRelays(db, apiKey) {
  return db.prepare(`${relaysSelectSql(db)} WHERE r.api_key = ? ORDER BY r.slot`)
    .all(apiKey)
    .map(formatRelayRow);
}

/**
 * Get a specific relay slot for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} slot
 * @returns {object|null}
 */
export function getRelaySlot(db, apiKey, slot) {
  const row = db.prepare(`${relaysSelectSql(db)} WHERE r.api_key = ? AND r.slot = ?`).get(apiKey, slot);
  return row ? formatRelayRow(row) : null;
}

/**
 * @deprecated Use getRelays() or getRelaySlot(). Kept for migration compatibility.
 */
export function getRelay(db, apiKey) {
  return getRelaySlot(db, apiKey, 1);
}

/**
 * Build the full ffmpeg-ready target URL from relay config.
 * If targetName is set, it is appended as the RTMP stream name.
 * @param {{ targetUrl: string, targetName: string|null }} relay
 * @returns {string}
 */
export function buildRelayFfmpegUrl(relay) {
  if (relay.targetName) {
    return `${relay.targetUrl.replace(/\/$/, '')}/${relay.targetName}`;
  }
  return relay.targetUrl;
}

/**
 * Create or replace a relay slot for an API key.
 * slot must be a positive integer — no upper bound (plan_ingest_feeds.md §1b
 * removes the earlier 4-slot cap; a future per-team quota is a deliberate
 * non-goal of that plan, not enforced here).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} slot  positive integer
 * @param {string} targetUrl
 * @param {{ targetName?: string|null, captionMode?: string, recordOnStart?: boolean, recordOnButton?: boolean, scale?: string|null, fps?: number|null, videoBitrate?: string|null, audioBitrate?: string|null, sourceView?: 'program'|'crop', sourceCameraId?: string|null }} [opts]
 * @returns {object}
 */
export function upsertRelay(db, apiKey, slot, targetUrl, { targetName = null, captionMode = 'http', recordOnStart = false, recordOnButton = false, scale = null, fps = null, videoBitrate = null, audioBitrate = null, sourceView = 'program', sourceCameraId = null } = {}) {
  if (!Number.isInteger(slot) || slot < 1) {
    throw new RangeError(`slot must be a positive integer, got ${slot}`);
  }
  if (sourceView !== 'program' && sourceView !== 'crop') {
    throw new RangeError(`sourceView must be 'program' or 'crop', got ${sourceView}`);
  }
  db.prepare(`
    INSERT INTO rtmp_relays (api_key, slot, target_url, target_name, caption_mode, record_on_start, record_on_button, scale, fps, video_bitrate, audio_bitrate, source_view, source_camera_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(api_key, slot) DO UPDATE SET
      target_url      = excluded.target_url,
      target_name     = excluded.target_name,
      caption_mode    = excluded.caption_mode,
      record_on_start = excluded.record_on_start,
      record_on_button = excluded.record_on_button,
      scale           = excluded.scale,
      fps             = excluded.fps,
      video_bitrate   = excluded.video_bitrate,
      audio_bitrate   = excluded.audio_bitrate,
      source_view     = excluded.source_view,
      source_camera_id = excluded.source_camera_id,
      updated_at      = datetime('now')
  `).run(apiKey, slot, targetUrl, targetName || null, captionMode || 'http', recordOnStart ? 1 : 0, recordOnButton ? 1 : 0, scale || null, fps ?? null, videoBitrate || null, audioBitrate || null, sourceView, sourceCameraId || null);
  return getRelaySlot(db, apiKey, slot);
}

/**
 * Resolve a relay's source camera to its MediaMTX path (camera_key), scoped
 * to the requesting project. Cross-plugin: prod_cameras is owned by
 * lcyt-production, but the two share one SQLite db instance repo-wide, so
 * this queries it directly rather than taking a hard dependency — the same
 * pattern lcyt-dsk's dsk-rtmp.js already uses for api_keys
 * (plan_ingest_feeds.md §2c).
 *
 * requestingApiKey is required and enforced: a camera with an owner_api_key
 * set is only resolvable by the project that owns it (code-review follow-up
 * — the original §2c implementation had no such check at all, letting any
 * project's relay egress-route any other project's live camera feed). A
 * camera with no owner (created before ownership existed, or via crud.js's
 * MCP path which deliberately stays unscoped — see lcyt-tools/CLAUDE.md)
 * remains resolvable by any project, matching the pre-existing open/legacy
 * behavior for those rows.
 * @param {import('better-sqlite3').Database} db
 * @param {string} cameraId
 * @param {string} requestingApiKey
 * @returns {string|null} camera_key, or null if not found / has no camera_key / owned by a different project
 */
export function resolveRelaySourceCameraKey(db, cameraId, requestingApiKey) {
  if (!hasProdCamerasTable(db)) return null;
  const row = db.prepare('SELECT camera_key, owner_api_key FROM prod_cameras WHERE id = ?').get(cameraId);
  if (!row?.camera_key) return null;
  if (row.owner_api_key != null && row.owner_api_key !== requestingApiKey) return null;
  return row.camera_key;
}

/**
 * Find every distinct apiKey with at least one rtmp_relays slot sourced from
 * this camera (source_camera_id). Used by feed-rtmp.js's on_publish so a
 * camera-only relay configuration (no program-sourced slot at all) actually
 * gets its MediaMTX fan-out registered when the *camera* starts publishing —
 * code-review follow-up: previously nothing ever called start()/startAll()
 * in that scenario, since every existing trigger (routes/rtmp.js's on_publish,
 * PUT /stream/active) keys off the PRIMARY apiKey's own publish state, never
 * a referenced camera's.
 * @param {import('better-sqlite3').Database} db
 * @param {string} cameraId
 * @returns {string[]}
 */
export function getApiKeysReferencingCamera(db, cameraId) {
  return db.prepare('SELECT DISTINCT api_key FROM rtmp_relays WHERE source_camera_id = ?')
    .all(cameraId)
    .map(r => r.api_key);
}

/**
 * Delete a specific relay slot for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} slot
 * @returns {boolean} true if a row was deleted
 */
export function deleteRelaySlot(db, apiKey, slot) {
  const result = db.prepare('DELETE FROM rtmp_relays WHERE api_key = ? AND slot = ?').run(apiKey, slot);
  return result.changes > 0;
}

/**
 * Delete all relay slots for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {number} number of rows deleted
 */
export function deleteAllRelays(db, apiKey) {
  const result = db.prepare('DELETE FROM rtmp_relays WHERE api_key = ?').run(apiKey);
  return result.changes;
}

/**
 * @deprecated Use deleteAllRelays(). Kept for migration compatibility.
 */
export function deleteRelay(db, apiKey) {
  return deleteAllRelays(db, apiKey) > 0;
}

// ─── RTMP stream stats (per-stream, personified) ─────────────────────────────

/**
 * Categorise a target URL into a broad endpoint type for anonymous stats.
 * @param {string} targetUrl
 * @returns {'youtube'|'custom'}
 */
function categoriseEndpoint(targetUrl) {
  return /(?:^|[./])youtube\.com(?:[/:?]|$)|(?:^|[./])youtu\.be(?:[/:?]|$)/i.test(targetUrl) ? 'youtube' : 'custom';
}

/**
 * Insert a new RTMP stream stat record (call when relay starts).
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, slot?: number, targetUrl: string, targetName?: string|null, captionMode?: string, startedAt?: string }} data
 * @returns {number} The row id
 */
export function writeRtmpStreamStart(db, { apiKey, slot = 1, targetUrl, targetName = null, captionMode = 'http', startedAt }) {
  const result = db.prepare(
    'INSERT INTO rtmp_stream_stats (api_key, slot, target_url, target_name, caption_mode, started_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKey, slot, targetUrl, targetName || null, captionMode || 'http', startedAt || new Date().toISOString());
  return result.lastInsertRowid;
}

/**
 * Complete an RTMP stream stat record when the relay ends.
 * @param {import('better-sqlite3').Database} db
 * @param {{ streamStatId: number, endedAt?: string, durationMs: number, captionsSent?: number }} data
 */
export function writeRtmpStreamEnd(db, { streamStatId, endedAt, durationMs, captionsSent = 0 }) {
  db.prepare(
    'UPDATE rtmp_stream_stats SET ended_at = ?, duration_ms = ?, captions_sent = ? WHERE id = ?'
  ).run(endedAt || new Date().toISOString(), durationMs, captionsSent, streamStatId);
}

/**
 * Get all RTMP stream stats for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object[]}
 */
export function getRtmpStreamStats(db, apiKey) {
  return db.prepare(
    `SELECT id, slot, target_url AS targetUrl, target_name AS targetName, caption_mode AS captionMode,
            started_at AS startedAt, ended_at AS endedAt, duration_ms AS durationMs,
            captions_sent AS captionsSent
     FROM rtmp_stream_stats WHERE api_key = ? ORDER BY id DESC LIMIT 100`
  ).all(apiKey);
}

/**
 * Increment anonymous RTMP daily stats when a relay stream ends.
 * @param {import('better-sqlite3').Database} db
 * @param {{ targetUrl: string, captionMode?: string, durationMs: number }} data
 */
export function incrementRtmpAnonDailyStat(db, { targetUrl, captionMode = 'http', durationMs }) {
  const date = new Date().toISOString().slice(0, 10);
  const endpointType = categoriseEndpoint(targetUrl);
  const durationSeconds = Math.round(durationMs / 1000);
  db.prepare(`
    INSERT INTO rtmp_anon_daily_stats (date, endpoint_type, caption_mode, streams_count, duration_seconds)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (date, endpoint_type, caption_mode) DO UPDATE SET
      streams_count    = streams_count + 1,
      duration_seconds = duration_seconds + excluded.duration_seconds
  `).run(date, endpointType, captionMode || 'http', durationSeconds);
}
