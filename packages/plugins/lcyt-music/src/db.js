/**
 * Music detection plugin — DB helpers (async, Prisma client).
 *
 * Tables music_events (label/BPM event log written by SoundCaptionProcessor) and
 * music_config (per-API-key server-side detector settings) come from the backend's
 * Prisma schema / PostgreSQL migrations.
 */

const DEFAULT_MUSIC_CONFIG = {
  enabled: false,
  silenceThreshold: 0.01,
  flatnessThreshold: 0.4,
  zcrThreshold: 0.15,
  confirmSegments: 2,
  bpmEnabled: true,
  bpmMin: 40,
  bpmMax: 200,
  autoStart: false,
  autoCalibrate: false,
};

/**
 * Get the server-side detector config for an API key, falling back to defaults
 * when no row exists yet.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<typeof DEFAULT_MUSIC_CONFIG>}
 */
export async function getMusicConfig(db, apiKey) {
  const row = await db.music_config.findUnique({ where: { api_key: apiKey } });
  if (!row) return { ...DEFAULT_MUSIC_CONFIG };
  return {
    enabled: !!row.enabled,
    silenceThreshold: row.silence_threshold,
    flatnessThreshold: row.flatness_threshold,
    zcrThreshold: row.zcr_threshold,
    confirmSegments: row.confirm_segments,
    bpmEnabled: !!row.bpm_enabled,
    bpmMin: row.bpm_min,
    bpmMax: row.bpm_max,
    autoStart: !!row.auto_start,
    autoCalibrate: !!row.auto_calibrate,
  };
}

/**
 * Upsert the server-side detector config for an API key. Only the provided
 * fields are changed; omitted fields keep their existing (or default) value.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {Partial<typeof DEFAULT_MUSIC_CONFIG>} patch
 * @returns {Promise<typeof DEFAULT_MUSIC_CONFIG>}
 */
export async function setMusicConfig(db, apiKey, patch = {}) {
  const current = await getMusicConfig(db, apiKey);
  const merged = { ...current, ...patch };
  const values = {
    enabled: merged.enabled ? 1 : 0,
    silence_threshold: merged.silenceThreshold,
    flatness_threshold: merged.flatnessThreshold,
    zcr_threshold: merged.zcrThreshold,
    confirm_segments: merged.confirmSegments,
    bpm_enabled: merged.bpmEnabled ? 1 : 0,
    bpm_min: merged.bpmMin,
    bpm_max: merged.bpmMax,
    auto_start: merged.autoStart ? 1 : 0,
    auto_calibrate: merged.autoCalibrate ? 1 : 0,
    updated_at: Math.floor(Date.now() / 1000),
  };
  await db.music_config.upsert({
    where: { api_key: apiKey },
    create: { api_key: apiKey, ...values },
    update: values,
  });
  return merged;
}

/**
 * Insert a music event (label_change or bpm_update).
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {{ event_type: string, label?: string|null, bpm?: number|null, confidence?: number|null }} event
 * @returns {Promise<void>}
 */
export async function insertMusicEvent(db, apiKey, event) {
  await db.music_events.create({
    data: {
      api_key: apiKey,
      event_type: event.event_type,
      label: event.label ?? null,
      bpm: event.bpm ?? null,
      confidence: event.confidence ?? null,
    },
  });
}

const EVENT_SELECT = { id: true, event_type: true, label: true, bpm: true, confidence: true, ts: true };

/**
 * Retrieve the most recent music events for an API key.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {number} [limit=20]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentMusicEvents(db, apiKey, limit = 20) {
  return db.music_events.findMany({
    where: { api_key: apiKey },
    select: EVENT_SELECT,
    orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

/**
 * Retrieve a paginated page of music events for an API key, newest first.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {'label_change'|'bpm_update'|null} [opts.eventType]
 * @returns {Promise<{ events: Array<object>, total: number }>}
 */
export async function getMusicEventsPage(db, apiKey, { limit = 50, offset = 0, eventType = null } = {}) {
  const where = eventType ? { api_key: apiKey, event_type: eventType } : { api_key: apiKey };
  const total = await db.music_events.count({ where });
  const events = await db.music_events.findMany({
    where,
    select: EVENT_SELECT,
    orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    take: limit,
    skip: offset,
  });
  return { events, total };
}
