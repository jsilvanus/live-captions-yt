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
    cea708DelayMs: row.cea708_delay_ms ?? 0,
    embedCors: row.embed_cors ?? '*',
    publicSlug: row.public_slug ?? null,
    activeBroadcastId: row.active_broadcast_id ?? null,
  };
}

// ─── Public slug helpers (plan_dsk_viewport_settings Phase 1) ────────────────

/** 3–40 chars, lowercase alnum + dashes, no leading/trailing dash. */
export const PUBLIC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

/**
 * Slugs that can never be assigned: they would collide with route segments
 * under /dsk/* (and other public prefixes), or are confusing/privileged.
 * Shared with viewport-name validation in lcyt-dsk (Phase 2).
 */
export const RESERVED_PUBLIC_SLUGS = new Set([
  'events', 'images', 'viewports', 'templates', 'template', 'broadcast',
  'renderer', 'public', 'admin', 'api', 'auth', 'keys', 'live', 'captions',
  'viewer', 'video', 'radio', 'preview', 'stream', 'stream-hls', 'dsk',
  'dsk-rtmp', 'embed', 'static', 'assets', 'health', 'contact',
]);

/**
 * Format/reserved-word validation only (no DB access, no org policy).
 * @param {string} slug
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validatePublicSlugFormat(slug) {
  if (typeof slug !== 'string' || !slug) return { ok: false, reason: 'slug is required' };
  if (slug.length < 3 || slug.length > 40) return { ok: false, reason: 'slug must be 3-40 characters' };
  if (!PUBLIC_SLUG_RE.test(slug)) return { ok: false, reason: 'slug must be lowercase letters, digits, and dashes (no leading/trailing dash)' };
  if (slug.includes('--')) return { ok: false, reason: 'slug must not contain consecutive dashes' };
  if (RESERVED_PUBLIC_SLUGS.has(slug)) return { ok: false, reason: `'${slug}' is a reserved word` };
  return { ok: true };
}

/**
 * The prefix (e.g. "team1-") this project's slug must start with, per its
 * organization's project_slug_policy. Null when no prefix is required.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {string|null}
 */
export function getRequiredSlugPrefix(db, key) {
  const row = db.prepare(`
    SELECT o.slug AS org_slug, o.project_slug_policy AS policy
    FROM api_keys k JOIN organizations o ON o.id = k.org_id
    WHERE k.key = ?
  `).get(key);
  if (!row || row.policy !== 'prefix' || !row.org_slug) return null;
  return `${row.org_slug}-`;
}

/**
 * Full availability check for assigning `slug` to project `key`:
 * format, reserved words, org prefix policy (unless bypassed), uniqueness.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string} slug
 * @param {{ bypassPolicy?: boolean }} [opts]  bypassPolicy: site-admin override
 * @returns {{ available: true } | { available: false, reason: string }}
 */
export function checkPublicSlugAvailability(db, key, slug, { bypassPolicy = false } = {}) {
  const fmt = validatePublicSlugFormat(slug);
  if (!fmt.ok) return { available: false, reason: fmt.reason };

  if (!bypassPolicy) {
    const prefix = getRequiredSlugPrefix(db, key);
    if (prefix && !slug.startsWith(prefix)) {
      return { available: false, reason: `slug must start with '${prefix}' (organization policy)` };
    }
  }

  const taken = db.prepare('SELECT key FROM api_keys WHERE public_slug = ?').get(slug);
  if (taken && taken.key !== key) return { available: false, reason: 'slug is already taken' };

  return { available: true };
}

/**
 * Set (or clear with null) a project's public slug. Callers validate first
 * via checkPublicSlugAvailability(); the unique index is the last line of
 * defense against races.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string|null} slug
 * @returns {boolean} true when a row was updated
 */
export function setPublicSlug(db, key, slug) {
  return db.prepare('UPDATE api_keys SET public_slug = ? WHERE key = ?').run(slug, key).changes > 0;
}

/**
 * Read the currently-active broadcast pointer for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {string|null}
 */
