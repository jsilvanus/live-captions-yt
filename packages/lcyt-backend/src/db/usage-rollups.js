import logger from 'lcyt/logger';

export function normalizePeriodStart(grain, periodStart = null) {
  if (periodStart) return periodStart;
  const now = new Date();
  if (grain === 'day') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}:00:00Z`;
}

export function normalizeDateFilter(value, { dateOnly = false } = {}) {
  if (!value) return value;
  if (!dateOnly) return value;
  if (/T\d{2}:\d{2}/.test(value) || /\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  return `${value}T23:59:59.999Z`;
}

export function writeUsageRollup(db, { apiKey = '', metric, value = 1, kind = 'counter', grain = 'hour', periodStart = null } = {}) {
  const resolvedPeriodStart = normalizePeriodStart(grain, periodStart);

  try {
    const existing = db.prepare(`
      SELECT value FROM usage_rollups
      WHERE api_key = ? AND metric = ? AND grain = ? AND period_start = ?
    `).get(apiKey, metric, grain, resolvedPeriodStart);

    let nextValue = Number(value || 0);
    if (existing) {
      const currentValue = Number(existing.value || 0);
      if (kind === 'gauge') {
        nextValue = Number(value || 0);
      } else if (kind === 'max') {
        nextValue = Math.max(currentValue, Number(value || 0));
      } else {
        nextValue = currentValue + Number(value || 0);
      }
    }

    db.prepare(`
      INSERT INTO usage_rollups (api_key, period_start, grain, metric, value)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(api_key, metric, grain, period_start)
      DO UPDATE SET value = excluded.value
    `).run(apiKey, resolvedPeriodStart, grain, metric, nextValue);
  } catch (err) {
    // Rollups are best-effort and should never break the request path.
    logger.warn('[metrics] rollup write failed', err);
  }
}

export function queryUsageRollups(db, { metric = '', from = '', to = '', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (metric) {
    conditions.push('metric = ?');
    params.push(metric);
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
