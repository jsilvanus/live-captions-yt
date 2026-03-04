import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'lcyt-backend.db');

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

  return db;
}

/**
 * Write a completed session summary to session_stats.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, apiKey: string, domain: string, startedAt: string, endedAt: string, durationMs: number, captionsSent: number, captionsFailed: number, finalSequence: number, endedBy: string }} data
 */
export function writeSessionStat(db, { sessionId, apiKey, domain, startedAt, endedAt, durationMs, captionsSent, captionsFailed, finalSequence, endedBy }) {
  db.prepare(
    'INSERT INTO session_stats (session_id, api_key, domain, started_at, ended_at, duration_ms, captions_sent, captions_failed, final_sequence, ended_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(sessionId, apiKey, domain ?? null, startedAt, endedAt, durationMs, captionsSent ?? 0, captionsFailed ?? 0, finalSequence ?? 0, endedBy ?? 'client');
}

/**
 * Write a caption delivery error to caption_errors.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, sessionId: string, errorCode: number|null, errorMsg: string, batchSize: number }} data
 */
export function writeCaptionError(db, { apiKey, sessionId, errorCode, errorMsg, batchSize }) {
  db.prepare(
    'INSERT INTO caption_errors (api_key, session_id, timestamp, error_code, error_msg, batch_size) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKey, sessionId, new Date().toISOString(), errorCode ?? null, errorMsg ?? null, batchSize ?? 1);
}

/**
 * Write an auth or usage-limit rejection to auth_events.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey?: string, eventType: string, domain?: string }} data
 */
export function writeAuthEvent(db, { apiKey, eventType, domain }) {
  db.prepare(
    'INSERT INTO auth_events (api_key, event_type, timestamp, domain) VALUES (?, ?, ?, ?)'
  ).run(apiKey ?? null, eventType, new Date().toISOString(), domain ?? null);
}

/**
 * Get per-key stats from session_stats, caption_errors, and auth_events.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ sessions: object[], captionErrors: object[], authEvents: object[] }}
 */
export function getKeyStats(db, apiKey) {
  const sessions = db.prepare(
    'SELECT session_id AS sessionId, domain, started_at AS startedAt, ended_at AS endedAt, duration_ms AS durationMs, captions_sent AS captionsSent, captions_failed AS captionsFailed, final_sequence AS finalSequence, ended_by AS endedBy FROM session_stats WHERE api_key = ? ORDER BY id DESC LIMIT 100'
  ).all(apiKey);

  const captionErrors = db.prepare(
    'SELECT timestamp, error_code AS errorCode, error_msg AS errorMsg, batch_size AS batchSize FROM caption_errors WHERE api_key = ? ORDER BY id DESC LIMIT 100'
  ).all(apiKey);

  const authEvents = db.prepare(
    'SELECT event_type AS eventType, timestamp, domain FROM auth_events WHERE api_key = ? ORDER BY id DESC LIMIT 100'
  ).all(apiKey);

  return { sessions, captionErrors, authEvents };
}

/**
 * Format a raw db row into the standard API response shape.
 * @param {object} row
 * @returns {object}
 */
export function formatKey(row) {
  return {
    key: row.key,
    owner: row.owner,
    email: row.email || null,
    active: row.active === 1,
    expires: row.expires_at || null,
    createdAt: row.created_at,
    dailyLimit: row.daily_limit ?? null,
    lifetimeLimit: row.lifetime_limit ?? null,
    lifetimeUsed: row.lifetime_used ?? 0,
    backendFileEnabled: row.backend_file_enabled === 1,
    relayAllowed: row.relay_allowed === 1,
    relayActive:  row.relay_active  === 1,
  };
}

/**
 * Validate an API key against the database.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {{ valid: true, owner: string, expiresAt: string|null } | { valid: false, reason: string }}
 */
export function validateApiKey(db, key) {
  const row = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);

  if (!row) {
    return { valid: false, reason: 'unknown_key' };
  }

  if (row.active === 0) {
    return { valid: false, reason: 'revoked' };
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, owner: row.owner, expiresAt: row.expires_at };
}

/**
 * Check usage limits and, if allowed, atomically increment both daily and lifetime counters.
 * Keys with null limits are always allowed.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {{ allowed: true } | { allowed: false, reason: 'daily_limit_exceeded' | 'lifetime_limit_exceeded' }}
 */
export const checkAndIncrementUsage = (() => {
  // Pre-compile statements once per db instance via closure over the first call.
  // Better-sqlite3 transactions are synchronous.
  const cache = new WeakMap();

  return function checkAndIncrementUsage(db, key) {
    if (!cache.has(db)) {
      cache.set(db, {
        getLimits: db.prepare(
          'SELECT daily_limit, lifetime_limit, lifetime_used FROM api_keys WHERE key = ?'
        ),
        getDailyCount: db.prepare(
          'SELECT count FROM caption_usage WHERE api_key = ? AND date = ?'
        ),
        incrementLifetime: db.prepare(
          'UPDATE api_keys SET lifetime_used = lifetime_used + 1 WHERE key = ?'
        ),
        incrementDaily: db.prepare(
          'INSERT INTO caption_usage (api_key, date, count) VALUES (?, ?, 1) ' +
          'ON CONFLICT (api_key, date) DO UPDATE SET count = count + 1'
        ),
      });
    }

    const stmts = cache.get(db);
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

    return db.transaction(() => {
      const row = stmts.getLimits.get(key);
      if (!row) return { allowed: false, reason: 'lifetime_limit_exceeded' }; // shouldn't happen

      if (row.lifetime_limit !== null && row.lifetime_used >= row.lifetime_limit) {
        return { allowed: false, reason: 'lifetime_limit_exceeded' };
      }

      if (row.daily_limit !== null) {
        const usageRow = stmts.getDailyCount.get(key, today);
        const todayCount = usageRow ? usageRow.count : 0;
        if (todayCount >= row.daily_limit) {
          return { allowed: false, reason: 'daily_limit_exceeded' };
        }
      }

      stmts.incrementLifetime.run(key);
      stmts.incrementDaily.run(key, today);
      return { allowed: true };
    })();
  };
})();

/**
 * Get all API keys.
 * @param {import('better-sqlite3').Database} db
 * @returns {Array}
 */
export function getAllKeys(db) {
  return db.prepare('SELECT * FROM api_keys ORDER BY id').all();
}

/**
 * Get a single API key row.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {object|null}
 */
export function getKey(db, key) {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key) || null;
}

