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
 * @param {{ key?: string, owner: string, email?: string, expiresAt?: string, daily_limit?: number|null, lifetime_limit?: number|null }} options
 * @returns {object} The created row
 */
export function createKey(db, { key, owner, email, expiresAt, daily_limit, lifetime_limit } = {}) {
  const resolvedKey = key || randomUUID();
  db.prepare(
    'INSERT INTO api_keys (key, owner, email, expires_at, daily_limit, lifetime_limit) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    resolvedKey,
    owner,
    email ?? null,
    expiresAt ?? null,
    daily_limit ?? null,
    lifetime_limit ?? null,
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
export function updateKey(db, key, { owner, expiresAt, daily_limit, lifetime_limit } = {}) {
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

  if (parts.length === 0) return false;

  params.push(key);
  const result = db.prepare(`UPDATE api_keys SET ${parts.join(', ')} WHERE key = ?`).run(...params);
  return result.changes > 0;
}
