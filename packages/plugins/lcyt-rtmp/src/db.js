/**
 * Database migrations and helpers for the lcyt-rtmp plugin.
 *
 * Call runMigrations(db) once at startup (inside initRtmpControl) to ensure
 * the RTMP-related tables and api_keys columns exist.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  // ── api_keys additive columns ──────────────────────────────────────────────
  const existingCols = new Set(
    db.prepare('PRAGMA table_info(api_keys)').all().map(c => c.name)
  );
  if (!existingCols.has('relay_allowed'))     db.exec('ALTER TABLE api_keys ADD COLUMN relay_allowed INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('relay_active'))      db.exec('ALTER TABLE api_keys ADD COLUMN relay_active INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('radio_enabled'))     db.exec('ALTER TABLE api_keys ADD COLUMN radio_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('hls_enabled'))       db.exec('ALTER TABLE api_keys ADD COLUMN hls_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('cea708_delay_ms'))   db.exec('ALTER TABLE api_keys ADD COLUMN cea708_delay_ms INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('embed_cors'))        db.exec("ALTER TABLE api_keys ADD COLUMN embed_cors TEXT NOT NULL DEFAULT '*'");

  // ── rtmp_relays: one incoming stream fans out to up to 4 target URLs ────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtmp_relays (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key      TEXT    NOT NULL,
      slot         INTEGER NOT NULL DEFAULT 1,
      target_url   TEXT    NOT NULL,
      target_name  TEXT,
      caption_mode TEXT    NOT NULL DEFAULT 'http',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(api_key, slot)
    )
  `);

  // Migration: if rtmp_relays has the old single-target schema (no slot column),
  // recreate it with the fan-out schema (UNIQUE api_key → UNIQUE (api_key, slot)).
  {
    const relaysCols = new Set(
      db.prepare('PRAGMA table_info(rtmp_relays)').all().map(c => c.name)
    );
    if (!relaysCols.has('slot')) {
      db.transaction(() => {
        db.exec('ALTER TABLE rtmp_relays RENAME TO rtmp_relays_legacy');
        db.exec(`
          CREATE TABLE rtmp_relays (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            api_key      TEXT    NOT NULL,
            slot         INTEGER NOT NULL DEFAULT 1,
            target_url   TEXT    NOT NULL,
            target_name  TEXT,
            caption_mode TEXT    NOT NULL DEFAULT 'http',
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(api_key, slot)
          )
        `);
        const legacyCols = new Set(
          db.prepare('PRAGMA table_info(rtmp_relays_legacy)').all().map(c => c.name)
        );
        db.exec(`
          INSERT INTO rtmp_relays (api_key, slot, target_url, target_name, caption_mode, created_at, updated_at)
          SELECT api_key, 1, target_url,
                 ${legacyCols.has('target_name')  ? 'target_name'                 : 'NULL'},
                 ${legacyCols.has('caption_mode') ? "COALESCE(caption_mode,'http')" : "'http'"},
                 created_at, updated_at
          FROM rtmp_relays_legacy
        `);
        db.exec('DROP TABLE rtmp_relays_legacy');
      })();
    } else {
      if (!relaysCols.has('target_name'))  db.exec('ALTER TABLE rtmp_relays ADD COLUMN target_name TEXT');
      if (!relaysCols.has('caption_mode')) db.exec("ALTER TABLE rtmp_relays ADD COLUMN caption_mode TEXT NOT NULL DEFAULT 'http'");
    }
    // Per-slot transcoding options
    {
      const latestCols = new Set(
        db.prepare('PRAGMA table_info(rtmp_relays)').all().map(c => c.name)
      );
      if (!latestCols.has('scale'))         db.exec('ALTER TABLE rtmp_relays ADD COLUMN scale TEXT');
      if (!latestCols.has('fps'))           db.exec('ALTER TABLE rtmp_relays ADD COLUMN fps INTEGER');
      if (!latestCols.has('video_bitrate')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN video_bitrate TEXT');
      if (!latestCols.has('audio_bitrate')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN audio_bitrate TEXT');
    }
  }

  // ── rtmp_stream_stats (per-stream, personified) ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtmp_stream_stats (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key       TEXT    NOT NULL,
      slot          INTEGER NOT NULL DEFAULT 1,
      target_url    TEXT    NOT NULL,
      target_name   TEXT,
      caption_mode  TEXT    NOT NULL DEFAULT 'http',
      started_at    TEXT    NOT NULL,
      ended_at      TEXT,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      captions_sent INTEGER NOT NULL DEFAULT 0
    )
  `);
  {
    const statsCols = new Set(
      db.prepare('PRAGMA table_info(rtmp_stream_stats)').all().map(c => c.name)
    );
    if (!statsCols.has('slot')) {
      db.exec('ALTER TABLE rtmp_stream_stats ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }
  }

  // ── rtmp_anon_daily_stats (anonymous, no API key) ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtmp_anon_daily_stats (
      date             TEXT    NOT NULL,
      endpoint_type    TEXT    NOT NULL,
      caption_mode     TEXT    NOT NULL DEFAULT 'http',
      streams_count    INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, endpoint_type, caption_mode)
    )
  `);

  // ── stt_config: per-key STT configuration ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS stt_config (
      api_key      TEXT PRIMARY KEY,
      provider     TEXT NOT NULL DEFAULT 'google',
      language     TEXT NOT NULL DEFAULT 'en-US',
      audio_source TEXT NOT NULL DEFAULT 'hls',
      stream_key   TEXT,
      auto_start   INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);
}

// ── STT config DB helpers ──────────────────────────────────────────────────

/**
 * Get STT config for an API key, or null if none exists.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ provider: string, language: string, audio_source: string, stream_key: string|null, auto_start: boolean }|null}
 */
export function getSttConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM stt_config WHERE api_key = ?').get(apiKey);
  if (!row) return null;
  return {
    provider:    row.provider,
    language:    row.language,
    audioSource: row.audio_source,
    streamKey:   row.stream_key ?? null,
    autoStart:   Boolean(row.auto_start),
  };
}

/**
 * Upsert STT config for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ provider?: string, language?: string, audioSource?: string, streamKey?: string|null, autoStart?: boolean }} opts
 */
export function setSttConfig(db, apiKey, { provider, language, audioSource, streamKey, autoStart } = {}) {
  const existing = db.prepare('SELECT * FROM stt_config WHERE api_key = ?').get(apiKey);
  if (!existing) {
    db.prepare(`
      INSERT INTO stt_config (api_key, provider, language, audio_source, stream_key, auto_start)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      apiKey,
      provider    ?? 'google',
      language    ?? 'en-US',
      audioSource ?? 'hls',
      streamKey   ?? null,
      autoStart   ? 1 : 0,
    );
  } else {
    db.prepare(`
      UPDATE stt_config
      SET provider     = COALESCE(?, provider),
          language     = COALESCE(?, language),
          audio_source = COALESCE(?, audio_source),
          stream_key   = ?,
          auto_start   = COALESCE(?, auto_start),
          updated_at   = strftime('%s','now')
      WHERE api_key = ?
    `).run(
      provider    ?? null,
      language    ?? null,
      audioSource ?? null,
      streamKey   !== undefined ? (streamKey ?? null) : existing.stream_key,
      autoStart   !== undefined ? (autoStart ? 1 : 0) : null,
      apiKey,
    );
  }
}

export * from './db/relay.js';
