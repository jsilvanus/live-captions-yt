// ─── Server-side speech-to-text settings (stt_config, stt_source_languages) ─────
//
// Prisma versions of the helpers lcyt-rtmp keeps for its own (still synchronous, SQLite-only)
// SttManager. The HTTP routes in routes/stt.js use these so they work on both dialects.

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * STT config for an API key, or null when none is stored.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
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
 * Upsert STT config. Omitted provider/language/audioSource/autoStart keep their value;
 * streamKey and confidenceThreshold only change when passed (null clears them).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ provider?: string, language?: string, audioSource?: string, streamKey?: string|null, autoStart?: boolean, confidenceThreshold?: number|null }} opts
 */
export async function setSttConfig(db, apiKey, { provider, language, audioSource, streamKey, autoStart, confidenceThreshold } = {}) {
  const existing = await db.stt_config.findUnique({ where: { api_key: apiKey } });
  if (!existing) {
    await db.stt_config.create({
      data: {
        api_key: apiKey,
        provider: provider ?? 'google',
        language: language ?? 'en-US',
        audio_source: audioSource ?? 'hls',
        stream_key: streamKey ?? null,
        auto_start: autoStart ? 1 : 0,
        confidence_threshold: confidenceThreshold ?? null,
        updated_at: nowSeconds(),
      },
    });
    return;
  }
  await db.stt_config.update({
    where: { api_key: apiKey },
    data: {
      provider: provider ?? existing.provider,
      language: language ?? existing.language,
      audio_source: audioSource ?? existing.audio_source,
      stream_key: streamKey !== undefined ? (streamKey ?? null) : existing.stream_key,
      auto_start: autoStart !== undefined ? (autoStart ? 1 : 0) : existing.auto_start,
      confidence_threshold: confidenceThreshold !== undefined ? (confidenceThreshold ?? null) : existing.confidence_threshold,
      updated_at: nowSeconds(),
    },
  });
}

const languageRow = (r) => ({ id: r.id, lang: r.lang, label: r.label ?? null, sortOrder: r.sort_order });

/** @param {import('./connection.js').Db} db @param {string} apiKey */
export async function getSttSourceLanguages(db, apiKey) {
  const rows = await db.stt_source_languages.findMany({ where: { api_key: apiKey }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
  return rows.map((r) => ({ ...languageRow(r), createdAt: r.created_at, updatedAt: r.updated_at }));
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, language: object }|{ ok: false, error: string }>}
 */
export async function addSttSourceLanguage(db, apiKey, lang, { label = null, sortOrder = null } = {}) {
  if (!lang || typeof lang !== 'string') return { ok: false, error: 'lang is required' };
  try {
    const existing = await db.stt_source_languages.findFirst({ where: { api_key: apiKey, lang }, select: { id: true } });
    if (existing) return { ok: false, error: 'Language already in the list' };
    let order = sortOrder;
    if (order === undefined || order === null) {
      const max = await db.stt_source_languages.aggregate({ where: { api_key: apiKey }, _max: { sort_order: true } });
      order = (max._max.sort_order ?? -1) + 1;
    }
    const row = await db.stt_source_languages.create({
      data: { api_key: apiKey, lang, label: label ?? null, sort_order: order, updated_at: nowSeconds() },
    });
    return { ok: true, language: languageRow(row) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, language: object }|{ ok: false, error: string, status?: number }>}
 */
export async function updateSttSourceLanguage(db, apiKey, id, { label, sortOrder } = {}) {
  const existing = await db.stt_source_languages.findFirst({ where: { api_key: apiKey, id } });
  if (!existing) return { ok: false, error: 'Language not found', status: 404 };
  try {
    const row = await db.stt_source_languages.update({
      where: { id },
      data: {
        label: label !== undefined ? label : existing.label,
        sort_order: sortOrder ?? existing.sort_order,
        updated_at: nowSeconds(),
      },
    });
    return { ok: true, language: languageRow(row) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** @param {import('./connection.js').Db} db @returns {Promise<boolean>} true if a row was deleted */
export async function deleteSttSourceLanguage(db, apiKey, id) {
  const { count } = await db.stt_source_languages.deleteMany({ where: { api_key: apiKey, id } });
  return count > 0;
}
