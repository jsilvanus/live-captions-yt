/**
 * Web Radio config DB helpers (plan/selfservice_config_backend §3).
 *
 * radio_config is a single-row-per-key table for metadata (title, description,
 * cover image, autoplay). The `radio_enabled` admin entitlement itself stays
 * on api_keys and is surfaced here read-only — see the plan's §3 self-service
 * enable/disable decision.
 */

/**
 * Ensure the radio_config table exists. Safe to call on every startup.
 * @param {import('better-sqlite3').Database} db
 */
export function runRadioMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_config (
      api_key         TEXT PRIMARY KEY,
      title           TEXT,
      description     TEXT,
      cover_image_url TEXT,
      autoplay        INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function formatConfigRow(row, radioEnabled) {
  return {
    title:         row?.title ?? null,
    description:   row?.description ?? null,
    coverImageUrl: row?.cover_image_url ?? null,
    autoplay:      row?.autoplay === 1,
    enabled:       radioEnabled === 1,
  };
}

/**
 * Get the Web Radio config for an API key, including the read-only
 * `radio_enabled` admin entitlement as `enabled`.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ title: string|null, description: string|null, coverImageUrl: string|null, autoplay: boolean, enabled: boolean }}
 */
export function getRadioConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM radio_config WHERE api_key = ?').get(apiKey);
  const keyRow = db.prepare('SELECT radio_enabled FROM api_keys WHERE key = ?').get(apiKey);
  return formatConfigRow(row, keyRow?.radio_enabled ?? 0);
}

/**
 * Upsert the Web Radio config for an API key. Only provided fields are changed.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ title?: string|null, description?: string|null, coverImageUrl?: string|null, autoplay?: boolean }} patch
 * @returns {{ ok: true, config: object }}
 */
export function setRadioConfig(db, apiKey, patch = {}) {
  const existing = db.prepare('SELECT * FROM radio_config WHERE api_key = ?').get(apiKey);
  const next = {
    title:         patch.title         !== undefined ? patch.title         : existing?.title ?? null,
    description:   patch.description   !== undefined ? patch.description   : existing?.description ?? null,
    coverImageUrl: patch.coverImageUrl !== undefined ? patch.coverImageUrl : existing?.cover_image_url ?? null,
    autoplay:      patch.autoplay      !== undefined ? Boolean(patch.autoplay) : existing?.autoplay === 1,
  };

  db.prepare(`
    INSERT INTO radio_config (api_key, title, description, cover_image_url, autoplay)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(api_key) DO UPDATE SET
      title           = excluded.title,
      description     = excluded.description,
      cover_image_url = excluded.cover_image_url,
      autoplay        = excluded.autoplay,
      updated_at      = datetime('now')
  `).run(apiKey, next.title, next.description, next.coverImageUrl, next.autoplay ? 1 : 0);

  return { ok: true, config: getRadioConfig(db, apiKey) };
}
