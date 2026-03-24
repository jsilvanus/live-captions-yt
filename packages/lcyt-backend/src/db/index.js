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
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      name          TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      active        INTEGER NOT NULL DEFAULT 1
    )
  `);

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
  // 0 = graphics upload disabled (default), 1 = enabled (allows image upload via /images)
  if (!existingCols.has('graphics_enabled'))  db.exec('ALTER TABLE api_keys ADD COLUMN graphics_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('user_id'))           db.exec('ALTER TABLE api_keys ADD COLUMN user_id INTEGER REFERENCES users(id)');
  // RTMP/relay extension columns (used by lcyt-rtmp plugin; kept here so createKey always works)
  if (!existingCols.has('relay_allowed'))     db.exec('ALTER TABLE api_keys ADD COLUMN relay_allowed INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('relay_active'))      db.exec('ALTER TABLE api_keys ADD COLUMN relay_active INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('radio_enabled'))     db.exec('ALTER TABLE api_keys ADD COLUMN radio_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('hls_enabled'))       db.exec('ALTER TABLE api_keys ADD COLUMN hls_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('cea708_delay_ms'))   db.exec('ALTER TABLE api_keys ADD COLUMN cea708_delay_ms INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('embed_cors'))        db.exec("ALTER TABLE api_keys ADD COLUMN embed_cors TEXT NOT NULL DEFAULT '*'");
  if (!existingCols.has('device_code'))       db.exec('ALTER TABLE api_keys ADD COLUMN device_code TEXT');

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

  // ── Richer projects: feature flags, membership, device roles ─────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_features (
      api_key      TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      feature_code TEXT    NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      config       TEXT,
      granted_by   INTEGER REFERENCES users(id),
      granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (api_key, feature_code)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_features_key ON project_features(api_key)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_features (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_code TEXT    NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      config       TEXT,
      granted_by   INTEGER REFERENCES users(id),
      granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, feature_code)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_features_user ON user_features(user_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key      TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_level TEXT    NOT NULL DEFAULT 'member',
      invited_by   INTEGER REFERENCES users(id),
      joined_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, user_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_key  ON project_members(api_key)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_member_permissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id   INTEGER NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
      permission  TEXT    NOT NULL,
      granted     INTEGER NOT NULL DEFAULT 1,
      UNIQUE (member_id, permission)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_device_roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      role_type   TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      pin_hash    TEXT    NOT NULL,
      permissions TEXT    NOT NULL DEFAULT '[]',
      config      TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_device_roles_key ON project_device_roles(api_key)');

  // Back-fill project_features from legacy api_keys columns (idempotent)
  const DEFAULT_FEATURES = ['captions', 'viewer-target', 'mic-lock', 'stats', 'translations'];
  const LEGACY_FEATURE_MAP = [
    { col: 'relay_allowed',        code: 'ingest',          check: v => v === 1 },
    { col: 'radio_enabled',        code: 'radio',           check: v => v === 1 },
    { col: 'hls_enabled',          code: 'hls-stream',      check: v => v === 1 },
    { col: 'backend_file_enabled', code: 'file-saving',     check: v => v === 1 },
    { col: 'graphics_enabled',     code: 'graphics-server', check: v => v === 1 },
    { col: 'cea708_delay_ms',      code: 'cea-captions',    check: v => v > 0 },
  ];

  const upsertFeature = db.prepare(`
    INSERT INTO project_features (api_key, feature_code, enabled, config)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (api_key, feature_code) DO NOTHING
  `);
  const upsertUserFeature = db.prepare(`
    INSERT INTO user_features (user_id, feature_code, enabled)
    VALUES (?, ?, 1)
    ON CONFLICT (user_id, feature_code) DO NOTHING
  `);
  const upsertMember = db.prepare(`
    INSERT INTO project_members (api_key, user_id, access_level)
    VALUES (?, ?, 'owner')
    ON CONFLICT (api_key, user_id) DO NOTHING
  `);

  const allKeys = db.prepare('SELECT * FROM api_keys').all();
  const backfillTx = db.transaction(() => {
    for (const row of allKeys) {
      const hasAny = db.prepare('SELECT 1 FROM project_features WHERE api_key = ? LIMIT 1').get(row.key);
      if (!hasAny) {
        for (const code of DEFAULT_FEATURES) {
          upsertFeature.run(row.key, code, 1, null);
        }
        for (const { col, code, check } of LEGACY_FEATURE_MAP) {
          const val = row[col];
          if (check(val ?? 0)) {
            const config = code === 'cea-captions' ? JSON.stringify({ delay_ms: val }) : null;
            upsertFeature.run(row.key, code, 1, config);
          }
        }
        // embed: always present, config holds cors value
        upsertFeature.run(row.key, 'embed', 1, JSON.stringify({ cors: row.embed_cors ?? '*' }));
      }
      // Ensure owning user is a project member
      if (row.user_id) {
        upsertMember.run(row.key, row.user_id);
      }
    }

    // Back-fill user_features for all users (default entitlements)
    const allUsers = db.prepare('SELECT id FROM users').all();
    for (const u of allUsers) {
      const hasAny = db.prepare('SELECT 1 FROM user_features WHERE user_id = ? LIMIT 1').get(u.id);
      if (!hasAny) {
        for (const code of DEFAULT_FEATURES) {
          upsertUserFeature.run(u.id, code);
        }
        // embed is a default user entitlement
        upsertUserFeature.run(u.id, 'embed');
      }
    }
  });
  backfillTx();

  return db;
}

// Re-export all domain modules
export { currentDateHour } from './helpers.js';
export * from './users.js';
export * from './keys.js';
export * from './sessions.js';
export * from './sequences.js';
export * from './stats.js';
export * from './usage.js';
export * from './files.js';
export * from './icons.js';
export * from './viewer.js';

export * from './project-features.js';
export * from './project-members.js';
export * from './device-roles.js';

// Re-export DSK image helpers needed by lcyt-backend routes (keys.js delete cascade)
export { deleteAllImages } from 'lcyt-dsk';
