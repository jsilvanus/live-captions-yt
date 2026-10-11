import { currentDateHour, num } from './helpers.js';

const idOf = (date, hour, domain) => ({ date_hour_domain: { date, hour, domain } });

/**
 * Increment session-started counter for a domain and update peak concurrent sessions.
 * @param {import('./connection.js').Db} db
 * @param {string} domain
 * @param {number} currentSessionCount - Total active sessions after this one was created
 * @returns {Promise<void>}
 */
export async function incrementDomainHourlySessionStart(db, domain, currentSessionCount) {
  if (!domain) return;
  const { date, hour } = currentDateHour();
  await db.domain_hourly_stats.upsert({
    where: idOf(date, hour, domain),
    create: { date, hour, domain, sessions_started: 1, peak_sessions: currentSessionCount },
    update: { sessions_started: { increment: 1 } },
  });
  // peak_sessions = MAX(peak_sessions, n) without a dialect-specific MAX/GREATEST
  await db.domain_hourly_stats.updateMany({
    where: { date, hour, domain, peak_sessions: { lt: currentSessionCount } },
    data: { peak_sessions: currentSessionCount },
  });
}

/**
 * Increment session-ended counter and accumulate duration for a domain.
 * @param {import('./connection.js').Db} db
 * @param {string} domain
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
export async function incrementDomainHourlySessionEnd(db, domain, durationMs) {
  if (!domain) return;
  const { date, hour } = currentDateHour();
  await db.domain_hourly_stats.upsert({
    where: idOf(date, hour, domain),
    create: { date, hour, domain, sessions_ended: 1, total_duration_ms: BigInt(Math.round(durationMs)) },
    update: { sessions_ended: { increment: 1 }, total_duration_ms: { increment: BigInt(Math.round(durationMs)) } },
  });
}

/**
 * Increment caption send counters for a domain.
 * @param {import('./connection.js').Db} db
 * @param {string} domain
 * @param {{ sent?: number, failed?: number, batches?: number }} counts
 * @returns {Promise<void>}
 */
export async function incrementDomainHourlyCaptions(db, domain, { sent = 0, failed = 0, batches = 0 } = {}) {
  if (!domain) return;
  const { date, hour } = currentDateHour();
  await db.domain_hourly_stats.upsert({
    where: idOf(date, hour, domain),
    create: { date, hour, domain, captions_sent: sent, captions_failed: failed, batches_sent: batches },
    update: {
      captions_sent: { increment: sent },
      captions_failed: { increment: failed },
      batches_sent: { increment: batches },
    },
  });
}

/**
 * Query domain usage stats over a date range, grouped by domain and day or hour.
 * @param {import('./connection.js').Db} db
 * @param {{ from: string, to: string, granularity?: 'day'|'hour', domain?: string }} options
 * @returns {Promise<object[]>}
 */
export async function getDomainUsageStats(db, { from, to, granularity = 'day', domain } = {}) {
  if (granularity === 'hour') {
    const rows = await db.domain_hourly_stats.findMany({
      where: { date: { gte: from, lte: to }, ...(domain ? { domain } : {}) },
      orderBy: [{ date: 'asc' }, { hour: 'asc' }, { domain: 'asc' }],
    });
    return rows.map(r => ({ ...r, total_duration_ms: num(r.total_duration_ms) }));
  }

  // CAST: PostgreSQL SUM(bigint) is numeric, which Prisma would return as Decimal.
  const rows = domain
    ? await db.$queryRaw`
        SELECT date, domain,
          CAST(SUM(sessions_started) AS BIGINT)  AS sessions_started,
          CAST(SUM(sessions_ended) AS BIGINT)    AS sessions_ended,
          CAST(SUM(captions_sent) AS BIGINT)     AS captions_sent,
          CAST(SUM(captions_failed) AS BIGINT)   AS captions_failed,
          CAST(SUM(batches_sent) AS BIGINT)      AS batches_sent,
          CAST(SUM(total_duration_ms) AS BIGINT) AS total_duration_ms,
          MAX(peak_sessions)     AS peak_sessions
        FROM domain_hourly_stats
        WHERE date >= ${from} AND date <= ${to} AND domain = ${domain}
        GROUP BY date, domain
        ORDER BY date, domain`
    : await db.$queryRaw`
        SELECT date, domain,
          CAST(SUM(sessions_started) AS BIGINT)  AS sessions_started,
          CAST(SUM(sessions_ended) AS BIGINT)    AS sessions_ended,
          CAST(SUM(captions_sent) AS BIGINT)     AS captions_sent,
          CAST(SUM(captions_failed) AS BIGINT)   AS captions_failed,
          CAST(SUM(batches_sent) AS BIGINT)      AS batches_sent,
          CAST(SUM(total_duration_ms) AS BIGINT) AS total_duration_ms,
          MAX(peak_sessions)     AS peak_sessions
        FROM domain_hourly_stats
        WHERE date >= ${from} AND date <= ${to}
        GROUP BY date, domain
        ORDER BY date, domain`;
  return rows.map(r => ({
    ...r,
    sessions_started: num(r.sessions_started),
    sessions_ended: num(r.sessions_ended),
    captions_sent: num(r.captions_sent),
    captions_failed: num(r.captions_failed),
    batches_sent: num(r.batches_sent),
    total_duration_ms: num(r.total_duration_ms),
    peak_sessions: num(r.peak_sessions),
  }));
}