export function getActiveBroadcastId(db, key) {
  const row = db.prepare('SELECT active_broadcast_id FROM api_keys WHERE key = ?').get(key);
  return row?.active_broadcast_id ?? null;
}

/**
 * Set the currently-active broadcast pointer for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string|null} broadcastId
 * @returns {boolean}
 */
export function setActiveBroadcastId(db, key, broadcastId) {
  return db.prepare('UPDATE api_keys SET active_broadcast_id = ? WHERE key = ?').run(broadcastId, key).changes > 0;
}

/**
 * Read the project's display name (the `owner` field the Projects UI shows).
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {string|null}
 */
export function getProjectName(db, key) {
  const row = db.prepare('SELECT owner FROM api_keys WHERE key = ?').get(key);
  return row?.owner ?? null;
}

/**
 * Resolve a public slug to its api_key. Null when no project has this slug.
 * @param {import('better-sqlite3').Database} db
 * @param {string} slug
 * @returns {string|null}
 */
export function resolveKeyByPublicSlug(db, slug) {
  const row = db.prepare('SELECT key FROM api_keys WHERE public_slug = ? AND active = 1').get(slug);
  return row ? row.key : null;
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
 * Check whether the graphics_enabled flag is set for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {boolean}
 */
export function isGraphicsEnabled(db, key) {
  const row = db.prepare('SELECT graphics_enabled FROM api_keys WHERE key = ?').get(key);
  return row?.graphics_enabled === 1;
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
 * @param {{ key?: string, owner: string, email?: string, expiresAt?: string, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean, relay_allowed?: boolean, radio_enabled?: boolean, hls_enabled?: boolean, cea708_delay_ms?: number, embed_cors?: string, user_id?: number|null, org_id?: number|null }} options
 * @returns {object} The created row
 */
export function createKey(db, { key, owner, email, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, graphics_enabled, relay_allowed, radio_enabled, hls_enabled, cea708_delay_ms, embed_cors, user_id, org_id } = {}) {
  const resolvedKey = key || randomUUID();
  db.prepare(
    'INSERT INTO api_keys (key, owner, email, expires_at, daily_limit, lifetime_limit, backend_file_enabled, graphics_enabled, relay_allowed, radio_enabled, hls_enabled, cea708_delay_ms, embed_cors, user_id, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    resolvedKey,
    owner,
    email ?? null,
    expiresAt ?? null,
    daily_limit ?? null,
    lifetime_limit ?? null,
    (backend_file_enabled ?? false) ? 1 : 0,
    (graphics_enabled ?? false) ? 1 : 0,
    (relay_allowed ?? false) ? 1 : 0,
    (radio_enabled ?? false) ? 1 : 0,
    (hls_enabled ?? false) ? 1 : 0,
    cea708_delay_ms ?? 0,
    embed_cors ?? '*',
    user_id ?? null,
    org_id ?? null,
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
    try {
      db.prepare(`DELETE FROM rtmp_stream_stats WHERE api_key IN (${placeholders})`).run(...keys);
      db.prepare(`DELETE FROM rtmp_relays WHERE api_key IN (${placeholders})`).run(...keys);
    } catch { /* RTMP tables absent when lcyt-rtmp plugin not loaded */ }
    db.prepare(`DELETE FROM api_keys WHERE key IN (${placeholders})`).run(...keys);
  })();

  return { count: keys.length, deleted: true };
}

/**
 * Permanently delete an API key.
 *
 * Every core child table that declares `REFERENCES api_keys(key)` uses
 * `ON DELETE CASCADE` (caption_targets, translation_vendor_config,
 * translation_targets, project_features, project_members [which cascades
 * project_member_permissions in turn], project_device_roles) — under the
 * live FK enforcement `better-sqlite3` has on by default, the engine cleans
 * those up automatically and this DELETE alone would not fail even with
 * child rows present. A handful of other tables key off `api_key` without
 * ever declaring an FK constraint at all (caption_usage, session_stats,
 * caption_errors, auth_events, sessions, caption_files, icons,
 * viewer_key_daily_stats, mcp_tokens) — deleting a key wouldn't error on
 * these, but would silently orphan their rows, so they're cleaned up
 * explicitly here too, mirroring cleanRevokedKeys()'s existing pattern for
 * the subset it already covers.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {boolean} true if a row was deleted
 */
/**
 * Registered by composition-root-level in-memory stores (lcyt-agent's
 * VisionRoleManager/SceneState, lcyt-backend's perception-aggregator, etc.)
 * that key state by `api_key` outside the DB and have no other way to learn
 * a project was permanently deleted (code-review fix — those Maps had no
 * eviction at all otherwise, growing unbounded for the process lifetime).
 * A single registration point here, rather than threading a callback
 * through every one of deleteKey()'s call sites (routes/keys.js,
 * routes/admin.js, db/users.js's deleteOwnedProjectsForUser), so a future
 * caller of deleteKey() can't forget to wire it.
 * @type {Array<(apiKey: string) => void>}
 */
const _onKeyDeletedHooks = [];

/**
 * @param {(apiKey: string) => void} fn
 */
export function onKeyDeleted(fn) {
  _onKeyDeletedHooks.push(fn);
}

export function deleteKey(db, key) {
  const result = db.transaction(() => {
    // No declared FK — orphan-row cleanup, not FK-required, but done here so
    // deleteKey() is a complete teardown of everything keyed on `key`.
    db.prepare('DELETE FROM caption_usage WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM session_stats WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM caption_errors WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM auth_events WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM sessions WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM caption_files WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM icons WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM viewer_key_daily_stats WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM mcp_tokens WHERE api_key = ?').run(key);
    try {
      db.prepare('DELETE FROM rtmp_stream_stats WHERE api_key = ?').run(key);
      db.prepare('DELETE FROM rtmp_relays WHERE api_key = ?').run(key);
    } catch { /* RTMP tables absent when lcyt-rtmp plugin not loaded */ }
    // caption_targets/translation_vendor_config/translation_targets/project_features/
    // project_members(+permissions)/project_device_roles: ON DELETE CASCADE, left to the engine.
    return db.prepare('DELETE FROM api_keys WHERE key = ?').run(key);
  })();
  const deleted = result.changes > 0;
  if (deleted) {
    for (const fn of _onKeyDeletedHooks) {
      try { fn(key); } catch (err) { console.error('onKeyDeleted hook failed:', err && err.message); }
    }
  }
  return deleted;
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
    try {
      db.prepare('DELETE FROM rtmp_stream_stats WHERE api_key = ?').run(key);
      db.prepare('DELETE FROM rtmp_relays WHERE api_key = ?').run(key);
    } catch { /* RTMP tables absent when lcyt-rtmp plugin not loaded */ }
  })();
  return true;
}

