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

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_usage (
      api_key TEXT NOT NULL,
      date    TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (api_key, date)
    )
  `);

  return db;
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
  const result = db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(key);
  return result.changes > 0;
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
