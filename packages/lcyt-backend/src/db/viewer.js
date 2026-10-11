// ─── Viewer usage stats ────────────────────────────────────────────────────────

/**
 * Increment the per-API-key viewer view count for today.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} viewerKey
 * @returns {Promise<void>}
 */
export async function incrementViewerKeyStat(db, apiKey, viewerKey) {
  const date = new Date().toISOString().slice(0, 10);
  await db.viewer_key_daily_stats.upsert({
    where: { date_api_key_viewer_key: { date, api_key: apiKey, viewer_key: viewerKey } },
    create: { date, api_key: apiKey, viewer_key: viewerKey, views: 1 },
    update: { views: { increment: 1 } },
  });
}

/**
 * Increment the anonymous global viewer view count for today.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<void>}
 */
export async function incrementViewerAnonStat(db) {
  const date = new Date().toISOString().slice(0, 10);
  await db.viewer_anon_daily_stats.upsert({
    where: { date },
    create: { date, views: 1 },
    update: { views: { increment: 1 } },
  });
}

/**
 * Get per-key viewer stats for an API key, newest first.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ from?: string, to?: string }} opts
 * @returns {Promise<Array<{ date: string, viewer_key: string, views: number }>>}
 */
export async function getViewerKeyStats(db, apiKey, { from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return db.viewer_key_daily_stats.findMany({
    where: { api_key: apiKey, date: { gte: from || '2000-01-01', lte: to || today } },
    select: { date: true, viewer_key: true, views: true },
    orderBy: [{ date: 'desc' }, { viewer_key: 'asc' }],
  });
}

/**
 * Get anonymous global viewer stats.
 * @param {import('./connection.js').Db} db
 * @param {{ from?: string, to?: string }} opts
 * @returns {Promise<Array<{ date: string, views: number }>>}
 */
export async function getViewerAnonStats(db, { from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return db.viewer_anon_daily_stats.findMany({
    where: { date: { gte: from || '2000-01-01', lte: to || today } },
    select: { date: true, views: true },
    orderBy: { date: 'desc' },
  });
}
