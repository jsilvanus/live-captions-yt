import logger from 'lcyt/logger';

// kind → conflict action. counter is additive, gauge takes the latest value,
// max keeps the largest value seen in the period.
const UPSERT_BY_KIND = {
  counter: 'value = value + excluded.value',
  gauge: 'value = excluded.value',
  max: 'value = MAX(value, excluded.value)',
};

export function normalizePeriodStart(grain, periodStart = null) {
  if (periodStart) return periodStart;
  const now = new Date();
  const day = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  if (grain === 'day') return day;
  return `${day}T${String(now.getUTCHours()).padStart(2, '0')}:00:00Z`;
}

export function normalizeDateFilter(value, { dateOnly = false } = {}) {
  if (!value || !dateOnly) return value;
  if (value.includes('T')) return value;
  return `${value}T23:59:59.999Z`;
}

export function writeUsageRollup(db, { apiKey = '', metric, value = 1, kind = 'counter', grain = 'hour', periodStart = null } = {}) {
  const action = UPSERT_BY_KIND[kind] || UPSERT_BY_KIND.counter;
  try {
    db.prepare(`
      INSERT INTO usage_rollups (api_key, period_start, grain, metric, value)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(api_key, metric, grain, period_start)
      DO UPDATE SET ${action}
    `).run(apiKey, normalizePeriodStart(grain, periodStart), grain, metric, Number(value || 0));
  } catch (err) {
    // Rollups are best-effort and should never break the request path.
    logger.warn('[metrics] rollup write failed', err);
  }
}

/**
 * Compact hourly rollup rows older than `olderThanDays` into daily rows
 * (counter → SUM, max → MAX, gauge → last hourly value), then delete the
 * hourly rows. Day rows are kept indefinitely.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ olderThanDays?: number, kindForMetric?: (metric: string) => string }} opts
 * @returns {number} number of hourly rows compacted
 */
export function compactHourlyRollups(db, { olderThanDays = 90, kindForMetric = () => 'counter' } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const cutoffIso = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}T00:00:00Z`;

  const rows = db.prepare(`
    SELECT api_key, metric, period_start, value FROM usage_rollups
    WHERE grain = 'hour' AND period_start < ?
    ORDER BY period_start ASC
  `).all(cutoffIso);
  if (rows.length === 0) return 0;

  db.transaction(() => {
    for (const row of rows) {
      writeUsageRollup(db, {
        apiKey: row.api_key,
        metric: row.metric,
        value: row.value,
        kind: kindForMetric(row.metric),
        grain: 'day',
        periodStart: row.period_start.slice(0, 10),
      });
    }
    db.prepare("DELETE FROM usage_rollups WHERE grain = 'hour' AND period_start < ?").run(cutoffIso);
  })();
  return rows.length;
}

export function queryUsageRollups(db, { metric = '', apiKey = null, grain = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (metric) {
    conditions.push('metric = ?');
    params.push(metric);
  }
  if (apiKey != null && apiKey !== '') {
    conditions.push('api_key = ?');
    params.push(apiKey);
  }
  if (grain) {
    conditions.push('grain = ?');
    params.push(grain);
  }
  if (from) {
    conditions.push('period_start >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('period_start <= ?');
    params.push(normalizeDateFilter(to, { dateOnly: true }));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT api_key, period_start, grain, metric, value
    FROM usage_rollups ${where}
    ORDER BY period_start DESC, metric ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM usage_rollups ${where}`).get(...params);

  return { rows, total: count };
}

/**
 * Time-series query for the rollup REST layer.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ from?: string, to?: string, grain?: string, metrics?: string[], apiKeys?: string[], orgId?: number|null, groupBy?: 'metric'|'project'|'org' }} opts
 * @returns {Array<{ key: string, metric: string, points: Array<[string, number]> }>}
 */
export function queryRollupSeries(db, { from = '', to = '', grain = 'hour', metrics = [], apiKeys = [], orgId = null, groupBy = 'metric' } = {}) {
  const conditions = ['u.grain = ?'];
  const params = [grain];

  if (from) {
    conditions.push('u.period_start >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('u.period_start <= ?');
    params.push(normalizeDateFilter(to, { dateOnly: true }));
  }
  if (metrics.length > 0) {
    conditions.push(`u.metric IN (${metrics.map(() => '?').join(',')})`);
    params.push(...metrics);
  }
  if (apiKeys.length > 0) {
    conditions.push(`u.api_key IN (${apiKeys.map(() => '?').join(',')})`);
    params.push(...apiKeys);
  }

  const needsOrgJoin = groupBy === 'org' || orgId != null;
  const join = needsOrgJoin ? 'LEFT JOIN api_keys k ON k.key = u.api_key' : '';
  if (orgId != null) {
    conditions.push('k.org_id = ?');
    params.push(orgId);
  }
  const keyExpr = groupBy === 'project' ? 'u.api_key'
    : groupBy === 'org' ? "COALESCE(k.org_id, '')"
    : "''";

  const rows = db.prepare(`
    SELECT ${keyExpr} AS grp, u.metric AS metric, u.period_start AS period_start, SUM(u.value) AS value
    FROM usage_rollups u ${join}
    WHERE ${conditions.join(' AND ')}
    GROUP BY grp, u.metric, u.period_start
    ORDER BY u.period_start ASC
  `).all(...params);

  const series = new Map();
  for (const row of rows) {
    const seriesKey = `${row.grp}\x00${row.metric}`;
    let entry = series.get(seriesKey);
    if (!entry) {
      entry = { key: String(row.grp ?? ''), metric: row.metric, points: [] };
      series.set(seriesKey, entry);
    }
    entry.points.push([row.period_start, row.value]);
  }
  return Array.from(series.values());
}