/**
 * Update owner and/or expires_at for a key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {{ owner?: string, expiresAt?: string|null, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean, relay_allowed?: boolean, radio_enabled?: boolean, hls_enabled?: boolean, cea708_delay_ms?: number, embed_cors?: string, org_id?: number|null }} fields
 * @returns {boolean} true if a row was updated
 */
export function updateKey(db, key, { owner, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, graphics_enabled, relay_allowed, radio_enabled, hls_enabled, cea708_delay_ms, embed_cors, org_id } = {}) {
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
  if (graphics_enabled !== undefined) {
    parts.push('graphics_enabled = ?');
    params.push(graphics_enabled ? 1 : 0);
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
  if (cea708_delay_ms !== undefined) {
    parts.push('cea708_delay_ms = ?');
    params.push(Math.max(0, Math.round(Number(cea708_delay_ms ?? 0))));
  }
  if (embed_cors !== undefined) {
    parts.push('embed_cors = ?');
    params.push(embed_cors ?? '*');
  }
  if (org_id !== undefined) {
    parts.push('org_id = ?');
    params.push(org_id ?? null);
  }

  if (parts.length === 0) return false;

  params.push(key);
  const result = db.prepare(`UPDATE api_keys SET ${parts.join(', ')} WHERE key = ?`).run(...params);
  return result.changes > 0;
}
