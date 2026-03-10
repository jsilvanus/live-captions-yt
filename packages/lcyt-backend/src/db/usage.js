import { currentDateHour } from './helpers.js';

/**
 * Increment session-started counter for a domain and update peak concurrent sessions.
 * @param {import('better-sqlite3').Database} db
 * @param {string} domain
 * @param {number} currentSessionCount - Total active sessions after this one was created
 */
export function incrementDomainHourlySessionStart(db, domain, currentSessionCount) {
  if (!domain) return;
  const { date, hour } = currentDateHour();
  db.prepare(`
    INSERT INTO domain_hourly_stats (date, hour, domain, sessions_started, peak_sessions)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (date, hour, domain) DO UPDATE SET
      sessions_started = sessions_started + 1,
      peak_sessions = MAX(peak_sessions, excluded.peak_sessions)
  `).run(date, hour, domain, currentSessionCount);
}

/**
 * Increment session-ended counter and accumulate duration for a domain.
 * @param {import('better-sqlite3').Database} db
 * @param {string} domain
 * @param {number} durationMs
 */
export function incrementDomainHourlySessionEnd(db, domain, durationMs) {
  if (!domain) return;
  const { date, hour } = currentDateHour();
  db.prepare(`
    INSERT INTO domain_hourly_stats (date, hour, domain, sessions_ended, total_duration_ms)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (date, hour, domain) DO UPDATE SET
      sessions_ended = sessions_ended + 1,
      total_duration_ms = total_duration_ms + excluded.total_duration_ms
  `).run(date, hour, domain, durationMs);
}

/**
 * Increment caption send counters for a domain.
 * @param {import('better-sqlite3').Database} db
 * @param {string} domain
 * @param {{ sent?: number, failed?: number, batches?: number }} counts
 */
export function incrementDomainHourlyCaptions(db, domain, { sent = 0, failed = 0, batches = 0 } = {}) {
  if (!domain) return;
  const { date, hour } = currentDateHour();
  db.prepare(`
    INSERT INTO domain_hourly_stats (date, hour, domain, captions_sent, captions_failed, batches_sent)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (date, hour, domain) DO UPDATE SET
      captions_sent    = captions_sent    + excluded.captions_sent,
      captions_failed  = captions_failed  + excluded.captions_failed,
      batches_sent     = batches_sent     + excluded.batches_sent
  `).run(date, hour, domain, sent, failed, batches);
}

/**
 * Query domain usage stats over a date range, grouped by domain and day or hour.
 * @param {import('better-sqlite3').Database} db
 * @param {{ from: string, to: string, granularity?: 'day'|'hour', domain?: string }} options
 * @returns {object[]}
 */
export function getDomainUsageStats(db, { from, to, granularity = 'day', domain } = {}) {
  const domainFilter = domain ? 'AND domain = ?' : '';
  const params = domain ? [from, to, domain] : [from, to];

  if (granularity === 'hour') {
    return db.prepare(`
      SELECT date, hour, domain,
        sessions_started, sessions_ended,
        captions_sent, captions_failed, batches_sent,
        total_duration_ms, peak_sessions
      FROM domain_hourly_stats
      WHERE date >= ? AND date <= ? ${domainFilter}
      ORDER BY date, hour, domain
    `).all(...params);
  }

  return db.prepare(`
    SELECT date, domain,
      SUM(sessions_started)  AS sessions_started,
      SUM(sessions_ended)    AS sessions_ended,
      SUM(captions_sent)     AS captions_sent,
      SUM(captions_failed)   AS captions_failed,
      SUM(batches_sent)      AS batches_sent,
      SUM(total_duration_ms) AS total_duration_ms,
      MAX(peak_sessions)     AS peak_sessions
    FROM domain_hourly_stats
    WHERE date >= ? AND date <= ? ${domainFilter}
    GROUP BY date, domain
    ORDER BY date, domain
  `).all(...params);
}
