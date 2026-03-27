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
export const FEATURE_DEPS = {
  'graphics-server':       ['graphics-client', 'ingest'],
  'stt-server':            ['ingest'],
  'radio':                 ['ingest'],
  'hls-stream':            ['ingest'],
  'preview':               ['ingest'],
  // File storage modes — each requires the base file-saving capability.
  // At most one storage mode should be enabled at a time per project.
  //   files-local          → save to the server's local filesystem (default)
  //   files-managed-bucket → save to the operator-configured S3 bucket
  //   files-custom-bucket  → save to the user's own S3 bucket (configured via /file/storage-config)
  'files-local':           ['file-saving'],
  'files-managed-bucket':  ['file-saving'],
  'files-custom-bucket':   ['file-saving'],
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
 * Get all feature rows for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<{ feature_code: string, enabled: number, config: string|null, granted_at: string }>}
 */
export function getProjectFeatures(db, apiKey) {
  return db.prepare(
    'SELECT feature_code, enabled, config, granted_at FROM project_features WHERE api_key = ? ORDER BY feature_code'
  ).all(apiKey);
}

/**
 * Returns a Set of enabled feature codes for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Set<string>}
 */
export function getEnabledFeatureSet(db, apiKey) {
  const rows = db.prepare(
    'SELECT feature_code FROM project_features WHERE api_key = ? AND enabled = 1'
  ).all(apiKey);
  return new Set(rows.map(r => r.feature_code));
}

/**
 * Check whether a single feature is enabled for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} featureCode
 * @returns {boolean}
 */
export function hasFeature(db, apiKey, featureCode) {
  const row = db.prepare(
    'SELECT enabled FROM project_features WHERE api_key = ? AND feature_code = ?'
  ).get(apiKey, featureCode);
  return row?.enabled === 1;
}

/**
 * Upsert a single feature flag for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} featureCode
 * @param {boolean} enabled
 * @param {object|null} [config]
 * @param {number|null} [grantedBy]
 */
export function setProjectFeature(db, apiKey, featureCode, enabled, config = null, grantedBy = null) {
  db.prepare(`
    INSERT INTO project_features (api_key, feature_code, enabled, config, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (api_key, feature_code) DO UPDATE SET
      enabled    = excluded.enabled,
      config     = excluded.config,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at
  `).run(
    apiKey,
    featureCode,
    enabled ? 1 : 0,
    config != null ? JSON.stringify(config) : null,
    grantedBy ?? null,
  );
}

/**
 * Batch-upsert feature flags for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {Record<string, boolean | { enabled: boolean, config?: object }>} featureMap
 * @param {number|null} [grantedBy]
 */
export function setProjectFeatures(db, apiKey, featureMap, grantedBy = null) {
  const tx = db.transaction(() => {
    for (const [code, value] of Object.entries(featureMap)) {
      const enabled = typeof value === 'boolean' ? value : value.enabled;
      const config  = typeof value === 'object' && value !== null ? (value.config ?? null) : null;
      setProjectFeature(db, apiKey, code, enabled, config, grantedBy);
    }
  });
  tx();
}

// ── User-level entitlements ───────────────────────────────────────────────────

/**
 * Get all enabled feature codes for a user (their entitlements).
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @returns {Set<string>}
 */
export function getUserFeatureSet(db, userId) {
  const rows = db.prepare(
    'SELECT feature_code FROM user_features WHERE user_id = ? AND enabled = 1'
  ).all(userId);
  return new Set(rows.map(r => r.feature_code));
}

/**
 * Get all user_features rows for a user.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @returns {Array}
 */
export function getUserFeatures(db, userId) {
  return db.prepare(
    'SELECT feature_code, enabled, config, granted_at FROM user_features WHERE user_id = ? ORDER BY feature_code'
  ).all(userId);
}

/**
 * Upsert a single user feature entitlement.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {string} featureCode
 * @param {boolean} enabled
 * @param {number|null} [grantedBy]
 */
export function setUserFeature(db, userId, featureCode, enabled, grantedBy = null) {
  db.prepare(`
    INSERT INTO user_features (user_id, feature_code, enabled, granted_by, granted_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, feature_code) DO UPDATE SET
      enabled    = excluded.enabled,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at
  `).run(userId, featureCode, enabled ? 1 : 0, grantedBy ?? null);
}

/**
 * Provision default user feature entitlements for a newly registered user.
 * Called from auth.js register handler.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 */
export function provisionDefaultUserFeatures(db, userId) {
  const defaults = ['captions', 'viewer-target', 'mic-lock', 'stats', 'translations', 'embed'];
  const stmt = db.prepare(`
    INSERT INTO user_features (user_id, feature_code, enabled)
    VALUES (?, ?, 1)
    ON CONFLICT (user_id, feature_code) DO NOTHING
  `);
  const tx = db.transaction(() => {
    for (const code of defaults) {
      stmt.run(userId, code);
    }
  });
  tx();
}

/**
 * Provision default project features for a newly created API key.
 * Called from keys.js user-create handler.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string[]} [extra] - Additional feature codes beyond defaults
 */
export function provisionDefaultProjectFeatures(db, apiKey, extra = []) {
  // file-saving + files-local are included so new projects can save caption files
  // to the server's local filesystem out of the box.
  const defaults = ['captions', 'viewer-target', 'mic-lock', 'stats', 'translations', 'embed', 'file-saving', 'files-local'];
  const codes = [...new Set([...defaults, ...extra])];
  const stmt = db.prepare(`
    INSERT INTO project_features (api_key, feature_code, enabled)
    VALUES (?, ?, 1)
    ON CONFLICT (api_key, feature_code) DO NOTHING
  `);
  const tx = db.transaction(() => {
    for (const code of codes) {
      stmt.run(apiKey, code);
    }
  });
  tx();
}