/**
 * Get an API key row by email address.
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 * @returns {object|null}
 */
export function getKeyByEmail(db, email) {
  return db.prepare('SELECT * FROM api_keys WHERE email = ?').get(email) || null;
}

/**
 * Create a new API key.
 * @param {import('better-sqlite3').Database} db
 * @param {{ key?: string, owner: string, email?: string, expiresAt?: string, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean }} options
 * @returns {object} The created row
 */
export function createKey(db, { key, owner, email, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, relay_allowed } = {}) {
  const resolvedKey = key || randomUUID();
  db.prepare(
    'INSERT INTO api_keys (key, owner, email, expires_at, daily_limit, lifetime_limit, backend_file_enabled, relay_allowed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    resolvedKey,
    owner,
    email ?? null,
    expiresAt ?? null,
    daily_limit ?? null,
    lifetime_limit ?? null,
    (backend_file_enabled ?? false) ? 1 : 0,
    (relay_allowed ?? false) ? 1 : 0,
  );
  return getKey(db, resolvedKey);
}

/**
 * Revoke (soft-delete) an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {boolean} true if a row was updated
 */
export function revokeKey(db, key) {
  const result = db.prepare("UPDATE api_keys SET active = 0, revoked_at = datetime('now') WHERE key = ?").run(key);
  return result.changes > 0;
}

