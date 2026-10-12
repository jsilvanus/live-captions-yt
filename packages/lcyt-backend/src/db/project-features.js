import { sqlNow } from './helpers.js';

/**
 * Project feature flag helpers.
 *
 * Feature flags control which capabilities are enabled for a given API key.
 * The same feature code schema is also used for user-level entitlements
 * (user_features), which govern which features a user may enable on their projects.
 */

/**
 * Required dependencies between feature codes.
 * Enabling a key automatically enables all values.
 */
export const KNOWN_FEATURE_CODES = new Set([
  'captions',
  'viewer-target',
  'mic-lock',
  'stats',
  'collaboration',
  'translations',
  'embed',
  'file-saving',
  'files-local',
  'files-managed-bucket',
  'files-custom-bucket',
  'files-webdav',
  'files-browser-local',
  'graphics-client',
  'restream',
  'ingest',
  'radio',
  'hls-stream',
  'preview',
  'stt-server',
  'device-control',
  'graphics-server',
  'cea-captions',
  'crop',
  'broadcast-platforms',
  'ai-agent',
  'mcp-access',
]);

export const BINARY_ONLY_FEATURES = new Set([
  'ingest',
  'radio',
  'hls-stream',
  'preview',
  'stt-server',
  'device-control',
  'graphics-server',
  'cea-captions',
  'crop',
  // Costs money per use (LLM calls): operators grant it, projects cannot self-enable it.
  'ai-agent',
]);

export const FEATURE_DEPS = {
  'graphics-server':       ['graphics-client', 'ingest'],
  'stt-server':            ['ingest'],
  'radio':                 ['ingest'],
  'hls-stream':            ['ingest'],
  'preview':               ['ingest'],
  // Vertical crop rendition (plan_vertical_crop.md) — cut from the RTMP ingest
  'crop':                  ['ingest'],
  // Server-side platform OAuth (YouTube scheduling, thumbnails, stats) publishes captioned broadcasts
  'broadcast-platforms':   ['captions'],
  // File storage modes — each requires the base file-saving capability.
  // At most one storage mode should be enabled at a time per project.
  //   files-local          → save to the server's local filesystem (default)
  //   files-managed-bucket → save to the operator-configured S3 bucket
  //   files-custom-bucket  → save to the user's own S3 bucket (configured via /file/storage-config)
  //   files-webdav         → save to a user-configured WebDAV server
  //   files-browser-local  → save directly to the user's computer via browser File System Access API
  'files-local':           ['file-saving'],
  'files-managed-bucket':  ['file-saving'],
  'files-custom-bucket':   ['file-saving'],
  'files-webdav':          ['file-saving'],
  'files-browser-local':   [],
};

/**
 * Mutates featureMap to add any missing dependency codes.
 * @param {Record<string, boolean | { enabled: boolean, config?: object }>} featureMap
 * @returns {string[]} list of codes that were auto-enabled
 */
export function applyFeatureDeps(featureMap) {
  const autoEnabled = [];
  for (const [code, deps] of Object.entries(FEATURE_DEPS)) {
    const val = featureMap[code];
    const enabling = typeof val === 'boolean' ? val : val?.enabled;
    if (enabling) {
      for (const dep of deps) {
        if (!featureMap[dep]) {
          featureMap[dep] = true;
          autoEnabled.push(dep);
        }
      }
    }
  }
  return autoEnabled;
}

/**
 * Run fn inside a transaction; when db already is a transaction client, just use it.
 * @template T
 * @param {import('./connection.js').Db} db
 * @param {(tx: import('./connection.js').Db) => Promise<T>} fn
 * @returns {Promise<T>}
 */
function inTx(db, fn) {
  return typeof db.$transaction === 'function' ? db.$transaction(fn) : fn(db);
}

/**
 * Get all feature rows for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array<{ feature_code: string, enabled: number, config: string|null, granted_at: string }>>}
 */
export async function getProjectFeatures(db, apiKey) {
  return db.project_features.findMany({
    where: { api_key: apiKey },
    select: { feature_code: true, enabled: true, config: true, granted_at: true },
    orderBy: { feature_code: 'asc' },
  });
}

