import { randomUUID } from 'node:crypto';
import { getDialect } from './connection.js';
import { sqlNow } from './helpers.js';

/**
 * Run fn inside a transaction. `db` may already be a transaction client (no $transaction), in which
 * case fn simply joins it.
 * @template T
 * @param {import('./connection.js').Db} db
 * @param {(tx: import('./connection.js').Db) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function inTx(db, fn) {
  return typeof db.$transaction === 'function' ? db.$transaction((tx) => fn(tx)) : fn(db);
}

/** DELETE ... WHERE api_key = key on a table that is not in the Prisma schema (RTMP plugin tables). */
async function deleteByApiKeyIfTableExists(db, table, keys) {
  const pg = getDialect() === 'postgres';
  const exists = pg
    ? (await db.$queryRawUnsafe('SELECT to_regclass($1)::text AS t', table))[0]?.t != null
    : (await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", table)).length > 0;
  if (!exists) return;
  const ph = keys.map((_, i) => (pg ? `$${i + 1}` : '?')).join(',');
  await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE api_key IN (${ph})`, ...keys);
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
    radioEnabled: row.radio_enabled  === 1,
    hlsEnabled:   row.hls_enabled    === 1,
    cea708DelayMs: row.cea708_delay_ms ?? 0,
    embedCors: row.embed_cors ?? '*',
    publicSlug: row.public_slug ?? null,
    activeBroadcastId: row.active_broadcast_id ?? null,
    // plan_project_roles.md (decided 2026-07-26): visibility ('restricted' = private,
    // org membership grants zero baseline access) + the ceiling ordinary org
    // members get on a team-visible project ('viewer'/'editor', never 'admin').
    restricted: row.restricted === 1,
    orgBaselineRole: row.org_baseline_role === 'editor' ? 'editor' : 'viewer',
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
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getRequiredSlugPrefix(db, key) {
  const k = await db.api_keys.findUnique({ where: { key }, select: { organizations: { select: { slug: true, project_slug_policy: true } } } });
  const org = k?.organizations;
  if (!org || org.project_slug_policy !== 'prefix' || !org.slug) return null;
  return `${org.slug}-`;
}

/**
 * Full availability check for assigning `slug` to project `key`:
 * format, reserved words, org prefix policy (unless bypassed), uniqueness.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @param {string} slug
 * @param {{ bypassPolicy?: boolean }} [opts]  bypassPolicy: site-admin override
 * @returns {Promise<{ available: true } | { available: false, reason: string }>}
 */
export async function checkPublicSlugAvailability(db, key, slug, { bypassPolicy = false } = {}) {
  const fmt = validatePublicSlugFormat(slug);
  if (!fmt.ok) return { available: false, reason: fmt.reason };

  if (!bypassPolicy) {
    const prefix = await getRequiredSlugPrefix(db, key);
    if (prefix && !slug.startsWith(prefix)) {
      return { available: false, reason: `slug must start with '${prefix}' (organization policy)` };
    }
  }

  const taken = await db.api_keys.findFirst({ where: { public_slug: slug }, select: { key: true } });
  if (taken && taken.key !== key) return { available: false, reason: 'slug is already taken' };

  return { available: true };
}

/**
 * Set (or clear with null) a project's public slug. Callers validate first
 * via checkPublicSlugAvailability(); the unique index is the last line of
 * defense against races.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @param {string|null} slug
 * @returns {Promise<boolean>} true when a row was updated
 */
export async function setPublicSlug(db, key, slug) {
  return (await db.api_keys.updateMany({ where: { key }, data: { public_slug: slug } })).count > 0;
}

/**
 * Read the currently-active broadcast pointer for a project.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getActiveBroadcastId(db, key) {
  const row = await db.api_keys.findUnique({ where: { key }, select: { active_broadcast_id: true } });
  return row?.active_broadcast_id ?? null;
}

/**
 * Set the currently-active broadcast pointer for a project.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @param {string|null} broadcastId
 * @returns {Promise<boolean>}
 */
export async function setActiveBroadcastId(db, key, broadcastId) {
  return (await db.api_keys.updateMany({ where: { key }, data: { active_broadcast_id: broadcastId } })).count > 0;
}

/**
 * Read the project's display name (the `owner` field the Projects UI shows).
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getProjectName(db, key) {
  const row = await db.api_keys.findUnique({ where: { key }, select: { owner: true } });
  return row?.owner ?? null;
}

/**
 * Resolve a public slug to its api_key. Null when no project has this slug.
 * @param {import('./connection.js').Db} db
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export async function resolveKeyByPublicSlug(db, slug) {
  const row = await db.api_keys.findFirst({ where: { public_slug: slug, active: 1 }, select: { key: true } });
  return row ? row.key : null;
}

/**
 * Validate an API key against the database.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<{ valid: true, owner: string, expiresAt: string|null } | { valid: false, reason: string }>}
 */
export async function validateApiKey(db, key) {
  const row = await db.api_keys.findUnique({ where: { key } });

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
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function isGraphicsEnabled(db, key) {
  const row = await db.api_keys.findUnique({ where: { key }, select: { graphics_enabled: true } });
  return row?.graphics_enabled === 1;
}

/**
 * Check usage limits and, if allowed, atomically increment both daily and lifetime counters.
 * Keys with null limits are always allowed.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<{ allowed: true } | { allowed: false, reason: 'daily_limit_exceeded' | 'lifetime_limit_exceeded' }>}
 */
export async function checkAndIncrementUsage(db, key) {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  return inTx(db, async (tx) => {
    const row = await tx.api_keys.findUnique({
      where: { key }, select: { daily_limit: true, lifetime_limit: true, lifetime_used: true },
    });
    if (!row) return { allowed: false, reason: 'lifetime_limit_exceeded' }; // shouldn't happen

    if (row.lifetime_limit !== null && row.lifetime_used >= row.lifetime_limit) {
      return { allowed: false, reason: 'lifetime_limit_exceeded' };
    }

    if (row.daily_limit !== null) {
      const usageRow = await tx.caption_usage.findUnique({ where: { api_key_date: { api_key: key, date: today } } });
      const todayCount = usageRow ? usageRow.count : 0;
      if (todayCount >= row.daily_limit) {
        return { allowed: false, reason: 'daily_limit_exceeded' };
      }
    }

    await tx.api_keys.updateMany({ where: { key }, data: { lifetime_used: { increment: 1 } } });
    await tx.caption_usage.upsert({
      where: { api_key_date: { api_key: key, date: today } },
      create: { api_key: key, date: today, count: 1 },
      update: { count: { increment: 1 } },
    });
    return { allowed: true };
  });
}

/**
 * Get all API keys.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<Array>}
 */
export async function getAllKeys(db) {
  return db.api_keys.findMany({ orderBy: { id: 'asc' } });
}

/**
 * Get a single API key row.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getKey(db, key) {
  return (await db.api_keys.findUnique({ where: { key } })) || null;
}

/**
 * Get an API key row by email address.
 * @param {import('./connection.js').Db} db
 * @param {string} email
 * @returns {Promise<object|null>}
 */
export async function getKeyByEmail(db, email) {
  return (await db.api_keys.findFirst({ where: { email }, orderBy: { id: 'asc' } })) || null;
}

/**
 * Create a new API key.
 * @param {import('./connection.js').Db} db
 * @param {{ key?: string, owner: string, email?: string, expiresAt?: string, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean, relay_allowed?: boolean, radio_enabled?: boolean, hls_enabled?: boolean, cea708_delay_ms?: number, embed_cors?: string, user_id?: number|null, org_id?: number|null }} options
 * @returns {Promise<object>} The created row
 */
export async function createKey(db, { key, owner, email, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, graphics_enabled, relay_allowed, radio_enabled, hls_enabled, cea708_delay_ms, embed_cors, user_id, org_id } = {}) {
  const resolvedKey = key || randomUUID();
  await db.api_keys.create({
    data: {
      key: resolvedKey,
      owner,
      email: email ?? null,
      expires_at: expiresAt ?? null,
      created_at: sqlNow(),
      daily_limit: daily_limit ?? null,
      lifetime_limit: lifetime_limit ?? null,
      backend_file_enabled: (backend_file_enabled ?? false) ? 1 : 0,
      graphics_enabled: (graphics_enabled ?? false) ? 1 : 0,
      relay_allowed: (relay_allowed ?? false) ? 1 : 0,
      radio_enabled: (radio_enabled ?? false) ? 1 : 0,
      hls_enabled: (hls_enabled ?? false) ? 1 : 0,
      cea708_delay_ms: cea708_delay_ms ?? 0,
      embed_cors: embed_cors ?? '*',
      user_id: user_id ?? null,
      org_id: org_id ?? null,
    },
  });
  return getKey(db, resolvedKey);
}

/**
 * Revoke (soft-delete) an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<boolean>} true if a row was updated
 */
export async function revokeKey(db, key) {
  const result = await db.api_keys.updateMany({ where: { key }, data: { active: 0, revoked_at: sqlNow() } });
  return result.count > 0;
}

/**
 * Permanently delete all revoked keys older than N days, along with their associated data.
 * @param {import('./connection.js').Db} db
 * @param {number} olderThanDays
 * @param {boolean} [dryRun=false] - If true, returns count without deleting
 * @returns {Promise<{ count: number, deleted: boolean }>}
 */
export async function cleanRevokedKeys(db, olderThanDays, dryRun = false) {
  const cutoff = sqlNow(new Date(Date.now() - Math.floor(olderThanDays) * 86400000));
  const keys = (await db.api_keys.findMany({
    where: { active: 0, revoked_at: { lt: cutoff } }, select: { key: true },
  })).map(r => r.key);

  if (dryRun || keys.length === 0) return { count: keys.length, deleted: false };

  await inTx(db, async (tx) => {
    const where = { api_key: { in: keys } };
    await tx.caption_errors.deleteMany({ where });
    await tx.session_stats.deleteMany({ where });
    await tx.caption_usage.deleteMany({ where });
    await tx.auth_events.deleteMany({ where });
    // RTMP tables are absent when the lcyt-rtmp plugin is not loaded
    await deleteByApiKeyIfTableExists(tx, 'rtmp_stream_stats', keys);
    await deleteByApiKeyIfTableExists(tx, 'rtmp_relays', keys);
    await tx.api_keys.deleteMany({ where: { key: { in: keys } } });
  });

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
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<boolean>} true if a row was deleted
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

export async function deleteKey(db, key) {
  const where = { api_key: key };
  const deleted = await inTx(db, async (tx) => {
    // No declared FK — orphan-row cleanup, not FK-required, but done here so
    // deleteKey() is a complete teardown of everything keyed on `key`.
    await tx.caption_usage.deleteMany({ where });
    await tx.session_stats.deleteMany({ where });
    await tx.caption_errors.deleteMany({ where });
    await tx.auth_events.deleteMany({ where });
    await tx.sessions.deleteMany({ where });
    await tx.caption_files.deleteMany({ where });
    await tx.icons.deleteMany({ where });
    await tx.viewer_key_daily_stats.deleteMany({ where });
    await tx.mcp_tokens.deleteMany({ where });
    // RTMP tables are absent when the lcyt-rtmp plugin is not loaded
    await deleteByApiKeyIfTableExists(tx, 'rtmp_stream_stats', [key]);
    await deleteByApiKeyIfTableExists(tx, 'rtmp_relays', [key]);
    // caption_targets/translation_vendor_config/translation_targets/project_features/
    // project_members(+permissions)/project_device_roles: ON DELETE CASCADE, left to the engine.
    return (await tx.api_keys.deleteMany({ where: { key } })).count > 0;
  });
  if (deleted) {
    for (const fn of _onKeyDeletedHooks) {
      try { fn(key); } catch (err) { console.error('onKeyDeleted hook failed:', err && err.message); }
    }
  }
  return deleted;
}

/**
 * Renew an API key's expiration date.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @param {string|null} newExpiresAt - ISO date string or null for never
 * @returns {Promise<boolean>} true if a row was updated
 */
export async function renewKey(db, key, newExpiresAt) {
  const result = await db.api_keys.updateMany({ where: { key }, data: { expires_at: newExpiresAt || null } });
  return result.count > 0;
}

/**
 * Anonymize a key for GDPR erasure: clears owner, revokes the key, and deletes all
 * associated usage/session/error data. Retains email and expires_at for legitimate
 * interest (preventing free-tier abuse until the original expiry).
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<boolean>} true if the key existed
 */
export async function anonymizeKey(db, key) {
  const existing = await getKey(db, key);
  if (!existing) return false;
  await inTx(db, async (tx) => {
    const where = { api_key: key };
    await tx.api_keys.updateMany({ where: { key }, data: { owner: '', active: 0 } });
    await tx.session_stats.deleteMany({ where });
    await tx.caption_errors.deleteMany({ where });
    await tx.auth_events.deleteMany({ where });
    await tx.caption_usage.deleteMany({ where });
    await deleteByApiKeyIfTableExists(tx, 'rtmp_stream_stats', [key]);
    await deleteByApiKeyIfTableExists(tx, 'rtmp_relays', [key]);
  });
  return true;
}

/**
 * Update owner and/or expires_at for a key.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @param {{ owner?: string, expiresAt?: string|null, daily_limit?: number|null, lifetime_limit?: number|null, backend_file_enabled?: boolean, relay_allowed?: boolean, radio_enabled?: boolean, hls_enabled?: boolean, cea708_delay_ms?: number, embed_cors?: string, org_id?: number|null, restricted?: boolean, org_baseline_role?: 'viewer'|'editor' }} fields
 * @returns {Promise<boolean>} true if a row was updated
 */
export async function updateKey(db, key, { owner, expiresAt, daily_limit, lifetime_limit, backend_file_enabled, graphics_enabled, relay_allowed, radio_enabled, hls_enabled, cea708_delay_ms, embed_cors, org_id, restricted, org_baseline_role } = {}) {
  const data = {};
  if (owner !== undefined) data.owner = owner;
  if (expiresAt !== undefined) data.expires_at = expiresAt || null;
  if (daily_limit !== undefined) data.daily_limit = daily_limit ?? null;
  if (lifetime_limit !== undefined) data.lifetime_limit = lifetime_limit ?? null;
  if (backend_file_enabled !== undefined) data.backend_file_enabled = backend_file_enabled ? 1 : 0;
  if (graphics_enabled !== undefined) data.graphics_enabled = graphics_enabled ? 1 : 0;
  if (relay_allowed !== undefined) data.relay_allowed = relay_allowed ? 1 : 0;
  if (radio_enabled !== undefined) data.radio_enabled = radio_enabled ? 1 : 0;
  if (hls_enabled !== undefined) data.hls_enabled = hls_enabled ? 1 : 0;
  if (cea708_delay_ms !== undefined) data.cea708_delay_ms = Math.max(0, Math.round(Number(cea708_delay_ms ?? 0)));
  if (embed_cors !== undefined) data.embed_cors = embed_cors ?? '*';
  if (org_id !== undefined) data.org_id = org_id ?? null;
  if (restricted !== undefined) data.restricted = restricted ? 1 : 0;
  if (org_baseline_role !== undefined) data.org_baseline_role = org_baseline_role === 'editor' ? 'editor' : 'viewer';

  if (Object.keys(data).length === 0) return false;

  const result = await db.api_keys.updateMany({ where: { key }, data });
  return result.count > 0;
}