/**
 * Permanently delete all revoked keys older than N days, along with their associated data.
 * @param {import('better-sqlite3').Database} db
 * @param {number} olderThanDays
 * @param {boolean} [dryRun=false] - If true, returns count without deleting
 * @returns {{ count: number, deleted: boolean }}
 */
export function cleanRevokedKeys(db, olderThanDays, dryRun = false) {
  const keys = db.prepare(
    `SELECT key FROM api_keys WHERE active = 0 AND revoked_at < datetime('now', ?)`
  ).all(`-${Math.floor(olderThanDays)} days`).map(r => r.key);

  if (dryRun || keys.length === 0) return { count: keys.length, deleted: false };

  db.transaction(() => {
    const placeholders = keys.map(() => '?').join(',');
    db.prepare(`DELETE FROM caption_errors WHERE api_key IN (${placeholders})`).run(...keys);
    db.prepare(`DELETE FROM session_stats WHERE api_key IN (${placeholders})`).run(...keys);
    db.prepare(`DELETE FROM caption_usage WHERE api_key IN (${placeholders})`).run(...keys);
    db.prepare(`DELETE FROM auth_events WHERE api_key IN (${placeholders})`).run(...keys);
    db.prepare(`DELETE FROM rtmp_stream_stats WHERE api_key IN (${placeholders})`).run(...keys);
    db.prepare(`DELETE FROM rtmp_relays WHERE api_key IN (${placeholders})`).run(...keys);
    db.prepare(`DELETE FROM api_keys WHERE key IN (${placeholders})`).run(...keys);
  })();

  return { count: keys.length, deleted: true };
}

/**
 * Permanently delete an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {boolean} true if a row was deleted
 */
export function deleteKey(db, key) {
  const result = db.prepare('DELETE FROM api_keys WHERE key = ?').run(key);
  return result.changes > 0;
}

/**
 * Renew an API key's expiration date.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string|null} newExpiresAt - ISO date string or null for never
 * @returns {boolean} true if a row was updated
 */
export function renewKey(db, key, newExpiresAt) {
  const result = db.prepare('UPDATE api_keys SET expires_at = ? WHERE key = ?').run(
    newExpiresAt || null,
    key
  );
  return result.changes > 0;
}

/**
 * Anonymize a key for GDPR erasure: clears owner, revokes the key, and deletes all
 * associated usage/session/error data. Retains email and expires_at for legitimate
 * interest (preventing free-tier abuse until the original expiry).
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {boolean} true if the key existed
 */
export function anonymizeKey(db, key) {
  const existing = getKey(db, key);
  if (!existing) return false;
  db.transaction(() => {
    db.prepare("UPDATE api_keys SET owner = '', active = 0 WHERE key = ?").run(key);
    db.prepare('DELETE FROM session_stats WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM caption_errors WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM auth_events WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM caption_usage WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM rtmp_stream_stats WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM rtmp_relays WHERE api_key = ?').run(key);
  })();
  return true;
}

// ---------------------------------------------------------------------------
// Domain hourly usage stats
// ---------------------------------------------------------------------------

/**
 * Get the current UTC date string and hour.
 * @returns {{ date: string, hour: number }}
 */
function currentDateHour() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    hour: now.getUTCHours(),
  };
}

/**
 * Increment session-started counter for a domain and update peak concurrent sessions.
 * @param {import('better-sqlite3').Database} db
 * @param {string} domain
 * @param {number} currentSessionCount - Total active sessions after this one was created
 */
export function incrementDomainHourlySessionStart(db, domain, currentSessionCount) {
  const { date, hour } = currentDateHour();
  db.prepare(`
    INSERT INTO domain_hourly_stats (date, hour, domain, sessions_started, peak_sessions)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (date, hour, domain) DO UPDATE SET
      sessions_started = sessions_started + 1,
      peak_sessions = MAX(peak_sessions, excluded.peak_sessions)
  `).run(date, hour, domain, currentSessionCount);
}

