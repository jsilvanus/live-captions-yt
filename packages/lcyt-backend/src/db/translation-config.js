/**
 * Translation config DB helpers — server-persisted replacement for lcyt-web's
 * localStorage-only translationConfig.js (plan/selfservice_config_backend §1).
 *
 * Split into two tables matching the actual UI shape:
 *   translation_vendor_config — one row per key (vendor choice + credentials)
 *   translation_targets       — a list of language/destination configs per key
 *                               + per-target routing (Phase 5: caption_target_id,
 *                               show_original per row instead of global flag)
 */

import { randomUUID } from 'node:crypto';
import { sqlNow } from './helpers.js';

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
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
export async function getTranslationVendorConfig(db, apiKey) {
  const row = await db.translation_vendor_config.findUnique({ where: { api_key: apiKey } });
  return formatVendorRow(row);
}

/**
 * Upsert the translation vendor config for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ vendor?: string, vendorApiKey?: string|null, libreUrl?: string|null, libreKey?: string|null, showOriginal?: boolean }} patch
 * @returns {Promise<{ ok: true, config: object }|{ ok: false, error: string }>}
 */
export async function setTranslationVendorConfig(db, apiKey, patch = {}) {
  if (patch.vendor !== undefined && !VALID_VENDORS.has(patch.vendor)) {
    return { ok: false, error: `Invalid vendor. Supported: ${[...VALID_VENDORS].join(', ')}` };
  }
  const existing = await db.translation_vendor_config.findUnique({ where: { api_key: apiKey } });
  const current = formatVendorRow(existing);

  const next = {
    vendor:       patch.vendor       !== undefined ? patch.vendor       : current.vendor,
    vendorApiKey: patch.vendorApiKey !== undefined ? patch.vendorApiKey : current.vendorApiKey,
    libreUrl:     patch.libreUrl     !== undefined ? patch.libreUrl     : current.libreUrl,
    libreKey:     patch.libreKey     !== undefined ? patch.libreKey     : current.libreKey,
    showOriginal: patch.showOriginal !== undefined ? Boolean(patch.showOriginal) : current.showOriginal,
  };

  const data = {
    vendor:         next.vendor,
    vendor_api_key: next.vendorApiKey,
    libre_url:      next.libreUrl,
    libre_key:      next.libreKey,
    show_original:  next.showOriginal ? 1 : 0,
    updated_at:     sqlNow(),
  };
  await db.translation_vendor_config.upsert({
    where: { api_key: apiKey },
    create: { api_key: apiKey, ...data },
    update: data,
  });

  return { ok: true, config: await getTranslationVendorConfig(db, apiKey) };
}

// ─── Translation targets (list per key) ──────────────────────────────────────

function formatTargetRow(row) {
  return {
    id:               row.id,
    enabled:          row.enabled === 1,
    lang:             row.lang,
    target:           row.target,
    format:           row.format ?? null,
    sortOrder:        row.sort_order,
    captionTargetId:  row.caption_target_id ?? null,
    showOriginal:     row.show_original === 1,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

/**
 * Get all translation targets for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<object[]>}
 */
export async function getTranslationTargets(db, apiKey) {
  const rows = await db.translation_targets.findMany({
    where: { api_key: apiKey },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map(formatTargetRow);
}

/**
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getTranslationTarget(db, apiKey, id) {
  const row = await db.translation_targets.findFirst({ where: { api_key: apiKey, id } });
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
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ id?: string, enabled?: boolean, lang: string, target: string, format?: string|null, captionTargetId?: string|null, showOriginal?: boolean }} fields
 * @returns {Promise<{ ok: true, target: object }|{ ok: false, error: string }>}
 */
export async function createTranslationTarget(db, apiKey, fields = {}) {
  const { id = randomUUID(), enabled = true, lang, target, format = null, captionTargetId = null, showOriginal = false } = fields;
  const error = validateTargetFields({ lang, target, format });
  if (error) return { ok: false, error };

  const agg = await db.translation_targets.aggregate({ where: { api_key: apiKey }, _max: { sort_order: true } });
  const maxOrder = agg._max.sort_order ?? -1;

  const now = sqlNow();
  await db.translation_targets.create({
    data: {
      id,
      api_key: apiKey,
      enabled: enabled ? 1 : 0,
      lang,
      target,
      format,
      sort_order: maxOrder + 1,
      caption_target_id: captionTargetId ?? null,
      show_original: showOriginal ? 1 : 0,
      created_at: now,
      updated_at: now,
    },
  });

  return { ok: true, target: await getTranslationTarget(db, apiKey, id) };
}

/**
 * Update a translation target.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} id
 * @param {{ enabled?: boolean, lang?: string, target?: string, format?: string|null, captionTargetId?: string|null, showOriginal?: boolean }} patch
 * @returns {Promise<{ ok: true, target: object }|{ ok: false, error: string, status?: number }>}
 */
export async function updateTranslationTarget(db, apiKey, id, patch = {}) {
  const existing = await db.translation_targets.findFirst({ where: { api_key: apiKey, id } });
  if (!existing) return { ok: false, error: 'Translation target not found', status: 404 };

  const lang              = patch.lang              !== undefined ? patch.lang              : existing.lang;
  const target            = patch.target           !== undefined ? patch.target           : existing.target;
  const format            = patch.format           !== undefined ? patch.format           : existing.format;
  const captionTargetId   = patch.captionTargetId  !== undefined ? patch.captionTargetId  : existing.caption_target_id;
  const showOriginal      = patch.showOriginal     !== undefined ? patch.showOriginal     : existing.show_original === 1;

  const error = validateTargetFields({ lang, target, format });
  if (error) return { ok: false, error };

  await db.translation_targets.updateMany({
    where: { api_key: apiKey, id },
    data: {
      enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
      lang,
      target,
      format,
      caption_target_id: captionTargetId ?? null,
      show_original: showOriginal ? 1 : 0,
      updated_at: sqlNow(),
    },
  });
  return { ok: true, target: await getTranslationTarget(db, apiKey, id) };
}

/**
 * Delete a translation target.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteTranslationTarget(db, apiKey, id) {
  const result = await db.translation_targets.deleteMany({ where: { api_key: apiKey, id } });
  return result.count > 0;
}