/**
 * Returns a Set of enabled feature codes for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Set<string>>}
 */
export async function getEnabledFeatureSet(db, apiKey) {
  const rows = await db.project_features.findMany({
    where: { api_key: apiKey, enabled: 1 },
    select: { feature_code: true },
  });
  return new Set(rows.map(r => r.feature_code));
}

/**
 * Check whether a single feature is enabled for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} featureCode
 * @returns {Promise<boolean>}
 */
export async function hasFeature(db, apiKey, featureCode) {
  const row = await db.project_features.findUnique({
    where: { api_key_feature_code: { api_key: apiKey, feature_code: featureCode } },
    select: { enabled: true },
  });
  return row?.enabled === 1;
}

/**
 * Upsert a single feature flag for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} featureCode
 * @param {boolean} enabled
 * @param {object|null} [config]
 * @param {number|null} [grantedBy]
 * @returns {Promise<void>}
 */
export async function setProjectFeature(db, apiKey, featureCode, enabled, config = null, grantedBy = null) {
  const data = {
    enabled: enabled ? 1 : 0,
    config: config != null ? JSON.stringify(config) : null,
    granted_by: grantedBy ?? null,
    granted_at: sqlNow(),
  };
  await db.project_features.upsert({
    where: { api_key_feature_code: { api_key: apiKey, feature_code: featureCode } },
    create: { api_key: apiKey, feature_code: featureCode, ...data },
    update: data,
  });
}

/**
 * Batch-upsert feature flags for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {Record<string, boolean | { enabled: boolean, config?: object }>} featureMap
 * @param {number|null} [grantedBy]
 * @returns {Promise<void>}
 */
export async function setProjectFeatures(db, apiKey, featureMap, grantedBy = null) {
  await inTx(db, async (tx) => {
    for (const [code, value] of Object.entries(featureMap)) {
      const enabled = typeof value === 'boolean' ? value : value.enabled;
      const config  = typeof value === 'object' && value !== null ? (value.config ?? null) : null;
      await setProjectFeature(tx, apiKey, code, enabled, config, grantedBy);
    }
  });
}

// ── User-level entitlements ───────────────────────────────────────────────────

/**
 * Get all enabled feature codes for a user (their entitlements).
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<Set<string>>}
 */
export async function getUserFeatureSet(db, userId) {
  const rows = await db.user_features.findMany({
    where: { user_id: userId, enabled: 1 },
    select: { feature_code: true },
  });
  return new Set(rows.map(r => r.feature_code));
}

const POLICY_FIELDS = { feature_code: true, mode: true, updated_by: true, updated_at: true };
const OVERRIDE_FIELDS = { org_id: true, feature_code: true, mode: true, set_by: true, set_at: true };

/**
 * Get the site-wide feature policy row for a feature code.
 * @param {import('./connection.js').Db} db
 * @param {string} featureCode
 * @returns {Promise<{ feature_code: string, mode: string, updated_by: number|null, updated_at: string }|undefined>}
 */
export async function getSiteFeaturePolicy(db, featureCode) {
  return (await db.site_feature_policies.findUnique({ where: { feature_code: featureCode }, select: POLICY_FIELDS })) ?? undefined;
}

/**
 * Get all site-wide feature policy rows.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<Array<{ feature_code: string, mode: string, updated_by: number|null, updated_at: string }>>}
 */
export async function getSiteFeaturePolicies(db) {
  return db.site_feature_policies.findMany({ select: POLICY_FIELDS, orderBy: { feature_code: 'asc' } });
}

/**
 * Upsert a site-wide feature policy row.
 * @param {import('./connection.js').Db} db
 * @param {string} featureCode
 * @param {'available'|'self_service'|'denied'} mode
 * @param {number|null} [updatedBy]
 * @returns {Promise<void>}
 */
export async function setSiteFeaturePolicy(db, featureCode, mode, updatedBy = null) {
  const data = { mode, updated_by: updatedBy ?? null, updated_at: sqlNow() };
  await db.site_feature_policies.upsert({
    where: { feature_code: featureCode },
    create: { feature_code: featureCode, ...data },
    update: data,
  });
}