/**
 * Increment session-ended counter and accumulate duration for a domain.
 * @param {import('better-sqlite3').Database} db
 * @param {string} domain
 * @param {number} durationMs
 */
export function incrementDomainHourlySessionEnd(db, domain, durationMs) {
  const { date, hour } = currentDateHour();
  db.prepare(`
    INSERT INTO domain_hourly_stats (date, hour, domain, sessions_ended, total_duration_ms)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (date, hour, domain) DO UPDATE SET
      sessions_ended = sessions_ended + 1,
      total_duration_ms = total_duration_ms + excluded.total_duration_ms
  `).run(date, hour, domain, durationMs);
}

/**
 * Increment caption send counters for a domain.
 * @param {import('better-sqlite3').Database} db
 * @param {string} domain
 * @param {{ sent?: number, failed?: number, batches?: number }} counts
 */
export function incrementDomainHourlyCaptions(db, domain, { sent = 0, failed = 0, batches = 0 } = {}) {
  const { date, hour } = currentDateHour();
  db.prepare(`
    INSERT INTO domain_hourly_stats (date, hour, domain, captions_sent, captions_failed, batches_sent)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (date, hour, domain) DO UPDATE SET
      captions_sent    = captions_sent    + excluded.captions_sent,
      captions_failed  = captions_failed  + excluded.captions_failed,
      batches_sent     = batches_sent     + excluded.batches_sent
  `).run(date, hour, domain, sent, failed, batches);
}

/**
 * Query domain usage stats over a date range, grouped by domain and day or hour.
 * @param {import('better-sqlite3').Database} db
 * @param {{ from: string, to: string, granularity?: 'day'|'hour', domain?: string }} options
 * @returns {object[]}
 */
export function getDomainUsageStats(db, { from, to, granularity = 'day', domain } = {}) {
  const domainFilter = domain ? 'AND domain = ?' : '';
  const params = domain ? [from, to, domain] : [from, to];

  if (granularity === 'hour') {
    return db.prepare(`
      SELECT date, hour, domain,
        sessions_started, sessions_ended,
        captions_sent, captions_failed, batches_sent,
        total_duration_ms, peak_sessions
      FROM domain_hourly_stats
      WHERE date >= ? AND date <= ? ${domainFilter}
      ORDER BY date, hour, domain
    `).all(...params);
  }

  return db.prepare(`
    SELECT date, domain,
      SUM(sessions_started)  AS sessions_started,
      SUM(sessions_ended)    AS sessions_ended,
      SUM(captions_sent)     AS captions_sent,
      SUM(captions_failed)   AS captions_failed,
      SUM(batches_sent)      AS batches_sent,
      SUM(total_duration_ms) AS total_duration_ms,
      MAX(peak_sessions)     AS peak_sessions
    FROM domain_hourly_stats
    WHERE date >= ? AND date <= ? ${domainFilter}
    GROUP BY date, domain
    ORDER BY date, domain
  `).all(...params);
}

/**
 * Update owner and/or expires_at for a key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {{ owner?: string, expiresAt?: string|null, daily_limit?: number|null, lifetime_limit?: number|null }} fields
 * @returns {boolean} true if a row was updated
 */
