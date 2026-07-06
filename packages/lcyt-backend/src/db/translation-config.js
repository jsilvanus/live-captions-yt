/**
 * Translation config DB helpers — server-persisted replacement for lcyt-web's
 * localStorage-only translationConfig.js (plan/selfservice_config_backend §1).
 *
 * Split into two tables matching the actual UI shape:
 *   translation_vendor_config — one row per key (vendor choice + credentials)
 *   translation_targets       — a list of language/destination configs per key
 */

import { randomUUID } from 'node:crypto';

const VALID_VENDORS = new Set(['mymemory', 'google', 'deepl', 'libretranslate']);
const VALID_TARGETS = new Set(['captions', 'file', 'backend-file']);
const VALID_FORMATS = new Set(['text', 'youtube', 'vtt']);

const DEFAULT_VENDOR_CONFIG = {
  vendor:       'mymemory',
  vendorApiKey: null,
  libreUrl:     null,
  libreKey:     null,
  showOriginal: false,
};

// ─── Vendor config (single row per key) ──────────────────────────────────────

function formatVendorRow(row) {
  if (!row) return { ...DEFAULT_VENDOR_CONFIG };
  return {
    vendor:       row.vendor,
    vendorApiKey: row.vendor_api_key ?? null,
    libreUrl:     row.libre_url ?? null,
    libreKey:     row.libre_key ?? null,
    showOriginal: row.show_original === 1,
  };
}

/**
 * Get the translation vendor config for an API key, or the defaults if unset.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object}
 */
export function getTranslationVendorConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM translation_vendor_config WHERE api_key = ?').get(apiKey);
  return formatVendorRow(row);
}

/**
 * Upsert the translation vendor config for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ vendor?: string, vendorApiKey?: string|null, libreUrl?: string|null, libreKey?: string|null, showOriginal?: boolean }} patch
 * @returns {{ ok: true, config: object }|{ ok: false, error: string }}
 */
export function setTranslationVendorConfig(db, apiKey, patch = {}) {
  if (patch.vendor !== undefined && !VALID_VENDORS.has(patch.vendor)) {
    return { ok: false, error: `Invalid vendor. Supported: ${[...VALID_VENDORS].join(', ')}` };
  }
  const existing = db.prepare('SELECT * FROM translation_vendor_config WHERE api_key = ?').get(apiKey);
  const current = formatVendorRow(existing);

  const next = {
    vendor:       patch.vendor       !== undefined ? patch.vendor       : current.vendor,
    vendorApiKey: patch.vendorApiKey !== undefined ? patch.vendorApiKey : current.vendorApiKey,
    libreUrl:     patch.libreUrl     !== undefined ? patch.libreUrl     : current.libreUrl,
    libreKey:     patch.libreKey     !== undefined ? patch.libreKey     : current.libreKey,
    showOriginal: patch.showOriginal !== undefined ? Boolean(patch.showOriginal) : current.showOriginal,
  };

  db.prepare(`
    INSERT INTO translation_vendor_config (api_key, vendor, vendor_api_key, libre_url, libre_key, show_original)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(api_key) DO UPDATE SET
      vendor         = excluded.vendor,
      vendor_api_key = excluded.vendor_api_key,
      libre_url      = excluded.libre_url,
      libre_key      = excluded.libre_key,
      show_original  = excluded.show_original,
      updated_at     = datetime('now')
  `).run(apiKey, next.vendor, next.vendorApiKey, next.libreUrl, next.libreKey, next.showOriginal ? 1 : 0);

  return { ok: true, config: getTranslationVendorConfig(db, apiKey) };
}

// ─── Translation targets (list per key) ──────────────────────────────────────

function formatTargetRow(row) {
  return {
    id:        row.id,
    enabled:   row.enabled === 1,
    lang:      row.lang,
    target:    row.target,
    format:    row.format ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all translation targets for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object[]}
 */
export function getTranslationTargets(db, apiKey) {
  return db.prepare('SELECT * FROM translation_targets WHERE api_key = ? ORDER BY sort_order, created_at')
    .all(apiKey)
    .map(formatTargetRow);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {object|null}
 */
export function getTranslationTarget(db, apiKey, id) {
  const row = db.prepare('SELECT * FROM translation_targets WHERE api_key = ? AND id = ?').get(apiKey, id);
  return row ? formatTargetRow(row) : null;
}

function validateTargetFields({ lang, target, format }) {
  if (!lang || typeof lang !== 'string') return 'lang is required';
  if (!VALID_TARGETS.has(target)) return `Invalid target. Supported: ${[...VALID_TARGETS].join(', ')}`;
  if (format !== undefined && format !== null && !VALID_FORMATS.has(format)) {
    return `Invalid format. Supported: ${[...VALID_FORMATS].join(', ')}`;
  }
  return null;
}

/**
 * Create a translation target for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ id?: string, enabled?: boolean, lang: string, target: string, format?: string|null }} fields
 * @returns {{ ok: true, target: object }|{ ok: false, error: string }}
 */
export function createTranslationTarget(db, apiKey, fields = {}) {
  const { id = randomUUID(), enabled = true, lang, target, format = null } = fields;
  const error = validateTargetFields({ lang, target, format });
  if (error) return { ok: false, error };

  const { maxOrder } = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM translation_targets WHERE api_key = ?').get(apiKey);

  db.prepare(`
    INSERT INTO translation_targets (id, api_key, enabled, lang, target, format, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, apiKey, enabled ? 1 : 0, lang, target, format, maxOrder + 1);

  return { ok: true, target: getTranslationTarget(db, apiKey, id) };
}

/**
 * Update a translation target.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 * @param {{ enabled?: boolean, lang?: string, target?: string, format?: string|null }} patch
 * @returns {{ ok: true, target: object }|{ ok: false, error: string, status?: number }}
 */
export function updateTranslationTarget(db, apiKey, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM translation_targets WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return { ok: false, error: 'Translation target not found', status: 404 };

  const lang   = patch.lang   !== undefined ? patch.lang   : existing.lang;
  const target = patch.target !== undefined ? patch.target : existing.target;
  const format = patch.format !== undefined ? patch.format : existing.format;

  const error = validateTargetFields({ lang, target, format });
  if (error) return { ok: false, error };

  db.prepare(`
    UPDATE translation_targets SET
      enabled    = ?,
      lang       = ?,
      target     = ?,
      format     = ?,
      updated_at = datetime('now')
    WHERE api_key = ? AND id = ?
  `).run(
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    lang, target, format,
    apiKey, id,
  );
  return { ok: true, target: getTranslationTarget(db, apiKey, id) };
}

/**
 * Delete a translation target.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {boolean} true if a row was deleted
 */
export function deleteTranslationTarget(db, apiKey, id) {
  const result = db.prepare('DELETE FROM translation_targets WHERE api_key = ? AND id = ?').run(apiKey, id);
  return result.changes > 0;
}
