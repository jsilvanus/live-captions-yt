/**
 * Music detection plugin — DB migrations and helpers.
 *
 * Phase 1: music_events table only.
 * Phase 2 will add music_config.
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
