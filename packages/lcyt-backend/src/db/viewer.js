// ─── Viewer usage stats ────────────────────────────────────────────────────────

/**
 * Increment the per-API-key viewer view count for today.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} viewerKey
 */
export function incrementViewerKeyStat(db, apiKey, viewerKey) {
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO viewer_key_daily_stats (date, api_key, viewer_key, views)
    VALUES (?, ?, ?, 1)
    ON CONFLICT (date, api_key, viewer_key) DO UPDATE SET views = views + 1
  `).run(date, apiKey, viewerKey);
}

/**
 * Increment the anonymous global viewer view count for today.
 * @param {import('better-sqlite3').Database} db
 */
export function incrementViewerAnonStat(db) {
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO viewer_anon_daily_stats (date, views)
    VALUES (?, 1)
    ON CONFLICT (date) DO UPDATE SET views = views + 1
  `).run(date);
}

/**
 * Get per-key viewer stats for an API key, newest first.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ from?: string, to?: string }} opts
 * @returns {Array<{ date: string, viewer_key: string, views: number }>}
 */
export function getViewerKeyStats(db, apiKey, { from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const f = from || '2000-01-01';
  const t = to || today;
  return db.prepare(
    'SELECT date, viewer_key, views FROM viewer_key_daily_stats WHERE api_key = ? AND date >= ? AND date <= ? ORDER BY date DESC, viewer_key ASC'
  ).all(apiKey, f, t);
}

/**
 * Get anonymous global viewer stats.
 * @param {import('better-sqlite3').Database} db
 * @param {{ from?: string, to?: string }} opts
 * @returns {Array<{ date: string, views: number }>}
 */
export function getViewerAnonStats(db, { from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const f = from || '2000-01-01';
  const t = to || today;
  return db.prepare(
    'SELECT date, views FROM viewer_anon_daily_stats WHERE date >= ? AND date <= ? ORDER BY date DESC'
  ).all(f, t);
}
