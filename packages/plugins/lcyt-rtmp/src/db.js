/**
 * Database helpers for the lcyt-rtmp plugin (async, Prisma client).
 *
 * The tables (rtmp_relays, rtmp_stream_stats, rtmp_anon_daily_stats, stt_config, stt_source_languages,
 * radio_config, crop_*) and the api_keys columns come from the backend's Prisma schema / PostgreSQL
 * migrations; the plugin runs no migrations.
 */
// ── STT config DB helpers ──────────────────────────────────────────────────

/**
 * Get STT config for an API key, or null if none exists.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<{ provider: string, language: string, audioSource: string, streamKey: string|null, autoStart: boolean, confidenceThreshold: number|null }|null>}
 */
export async function getSttConfig(db, apiKey) {
  const row = await db.stt_config.findUnique({ where: { api_key: apiKey } });
  if (!row) return null;
  return {
    provider:            row.provider,
    language:            row.language,
    audioSource:         row.audio_source,
    streamKey:           row.stream_key ?? null,
    autoStart:           Boolean(row.auto_start),
    confidenceThreshold: row.confidence_threshold ?? null,
  };
}

/**
 * Upsert STT config for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {{ provider?: string, language?: string, audioSource?: string, streamKey?: string|null, autoStart?: boolean, confidenceThreshold?: number|null }} opts
 * @returns {Promise<void>}
 */
export async function setSttConfig(db, apiKey, { provider, language, audioSource, streamKey, autoStart, confidenceThreshold } = {}) {
  const existing = await db.stt_config.findUnique({ where: { api_key: apiKey } });
  const now = Math.floor(Date.now() / 1000);
  if (!existing) {
    await db.stt_config.create({
      data: {
        api_key: apiKey,
        provider:    provider    ?? 'google',
        language:    language    ?? 'en-US',
        audio_source: audioSource ?? 'hls',
        stream_key:  streamKey   ?? null,
        auto_start:  autoStart ? 1 : 0,
        confidence_threshold: confidenceThreshold !== undefined ? (confidenceThreshold ?? null) : null,
        created_at: now,
        updated_at: now,
      },
    });
  } else {
    await db.stt_config.update({
      where: { api_key: apiKey },
      data: {
        provider:     provider    ?? existing.provider,
        language:     language    ?? existing.language,
        audio_source: audioSource ?? existing.audio_source,
        stream_key:   streamKey   !== undefined ? (streamKey ?? null) : existing.stream_key,
        auto_start:   autoStart   !== undefined ? (autoStart ? 1 : 0) : existing.auto_start,
        confidence_threshold: confidenceThreshold !== undefined ? (confidenceThreshold ?? null) : existing.confidence_threshold ?? null,
        updated_at:   now,
      },
    });
  }
}

// ── STT source languages DB helpers ────────────────────────────────────────

/**
 * Get all source languages for an API key.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array<{ id: number, lang: string, label: string|null, sortOrder: number, createdAt: number, updatedAt: number }>>}
 */
export async function getSttSourceLanguages(db, apiKey) {
  const rows = await db.stt_source_languages.findMany({
    where: { api_key: apiKey },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
  });
  return rows.map(row => ({
    id:        row.id,
    lang:      row.lang,
    label:     row.label ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Add a source language to the predefined list.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {string} lang - BCP-47 language code
 * @param {{ label?: string, sortOrder?: number }} opts
 * @returns {Promise<{ ok: true, language: object } | { ok: false, error: string }>}
 */
export async function addSttSourceLanguage(db, apiKey, lang, { label = null, sortOrder = null } = {}) {
  if (!lang || typeof lang !== 'string') {
    return { ok: false, error: 'lang is required' };
  }
  try {
    const existing = await db.stt_source_languages.findUnique({ where: { api_key_lang: { api_key: apiKey, lang } } });
    if (existing) {
      return { ok: false, error: 'Language already in the list' };
    }
    let order = sortOrder;
    if (order === undefined || order === null) {
      const agg = await db.stt_source_languages.aggregate({ where: { api_key: apiKey }, _max: { sort_order: true } });
      order = (agg._max.sort_order ?? -1) + 1;
    }
    const now = Math.floor(Date.now() / 1000);
    const row = await db.stt_source_languages.create({
      data: { api_key: apiKey, lang, label: label ?? null, sort_order: order, created_at: now, updated_at: now },
    });
    return { ok: true, language: { id: row.id, lang: row.lang, label: row.label ?? null, sortOrder: row.sort_order } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Update a source language entry.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {number} id
 * @param {{ label?: string, sortOrder?: number }} patch
 * @returns {Promise<{ ok: true, language: object } | { ok: false, error: string, status?: number }>}
 */
export async function updateSttSourceLanguage(db, apiKey, id, { label, sortOrder } = {}) {
  id = Number(id);
  if (!Number.isInteger(id)) return { ok: false, error: 'Language not found', status: 404 };
  const existing = await db.stt_source_languages.findFirst({ where: { api_key: apiKey, id } });
  if (!existing) {
    return { ok: false, error: 'Language not found', status: 404 };
  }
  try {
    const row = await db.stt_source_languages.update({
      where: { id: existing.id },
      data: {
        label: label !== undefined ? label : existing.label,
        sort_order: sortOrder ?? existing.sort_order,
        updated_at: Math.floor(Date.now() / 1000),
      },
    });
    return { ok: true, language: { id: row.id, lang: row.lang, label: row.label ?? null, sortOrder: row.sort_order } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Remove a source language from the predefined list.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {number} id
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteSttSourceLanguage(db, apiKey, id) {
  id = Number(id);
  if (!Number.isInteger(id)) return false;
  const result = await db.stt_source_languages.deleteMany({ where: { api_key: apiKey, id } });
  return result.count > 0;
}

export * from './db/relay.js';
export * from './db/radio.js';
export * from './db/crop.js';
