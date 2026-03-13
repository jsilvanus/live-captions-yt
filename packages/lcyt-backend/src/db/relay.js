// ─── RTMP relay config per API key (fan-out: up to 4 slots) ──────────────────

const MAX_RELAY_SLOTS = 4;

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
    // Per-slot transcoding options (null = use stream copy for this slot)
    scale:        row.scale        || null,
    fps:          row.fps          ?? null,
    videoBitrate: row.video_bitrate || null,
    audioBitrate: row.audio_bitrate || null,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

/**
 * Get all configured relay slots for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object[]} ordered by slot ascending
 */
export function getRelays(db, apiKey) {
  return db.prepare('SELECT * FROM rtmp_relays WHERE api_key = ? ORDER BY slot')
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
  const row = db.prepare('SELECT * FROM rtmp_relays WHERE api_key = ? AND slot = ?').get(apiKey, slot);
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
 * slot must be 1-4. Rejects (throws) if all 4 slots are used and the slot is new.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} slot  1-4
 * @param {string} targetUrl
 * @param {{ targetName?: string|null, captionMode?: string, scale?: string|null, fps?: number|null, videoBitrate?: string|null, audioBitrate?: string|null }} [opts]
 * @returns {object}
 */
export function upsertRelay(db, apiKey, slot, targetUrl, { targetName = null, captionMode = 'http', scale = null, fps = null, videoBitrate = null, audioBitrate = null } = {}) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_RELAY_SLOTS) {
    throw new RangeError(`slot must be an integer 1-${MAX_RELAY_SLOTS}, got ${slot}`);
  }
  db.prepare(`
    INSERT INTO rtmp_relays (api_key, slot, target_url, target_name, caption_mode, scale, fps, video_bitrate, audio_bitrate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(api_key, slot) DO UPDATE SET
      target_url   = excluded.target_url,
      target_name  = excluded.target_name,
      caption_mode = excluded.caption_mode,
      scale        = excluded.scale,
      fps          = excluded.fps,
      video_bitrate = excluded.video_bitrate,
      audio_bitrate = excluded.audio_bitrate,
      updated_at   = datetime('now')
  `).run(apiKey, slot, targetUrl, targetName || null, captionMode || 'http', scale || null, fps ?? null, videoBitrate || null, audioBitrate || null);
  return getRelaySlot(db, apiKey, slot);
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