/**
 * Get an org override row for a feature code.
 * @param {import('./connection.js').Db} db
 * @param {number} orgId
 * @param {string} featureCode
 * @returns {Promise<{ org_id: number, feature_code: string, mode: string, set_by: number|null, set_at: string }|undefined>}
 */
export async function getOrgFeatureOverride(db, orgId, featureCode) {
  return (await db.org_feature_overrides.findUnique({
    where: { org_id_feature_code: { org_id: orgId, feature_code: featureCode } },
    select: OVERRIDE_FIELDS,
  })) ?? undefined;
}

/**
 * Get all org feature override rows for an org.
 * @param {import('./connection.js').Db} db
 * @param {number} orgId
 * @returns {Promise<Array<{ org_id: number, feature_code: string, mode: string, set_by: number|null, set_at: string }>>}
 */
export async function getOrgFeatureOverrides(db, orgId) {
  return db.org_feature_overrides.findMany({
    where: { org_id: orgId },
    select: OVERRIDE_FIELDS,
    orderBy: { feature_code: 'asc' },
  });
}

/**
 * Upsert an org feature override row.
 * @param {import('./connection.js').Db} db
 * @param {number} orgId
 * @param {string} featureCode
 * @param {'available'|'self_service'|'denied'} mode
 * @param {number|null} [setBy]
 * @returns {Promise<void>}
 */
export async function setOrgFeatureOverride(db, orgId, featureCode, mode, setBy = null) {
  const data = { mode, set_by: setBy ?? null, set_at: sqlNow() };
  await db.org_feature_overrides.upsert({
    where: { org_id_feature_code: { org_id: orgId, feature_code: featureCode } },
    create: { org_id: orgId, feature_code: featureCode, ...data },
    update: data,
  });
}

/**
 * Remove an org feature override row.
 * @param {import('./connection.js').Db} db
 * @param {number} orgId
 * @param {string} featureCode
 * @returns {Promise<void>}
 */
export async function clearOrgFeatureOverride(db, orgId, featureCode) {
  await db.org_feature_overrides.deleteMany({ where: { org_id: orgId, feature_code: featureCode } });
}

/**
 * Resolve the effective policy mode for a feature for a project.
 * Org override wins over site-wide default; personal projects use site default.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} featureCode
 * @returns {Promise<'available'|'self_service'|'denied'>}
 */
export async function resolveFeaturePolicy(db, apiKey, featureCode) {
  const projectRow = await db.api_keys.findUnique({ where: { key: apiKey }, select: { org_id: true } });
  if (projectRow?.org_id != null) {
    const override = await getOrgFeatureOverride(db, projectRow.org_id, featureCode);
    if (override) return override.mode;
  }
  const policy = await getSiteFeaturePolicy(db, featureCode);
  return policy?.mode ?? 'denied';
}

/**
 * Get all user_features rows for a user.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<Array<{ feature_code: string, enabled: number, config: string|null, granted_at: string }>>}
 */
export async function getUserFeatures(db, userId) {
  return db.user_features.findMany({
    where: { user_id: userId },
    select: { feature_code: true, enabled: true, config: true, granted_at: true },
    orderBy: { feature_code: 'asc' },
  });
}

/**
 * Upsert a single user feature entitlement.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @param {string} featureCode
 * @param {boolean} enabled
 * @param {number|null} [grantedBy]
 * @returns {Promise<void>}
 */
export async function setUserFeature(db, userId, featureCode, enabled, grantedBy = null) {
  const data = { enabled: enabled ? 1 : 0, granted_by: grantedBy ?? null, granted_at: sqlNow() };
  await db.user_features.upsert({
    where: { user_id_feature_code: { user_id: userId, feature_code: featureCode } },
    create: { user_id: userId, feature_code: featureCode, ...data },
    update: data,
  });
}

/**
 * Provision default user feature entitlements for a newly registered user.
 * Called from auth.js register handler. Existing rows are left untouched.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<void>}
 */
