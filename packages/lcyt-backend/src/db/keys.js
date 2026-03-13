import { randomUUID } from 'node:crypto';

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
    radioEnabled: row.radio_enabled  === 1,
    hlsEnabled:   row.hls_enabled    === 1,
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
 * @param {{ key?: string, owner: string, email?: string, expiresAt?: string, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean, relay_allowed?: boolean, radio_enabled?: boolean, hls_enabled?: boolean }} options
 * @returns {object} The created row
 */
export function createKey(db, { key, owner, email, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, relay_allowed, radio_enabled, hls_enabled } = {}) {
  const resolvedKey = key || randomUUID();
  db.prepare(
    'INSERT INTO api_keys (key, owner, email, expires_at, daily_limit, lifetime_limit, backend_file_enabled, relay_allowed, radio_enabled, hls_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    resolvedKey,
    owner,
    email ?? null,
    expiresAt ?? null,
    daily_limit ?? null,
    lifetime_limit ?? null,
    (backend_file_enabled ?? false) ? 1 : 0,
    (relay_allowed ?? false) ? 1 : 0,
    (radio_enabled ?? false) ? 1 : 0,
    (hls_enabled ?? false) ? 1 : 0,
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

/**
 * Update owner and/or expires_at for a key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {{ owner?: string, expiresAt?: string|null, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean, relay_allowed?: boolean, radio_enabled?: boolean, hls_enabled?: boolean }} fields
 * @returns {boolean} true if a row was updated
 */
export function updateKey(db, key, { owner, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, relay_allowed, radio_enabled, hls_enabled } = {}) {
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
  if (radio_enabled !== undefined) {
    parts.push('radio_enabled = ?');
    params.push(radio_enabled ? 1 : 0);
  }
  if (hls_enabled !== undefined) {
    parts.push('hls_enabled = ?');
    params.push(hls_enabled ? 1 : 0);
  }

  if (parts.length === 0) return false;

  params.push(key);
  const result = db.prepare(`UPDATE api_keys SET ${parts.join(', ')} WHERE key = ?`).run(...params);
  return result.changes > 0;
}
