/**
 * Music detection plugin — DB migrations and helpers.
 *
 * Phase 1: music_events table.
 * Phase 2: music_config table (per-API-key server-side detector settings).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  // Event log: label transitions and BPM snapshots
  // Populated by SoundCaptionProcessor when it processes <!-- sound:... --> metacodes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key    TEXT    NOT NULL,
      event_type TEXT    NOT NULL,
      label      TEXT,
      bpm        REAL,
      confidence REAL,
      ts         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS music_events_key_ts
      ON music_events(api_key, ts)
  `);

  // Per-API-key server-side (HLS) detector configuration.
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_config (
      api_key             TEXT PRIMARY KEY,
      enabled             INTEGER NOT NULL DEFAULT 0,
      silence_threshold   REAL NOT NULL DEFAULT 0.01,
      flatness_threshold  REAL NOT NULL DEFAULT 0.4,
      zcr_threshold       REAL NOT NULL DEFAULT 0.15,
      confirm_segments    INTEGER NOT NULL DEFAULT 2,
      bpm_enabled         INTEGER NOT NULL DEFAULT 1,
      bpm_min             INTEGER NOT NULL DEFAULT 40,
      bpm_max             INTEGER NOT NULL DEFAULT 200,
      auto_start          INTEGER NOT NULL DEFAULT 0,
      updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  // Additive column migrations for music_config
  const musicConfigCols = new Set(db.prepare("PRAGMA table_info(music_config)").all().map((c) => c.name));

  // Phase 2: enabled field for per-key server-side detector toggle.
  if (!musicConfigCols.has('enabled')) {
    db.exec('ALTER TABLE music_config ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0');
  }

  // Phase 4: auto-calibration opt-in. Additive column migration — default 0
  // (off) so existing configs/sessions keep today's fixed-threshold behaviour.
  if (!musicConfigCols.has('auto_calibrate')) {
    db.exec('ALTER TABLE music_config ADD COLUMN auto_calibrate INTEGER NOT NULL DEFAULT 0');
  }
}

const DEFAULT_MUSIC_CONFIG = {
  enabled: false,
  silenceThreshold: 0.01,
  flatnessThreshold: 0.4,
  zcrThreshold: 0.15,
  confirmSegments: 2,
  bpmEnabled: true,
  bpmMin: 40,
  bpmMax: 200,
  autoStart: false,
  autoCalibrate: false,
};

/**
 * Get the server-side detector config for an API key, falling back to defaults
 * when no row exists yet.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {typeof DEFAULT_MUSIC_CONFIG}
 */
export function getMusicConfig(db, apiKey) {
  const row = db.prepare(`SELECT * FROM music_config WHERE api_key = ?`).get(apiKey);
  if (!row) return { ...DEFAULT_MUSIC_CONFIG };
  return {
    enabled: !!row.enabled,
    silenceThreshold: row.silence_threshold,
    flatnessThreshold: row.flatness_threshold,
    zcrThreshold: row.zcr_threshold,
    confirmSegments: row.confirm_segments,
    bpmEnabled: !!row.bpm_enabled,
    bpmMin: row.bpm_min,
    bpmMax: row.bpm_max,
    autoStart: !!row.auto_start,
    autoCalibrate: !!row.auto_calibrate,
  };
}

/**
 * Upsert the server-side detector config for an API key. Only the provided
 * fields are changed; omitted fields keep their existing (or default) value.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {Partial<typeof DEFAULT_MUSIC_CONFIG>} patch
 * @returns {typeof DEFAULT_MUSIC_CONFIG}
 */
export function setMusicConfig(db, apiKey, patch = {}) {
  const current = getMusicConfig(db, apiKey);
  const merged = { ...current, ...patch };
  db.prepare(`
    INSERT INTO music_config (
      api_key, enabled, silence_threshold, flatness_threshold, zcr_threshold,
      confirm_segments, bpm_enabled, bpm_min, bpm_max, auto_start, auto_calibrate, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(api_key) DO UPDATE SET
      enabled = excluded.enabled,
      silence_threshold = excluded.silence_threshold,
      flatness_threshold = excluded.flatness_threshold,
      zcr_threshold = excluded.zcr_threshold,
      confirm_segments = excluded.confirm_segments,
      bpm_enabled = excluded.bpm_enabled,
      bpm_min = excluded.bpm_min,
      bpm_max = excluded.bpm_max,
      auto_start = excluded.auto_start,
      auto_calibrate = excluded.auto_calibrate,
      updated_at = strftime('%s','now')
  `).run(
    apiKey,
    merged.enabled ? 1 : 0,
    merged.silenceThreshold,
    merged.flatnessThreshold,
    merged.zcrThreshold,
    merged.confirmSegments,
    merged.bpmEnabled ? 1 : 0,
    merged.bpmMin,
    merged.bpmMax,
    merged.autoStart ? 1 : 0,
    merged.autoCalibrate ? 1 : 0,
  );
  return merged;
}

/**
 * Insert a music event (label_change or bpm_update).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ event_type: string, label?: string|null, bpm?: number|null, confidence?: number|null }} event
 */
export function insertMusicEvent(db, apiKey, event) {
  db.prepare(`
    INSERT INTO music_events (api_key, event_type, label, bpm, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(apiKey, event.event_type, event.label ?? null, event.bpm ?? null, event.confidence ?? null);
}

/**
 * Retrieve the most recent music events for an API key.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} [limit=20]
 * @returns {Array<object>}
 */
export function getRecentMusicEvents(db, apiKey, limit = 20) {
  return db.prepare(`
    SELECT id, event_type, label, bpm, confidence, ts
    FROM music_events
    WHERE api_key = ?
    ORDER BY ts DESC
    LIMIT ?
  `).all(apiKey, limit);
}

/**
 * Retrieve a paginated page of music events for an API key, newest first.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {'label_change'|'bpm_update'|null} [opts.eventType]
 * @returns {{ events: Array<object>, total: number }}
 */
export function getMusicEventsPage(db, apiKey, { limit = 50, offset = 0, eventType = null } = {}) {
  const where = eventType
    ? `WHERE api_key = ? AND event_type = ?`
    : `WHERE api_key = ?`;
  const params = eventType ? [apiKey, eventType] : [apiKey];

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM music_events ${where}
  `).get(...params);

  const events = db.prepare(`
    SELECT id, event_type, label, bpm, confidence, ts
    FROM music_events
    ${where}
    ORDER BY ts DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { events, total };
}