export async function provisionDefaultUserFeatures(db, userId) {
  const defaults = ['captions', 'viewer-target', 'mic-lock', 'stats', 'translations', 'embed'];
  await inTx(db, async (tx) => {
    for (const code of defaults) {
      await tx.user_features.upsert({
        where: { user_id_feature_code: { user_id: userId, feature_code: code } },
        create: { user_id: userId, feature_code: code, enabled: 1, granted_at: sqlNow() },
        update: {},
      });
    }
  });
}

/**
 * Provision default project features for a newly created API key.
 * Called from keys.js user-create handler. Existing rows are left untouched.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string[]} [extra] - Additional feature codes beyond defaults
 * @param {number|null} [orgId]
 * @returns {Promise<void>}
 */
export async function provisionDefaultProjectFeatures(db, apiKey, extra = [], orgId = null) {
  const defaults = ['captions', 'viewer-target', 'mic-lock', 'stats', 'translations', 'embed'];
  const codes = new Set([...defaults, ...extra]);

  const availablePolicies = await db.site_feature_policies.findMany({
    where: { mode: 'available' },
    select: { feature_code: true },
  });
  for (const policy of availablePolicies) {
    codes.add(policy.feature_code);
  }

  if (orgId != null) {
    const overrides = await getOrgFeatureOverrides(db, orgId);
    for (const override of overrides) {
      if (override.mode === 'available') {
        codes.add(override.feature_code);
      }
    }
  }

  await inTx(db, async (tx) => {
    for (const code of codes) {
      await tx.project_features.upsert({
        where: { api_key_feature_code: { api_key: apiKey, feature_code: code } },
        create: { api_key: apiKey, feature_code: code, enabled: 1, granted_at: sqlNow() },
        update: {},
      });
    }
  });
}

/**
 * Capabilities that gained a feature flag after projects already used them.
 * Each entry names the table that shows a project uses the capability and the
 * query selecting the API keys that do.
 */
const CAPABILITY_BACKFILLS = [
  {
    code: 'broadcast-platforms',
    table: 'platform_credentials',
    keys: 'SELECT DISTINCT api_key FROM platform_credentials WHERE revoked_at IS NULL',
  },
  {
    code: 'mcp-access',
    table: 'mcp_tokens',
    keys: 'SELECT DISTINCT api_key FROM mcp_tokens WHERE revoked_at IS NULL',
  },
  {
    code: 'ai-agent',
    table: 'project_ai_role_configs',
    keys: 'SELECT DISTINCT api_key FROM project_ai_role_configs WHERE enabled = 1',
  },
  {
    code: 'ai-agent',
    table: 'ai_config',
    keys: "SELECT api_key FROM ai_config WHERE embedding_provider != 'none'",
  },
];

/**
 * Enable the flag (and give the owning user the entitlement) for every project
 * that already uses the capability, so adding the flag does not switch
 * anything off. Idempotent: existing rows, including explicit "disabled" ones,
 * are left alone. Tables owned by plugins that are not installed are skipped.
 * Run after the plugin migrations.
 * @param {import('better-sqlite3').Database} db
 * @returns {{ projects: number, users: number }} rows added
 */
export function backfillCapabilityFeatures(db) {
  const tableExists = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  const addProject = db.prepare(`
    INSERT INTO project_features (api_key, feature_code, enabled, config)
    VALUES (?, ?, 1, NULL)
    ON CONFLICT (api_key, feature_code) DO NOTHING
  `);
  const addUser = db.prepare(`
    INSERT INTO user_features (user_id, feature_code, enabled)
    VALUES (?, ?, 1)
    ON CONFLICT (user_id, feature_code) DO NOTHING
  `);
  const ownerOf = db.prepare('SELECT user_id FROM api_keys WHERE key = ?');

  let projects = 0;
  let users = 0;
  db.transaction(() => {
    for (const { code, table, keys } of CAPABILITY_BACKFILLS) {
      if (!tableExists(table)) continue;
      for (const { api_key: apiKey } of db.prepare(keys).all()) {
        if (!ownerOf.get(apiKey)) continue; // key no longer exists
        projects += addProject.run(apiKey, code).changes;
        const userId = ownerOf.get(apiKey)?.user_id;
        if (userId != null) users += addUser.run(userId, code).changes;
      }
    }
  })();
  return { projects, users };
}
