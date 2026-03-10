import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'lcyt-backend.db');

/**
 * Open/create the SQLite database and ensure the api_keys and caption_usage tables exist.
 * Runs additive migrations for new columns (safe to call on existing databases).
 * @param {string} [dbPath] - Path to the SQLite database file. Defaults to DB_PATH env var or ./lcyt-backend.db
 * @returns {import('better-sqlite3').Database}
 */
export function initDb(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
  const db = new Database(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      key            TEXT    NOT NULL UNIQUE,
      owner          TEXT    NOT NULL,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      email          TEXT,
      daily_limit    INTEGER,
      lifetime_limit INTEGER,
      lifetime_used  INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Additive migrations for databases created before limit/email columns were added
  const existingCols = new Set(
    db.prepare('PRAGMA table_info(api_keys)').all().map(c => c.name)
  );
  if (!existingCols.has('email'))          db.exec('ALTER TABLE api_keys ADD COLUMN email TEXT');
  if (!existingCols.has('daily_limit'))    db.exec('ALTER TABLE api_keys ADD COLUMN daily_limit INTEGER');
  if (!existingCols.has('lifetime_limit')) db.exec('ALTER TABLE api_keys ADD COLUMN lifetime_limit INTEGER');
  if (!existingCols.has('lifetime_used'))  db.exec('ALTER TABLE api_keys ADD COLUMN lifetime_used INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('revoked_at')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN revoked_at TEXT');
    db.exec("UPDATE api_keys SET revoked_at = datetime('now') WHERE active = 0");
  }
  if (!existingCols.has('sequence'))        db.exec('ALTER TABLE api_keys ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('last_caption_at')) db.exec('ALTER TABLE api_keys ADD COLUMN last_caption_at TEXT');
  // 0 = disabled (default/free tier), 1 = enabled (allows per-session file saving via /file endpoint)
  if (!existingCols.has('backend_file_enabled')) db.exec('ALTER TABLE api_keys ADD COLUMN backend_file_enabled INTEGER NOT NULL DEFAULT 0');
  // 0 = not allowed (default), 1 = allowed to configure RTMP relay via /stream
  if (!existingCols.has('relay_allowed')) db.exec('ALTER TABLE api_keys ADD COLUMN relay_allowed INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('relay_active'))  db.exec('ALTER TABLE api_keys ADD COLUMN relay_active INTEGER NOT NULL DEFAULT 0');
  // 0 = not allowed (default), 1 = allowed to upload images/graphics via /images
  if (!existingCols.has('graphics_enabled')) db.exec('ALTER TABLE api_keys ADD COLUMN graphics_enabled INTEGER NOT NULL DEFAULT 0');

  // ── rtmp_relays: one incoming stream fans out to up to 4 target URLs ──────────
  // slot (1-4): one row per target; UNIQUE on (api_key, slot)
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
      // Old schema: UNIQUE(api_key). Recreate with fan-out schema.
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
      // Table already has slot column; apply any remaining additive migrations
      if (!relaysCols.has('target_name'))  db.exec('ALTER TABLE rtmp_relays ADD COLUMN target_name TEXT');
      if (!relaysCols.has('caption_mode')) db.exec("ALTER TABLE rtmp_relays ADD COLUMN caption_mode TEXT NOT NULL DEFAULT 'http'");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_usage (
      api_key TEXT NOT NULL,
      date    TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (api_key, date)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_stats (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      api_key         TEXT NOT NULL,
      domain          TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT NOT NULL,
      duration_ms     INTEGER NOT NULL,
      captions_sent   INTEGER NOT NULL DEFAULT 0,
      captions_failed INTEGER NOT NULL DEFAULT 0,
      final_sequence  INTEGER NOT NULL DEFAULT 0,
      ended_by        TEXT NOT NULL DEFAULT 'client'
    )
  `);

    // Sessions table: persistent session metadata and sequence counter
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id   TEXT PRIMARY KEY,
        api_key      TEXT,
        stream_key   TEXT,
        domain       TEXT,
        sequence     INTEGER NOT NULL DEFAULT 0,
        started_at   TEXT,
        last_activity TEXT,
        sync_offset  INTEGER,
        mic_holder   TEXT,
        data         TEXT
      )
    `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_errors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      error_code  INTEGER,
      error_msg   TEXT,
      batch_size  INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key    TEXT,
      event_type TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      domain     TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_hourly_stats (
      date              TEXT    NOT NULL,
      hour              INTEGER NOT NULL,
      domain            TEXT    NOT NULL,
      sessions_started  INTEGER NOT NULL DEFAULT 0,
      sessions_ended    INTEGER NOT NULL DEFAULT 0,
      captions_sent     INTEGER NOT NULL DEFAULT 0,
      captions_failed   INTEGER NOT NULL DEFAULT 0,
      batches_sent      INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      peak_sessions     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, hour, domain)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT    NOT NULL,
      session_id  TEXT,
      filename    TEXT    NOT NULL,
      lang        TEXT,
      format      TEXT    NOT NULL DEFAULT 'youtube',
      type        TEXT    NOT NULL DEFAULT 'captions',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      size_bytes  INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Additive migrations for caption_files (images support)
  {
    const cfCols = new Set(db.prepare('PRAGMA table_info(caption_files)').all().map(c => c.name));
    if (!cfCols.has('shorthand')) db.exec('ALTER TABLE caption_files ADD COLUMN shorthand TEXT');
    if (!cfCols.has('mime_type')) db.exec('ALTER TABLE caption_files ADD COLUMN mime_type TEXT');
  }

  // Per-stream personified RTMP stats (tied to an API key and target endpoint)
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
  // Additive migration: add slot column if missing
  {
    const statsCols = new Set(
      db.prepare('PRAGMA table_info(rtmp_stream_stats)').all().map(c => c.name)
    );
    if (!statsCols.has('slot')) {
      db.exec('ALTER TABLE rtmp_stream_stats ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }
  }

  // Anonymous daily RTMP usage statistics (no API key, no target URL)
  // endpoint_type: 'youtube' | 'custom'
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS icons (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key       TEXT    NOT NULL,
      filename      TEXT    NOT NULL,
      disk_filename TEXT    NOT NULL,
      mime_type     TEXT    NOT NULL DEFAULT 'image/png',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      size_bytes    INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS viewer_key_daily_stats (
      date        TEXT    NOT NULL,
      api_key     TEXT    NOT NULL,
      viewer_key  TEXT    NOT NULL,
      views       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, api_key, viewer_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS viewer_anon_daily_stats (
      date  TEXT    PRIMARY KEY NOT NULL,
      views INTEGER NOT NULL DEFAULT 0
    )
  `);

  return db;
}

// Re-export all domain modules
export { currentDateHour } from './helpers.js';
export * from './keys.js';
export * from './sessions.js';
export * from './sequences.js';
export * from './stats.js';
export * from './usage.js';
export * from './files.js';
export * from './icons.js';
export * from './relay.js';
export * from './viewer.js';
export * from './images.js';