export function updateKey(db, key, { owner, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, relay_allowed } = {}) {
  const parts = [];
  const params = [];

  if (owner !== undefined) {
    parts.push('owner = ?');
    params.push(owner);
  }
  if (expiresAt !== undefined) {
    parts.push('expires_at = ?');
    params.push(expiresAt || null);
  }
  if (daily_limit !== undefined) {
    parts.push('daily_limit = ?');
    params.push(daily_limit ?? null);
  }
  if (lifetime_limit !== undefined) {
    parts.push('lifetime_limit = ?');
    params.push(lifetime_limit ?? null);
  }
  if (backend_file_enabled !== undefined) {
    parts.push('backend_file_enabled = ?');
    params.push(backend_file_enabled ? 1 : 0);
  }
  if (relay_allowed !== undefined) {
    parts.push('relay_allowed = ?');
    params.push(relay_allowed ? 1 : 0);
  }

  if (parts.length === 0) return false;

  params.push(key);
  const result = db.prepare(`UPDATE api_keys SET ${parts.join(', ')} WHERE key = ?`).run(...params);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Per-API-key sequence helpers (persists sequence across sessions)
// ---------------------------------------------------------------------------

const KEY_SEQUENCE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Get the current sequence for an API key, respecting the 2-hour inactivity TTL.
 * Returns 0 (reset) if no captions have ever been sent or if the last caption was
 * sent more than 2 hours ago.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {number} The sequence to use for the next session
 */
export function getKeySequence(db, apiKey) {
  const row = db.prepare('SELECT sequence, last_caption_at FROM api_keys WHERE key = ?').get(apiKey);
  if (!row) return 0;
  if (!row.last_caption_at) return 0;
  const lastTs = new Date(row.last_caption_at).getTime();
  if (isNaN(lastTs) || Date.now() - lastTs > KEY_SEQUENCE_TTL_MS) return 0;
  return row.sequence || 0;
}

/**
 * Persist the latest sequence number for an API key and record when the last
 * caption was sent (used for the 2-hour auto-reset TTL).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} sequence
 */
export function updateKeySequence(db, apiKey, sequence) {
  db.prepare(
    'UPDATE api_keys SET sequence = ?, last_caption_at = ? WHERE key = ?'
  ).run(sequence, new Date().toISOString(), apiKey);
}

/**
 * Explicitly reset the sequence for an API key to 0 and clear the
 * last-caption timestamp so the next session starts from the beginning.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function resetKeySequence(db, apiKey) {
  db.prepare(
    'UPDATE api_keys SET sequence = 0, last_caption_at = NULL WHERE key = ?'
  ).run(apiKey);
}

// ---------------------------------------------------------------------------
// Sessions persistence helpers
// ---------------------------------------------------------------------------

/**
 * Save or update a session row.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, apiKey?: string, streamKey?: string, domain?: string, sequence?: number, startedAt?: string, lastActivity?: string, syncOffset?: number, micHolder?: string, data?: object }} s
 */
export function saveSession(db, s) {
  db.prepare(
    `INSERT INTO sessions (session_id, api_key, stream_key, domain, sequence, started_at, last_activity, sync_offset, mic_holder, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       api_key = excluded.api_key,
       stream_key = excluded.stream_key,
       domain = excluded.domain,
       sequence = excluded.sequence,
       started_at = excluded.started_at,
       last_activity = excluded.last_activity,
       sync_offset = excluded.sync_offset,
       mic_holder = excluded.mic_holder,
       data = excluded.data
    `
  ).run(
    s.sessionId,
    s.apiKey ?? null,
    s.streamKey ?? null,
    s.domain ?? null,
    s.sequence ?? 0,
    s.startedAt ?? null,
    s.lastActivity ?? null,
    s.syncOffset ?? null,
    s.micHolder ?? null,
    s.data ? JSON.stringify(s.data) : null
  );
}

/**
 * Load a session row by ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
export function loadSession(db, sessionId) {
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  if (!row) return null;
  return {
    sessionId: row.session_id,
    apiKey: row.api_key,
    streamKey: row.stream_key,
    domain: row.domain,
    sequence: row.sequence,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    syncOffset: row.sync_offset,
    micHolder: row.mic_holder,
    data: row.data ? JSON.parse(row.data) : null,
  };
}

/**
 * Delete a persisted session.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
export function deleteSession(db, sessionId) {
  return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

/**
 * List all persisted sessions.
 * @param {import('better-sqlite3').Database} db
 */
export function listSessions(db) {
  return db.prepare('SELECT * FROM sessions').all().map(r => ({
    sessionId: r.session_id,
    apiKey: r.api_key,
    streamKey: r.stream_key,
    domain: r.domain,
    sequence: r.sequence,
    startedAt: r.started_at,
    lastActivity: r.last_activity,
    syncOffset: r.sync_offset,
    micHolder: r.mic_holder,
    data: r.data ? JSON.parse(r.data) : null,
  }));
}

/**
 * Atomically increment and return the next sequence number for a session.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 * @returns {number} new sequence
 */
export function incSessionSequence(db, sessionId) {
  const tx = db.transaction((sid) => {
    db.prepare('UPDATE sessions SET sequence = sequence + 1 WHERE session_id = ?').run(sid);
    const row = db.prepare('SELECT sequence FROM sessions WHERE session_id = ?').get(sid);
    return row ? row.sequence : null;
  });
  return tx(sessionId);
}

// ─── Caption files (backend file saving) ─────────────────────────────────────

/**
 * Check whether backend file saving is enabled for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isBackendFileEnabled(db, apiKey) {
  const row = db.prepare('SELECT backend_file_enabled FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.backend_file_enabled === 1 : false;
}

/**
 * Register a new caption file in the database.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey, sessionId, filename, lang, format, type }} data
 * @returns {number} row id
 */
export function registerCaptionFile(db, { apiKey, sessionId, filename, lang, format, type }) {
  const result = db.prepare(
    'INSERT INTO caption_files (api_key, session_id, filename, lang, format, type) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKey, sessionId ?? null, filename, lang ?? null, format ?? 'youtube', type ?? 'captions');
  return result.lastInsertRowid;
}

/**
 * Update the size and updated_at of a caption file entry.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {number} sizeBytes
 */
export function updateCaptionFileSize(db, id, sizeBytes) {
  db.prepare("UPDATE caption_files SET size_bytes = ?, updated_at = datetime('now') WHERE id = ?").run(sizeBytes, id);
}

/**
 * List all caption files for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function listCaptionFiles(db, apiKey) {
  return db.prepare('SELECT * FROM caption_files WHERE api_key = ? ORDER BY created_at DESC').all(apiKey);
}

/**
 * Get a single caption file row by id, optionally scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} [apiKey]
 * @returns {object|null}
 */
export function getCaptionFile(db, id, apiKey) {
  if (apiKey) {
    return db.prepare('SELECT * FROM caption_files WHERE id = ? AND api_key = ?').get(id, apiKey) ?? null;
  }
  return db.prepare('SELECT * FROM caption_files WHERE id = ?').get(id) ?? null;
}

/**
 * Delete a caption file row by id, scoped to an API key (for security).
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {boolean} true if a row was deleted
 */
export function deleteCaptionFile(db, id, apiKey) {
  const result = db.prepare('DELETE FROM caption_files WHERE id = ? AND api_key = ?').run(id, apiKey);
  return result.changes > 0;
}

/**
 * Delete all caption file rows for an API key (for GDPR erasure).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function deleteAllCaptionFiles(db, apiKey) {
  db.prepare('DELETE FROM caption_files WHERE api_key = ?').run(apiKey);
}


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
    id:          row.id,
    apiKey:      row.api_key,
    slot:        row.slot,
    targetUrl:   row.target_url,
    targetName:  row.target_name  || null,
    captionMode: row.caption_mode || 'http',
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
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
 * @param {{ targetName?: string|null, captionMode?: string }} [opts]
 * @returns {object}
 */
export function upsertRelay(db, apiKey, slot, targetUrl, { targetName = null, captionMode = 'http' } = {}) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_RELAY_SLOTS) {
    throw new RangeError(`slot must be an integer 1-${MAX_RELAY_SLOTS}, got ${slot}`);
  }
  db.prepare(`
    INSERT INTO rtmp_relays (api_key, slot, target_url, target_name, caption_mode)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(api_key, slot) DO UPDATE SET
      target_url   = excluded.target_url,
      target_name  = excluded.target_name,
      caption_mode = excluded.caption_mode,
      updated_at   = datetime('now')
  `).run(apiKey, slot, targetUrl, targetName || null, captionMode || 'http');
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
