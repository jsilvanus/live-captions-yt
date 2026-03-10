/**
 * Write a completed session summary to session_stats.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, apiKey: string, domain: string, startedAt: string, endedAt: string, durationMs: number, captionsSent: number, captionsFailed: number, finalSequence: number, endedBy: string }} data
 */
export function writeSessionStat(db, { sessionId, apiKey, domain, startedAt, endedAt, durationMs, captionsSent, captionsFailed, finalSequence, endedBy }) {
  db.prepare(
    'INSERT INTO session_stats (session_id, api_key, domain, started_at, ended_at, duration_ms, captions_sent, captions_failed, final_sequence, ended_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(sessionId, apiKey, domain ?? null, startedAt, endedAt, durationMs, captionsSent ?? 0, captionsFailed ?? 0, finalSequence ?? 0, endedBy ?? 'client');
}

/**
 * Write a caption delivery error to caption_errors.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, sessionId: string, errorCode: number|null, errorMsg: string, batchSize: number }} data
 */
export function writeCaptionError(db, { apiKey, sessionId, errorCode, errorMsg, batchSize }) {
  db.prepare(
    'INSERT INTO caption_errors (api_key, session_id, timestamp, error_code, error_msg, batch_size) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKey, sessionId, new Date().toISOString(), errorCode ?? null, errorMsg ?? null, batchSize ?? 1);
}

/**
 * Write an auth or usage-limit rejection to auth_events.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey?: string, eventType: string, domain?: string }} data
 */
export function writeAuthEvent(db, { apiKey, eventType, domain }) {
  db.prepare(
    'INSERT INTO auth_events (api_key, event_type, timestamp, domain) VALUES (?, ?, ?, ?)'
  ).run(apiKey ?? null, eventType, new Date().toISOString(), domain ?? null);
}

/**
 * Get per-key stats from session_stats, caption_errors, and auth_events.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ sessions: object[], captionErrors: object[], authEvents: object[] }}
 */
export function getKeyStats(db, apiKey) {
  const sessions = db.prepare(
    'SELECT session_id AS sessionId, domain, started_at AS startedAt, ended_at AS endedAt, duration_ms AS durationMs, captions_sent AS captionsSent, captions_failed AS captionsFailed, final_sequence AS finalSequence, ended_by AS endedBy FROM session_stats WHERE api_key = ? ORDER BY id DESC LIMIT 100'
  ).all(apiKey);

  const captionErrors = db.prepare(
    'SELECT timestamp, error_code AS errorCode, error_msg AS errorMsg, batch_size AS batchSize FROM caption_errors WHERE api_key = ? ORDER BY id DESC LIMIT 100'
  ).all(apiKey);

  const authEvents = db.prepare(
    'SELECT event_type AS eventType, timestamp, domain FROM auth_events WHERE api_key = ? ORDER BY id DESC LIMIT 100'
  ).all(apiKey);

  return { sessions, captionErrors, authEvents };
}
