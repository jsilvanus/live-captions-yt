import logger from 'lcyt/logger';

import { getDialect } from './connection.js';
import { num } from './helpers.js';

/** Positional placeholder for the current dialect ($n on PostgreSQL, ? on SQLite). */
const ph = (i) => (getDialect() === 'postgres' ? `$${i}` : '?');

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

/**
 * Upsert one rollup value. counter is additive, gauge takes the latest value,
 * max keeps the largest value seen in the period. Throws on error.
 */
async function upsertRollup(db, { apiKey = '', metric, value = 1, kind = 'counter', grain = 'hour', periodStart = null } = {}) {
  const ps = normalizePeriodStart(grain, periodStart);
  const v = Number(value || 0);
  const key = apiKey ?? '';
  if (kind === 'gauge') {
    await db.$executeRaw`
      INSERT INTO usage_rollups (api_key, period_start, grain, metric, value)
      VALUES (${key}, ${ps}, ${grain}, ${metric}, ${v})
      ON CONFLICT(api_key, metric, grain, period_start)
      DO UPDATE SET value = excluded.value`;
  } else if (kind === 'max') {
    await db.$executeRaw`
      INSERT INTO usage_rollups (api_key, period_start, grain, metric, value)
      VALUES (${key}, ${ps}, ${grain}, ${metric}, ${v})
      ON CONFLICT(api_key, metric, grain, period_start)
      DO UPDATE SET value = CASE WHEN excluded.value > usage_rollups.value THEN excluded.value ELSE usage_rollups.value END`;
  } else {
    await db.$executeRaw`
      INSERT INTO usage_rollups (api_key, period_start, grain, metric, value)
      VALUES (${key}, ${ps}, ${grain}, ${metric}, ${v})
      ON CONFLICT(api_key, metric, grain, period_start)
      DO UPDATE SET value = usage_rollups.value + excluded.value`;
  }
}

/**
 * Best-effort rollup write (never throws).
 * @param {import('./connection.js').Db} db
 * @param {{ apiKey?: string, metric: string, value?: number, kind?: 'counter'|'gauge'|'max', grain?: string, periodStart?: string|null }} opts
 * @returns {Promise<void>}
 */
export async function writeUsageRollup(db, opts = {}) {
  try {
    await upsertRollup(db, opts);
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
 * @param {import('./connection.js').Db} db
 * @param {{ olderThanDays?: number, kindForMetric?: (metric: string) => string }} opts
 * @returns {Promise<number>} number of hourly rows compacted
 */
export async function compactHourlyRollups(db, { olderThanDays = 90, kindForMetric = () => 'counter' } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const cutoffIso = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}T00:00:00Z`;

  const rows = await db.usage_rollups.findMany({
    where: { grain: 'hour', period_start: { lt: cutoffIso } },
    orderBy: { period_start: 'asc' },
  });
  if (rows.length === 0) return 0;

  await db.$transaction(async (tx) => {
    for (const row of rows) {
      await upsertRollup(tx, {
        apiKey: row.api_key,
        metric: row.metric,
        value: row.value,
        kind: kindForMetric(row.metric),
        grain: 'day',
        periodStart: row.period_start.slice(0, 10),
      });
    }
    await tx.usage_rollups.deleteMany({ where: { grain: 'hour', period_start: { lt: cutoffIso } } });
  });
  return rows.length;
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ rows: Array<{ api_key: string, period_start: string, grain: string, metric: string, value: number }>, total: number }>}
 */
export async function queryUsageRollups(db, { metric = '', apiKey = null, grain = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (metric) {
    conditions.push(`metric = ${ph(params.length + 1)}`);
    params.push(metric);
  }
  if (apiKey != null && apiKey !== '') {
    conditions.push(`api_key = ${ph(params.length + 1)}`);
    params.push(apiKey);
  }
  if (grain) {
    conditions.push(`grain = ${ph(params.length + 1)}`);
    params.push(grain);
  }
  if (from) {
    conditions.push(`period_start >= ${ph(params.length + 1)}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`period_start <= ${ph(params.length + 1)}`);
    params.push(normalizeDateFilter(to, { dateOnly: true }));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const n = params.length;
  const rows = await db.$queryRawUnsafe(`
    SELECT api_key, period_start, grain, metric, value
    FROM usage_rollups ${where}
    ORDER BY period_start DESC, metric ASC
    LIMIT ${ph(n + 1)} OFFSET ${ph(n + 2)}
  `, ...params, Number(limit), Number(offset));
  const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM usage_rollups ${where}`, ...params);

  return { rows: rows.map((r) => ({ ...r, value: num(r.value) })), total: num(count) };
}

/**
 * Time-series query for the rollup REST layer.
 *
 * @param {import('./connection.js').Db} db
 * @param {{ from?: string, to?: string, grain?: string, metrics?: string[], apiKeys?: string[], orgId?: number|null, groupBy?: 'metric'|'project'|'org' }} opts
 * @returns {Promise<Array<{ key: string, metric: string, points: Array<[string, number]> }>>}
 */
export async function queryRollupSeries(db, { from = '', to = '', grain = 'hour', metrics = [], apiKeys = [], orgId = null, groupBy = 'metric' } = {}) {
  const conditions = [`u.grain = ${ph(1)}`];
  const params = [grain];

  if (from) {
    conditions.push(`u.period_start >= ${ph(params.length + 1)}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`u.period_start <= ${ph(params.length + 1)}`);
    params.push(normalizeDateFilter(to, { dateOnly: true }));
  }
  if (metrics.length > 0) {
    conditions.push(`u.metric IN (${metrics.map((_, i) => ph(params.length + 1 + i)).join(',')})`);
    params.push(...metrics);
  }
  if (apiKeys.length > 0) {
    conditions.push(`u.api_key IN (${apiKeys.map((_, i) => ph(params.length + 1 + i)).join(',')})`);
    params.push(...apiKeys);
  }

  const needsOrgJoin = groupBy === 'org' || orgId != null;
  const join = needsOrgJoin ? 'LEFT JOIN api_keys k ON k.key = u.api_key' : '';
  if (orgId != null) {
    conditions.push(`k.org_id = ${ph(params.length + 1)}`);
    params.push(Number(orgId));
  }
  const keyExpr = groupBy === 'project' ? 'u.api_key'
    : groupBy === 'org' ? "COALESCE(CAST(k.org_id AS TEXT), '')"
    : "''";

  const rows = await db.$queryRawUnsafe(`
    SELECT ${keyExpr} AS grp, u.metric AS metric, u.period_start AS period_start, SUM(u.value) AS value
    FROM usage_rollups u ${join}
    WHERE ${conditions.join(' AND ')}
    GROUP BY grp, u.metric, u.period_start
    ORDER BY u.period_start ASC
  `, ...params);

  const series = new Map();
  for (const row of rows) {
    const seriesKey = `${row.grp}\x00${row.metric}`;
    let entry = series.get(seriesKey);
    if (!entry) {
      entry = { key: String(row.grp ?? ''), metric: row.metric, points: [] };
      series.set(seriesKey, entry);
    }
    entry.points.push([row.period_start, num(row.value)]);
  }
  return Array.from(series.values());
}
