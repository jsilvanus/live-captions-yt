import { num } from './helpers.js';

/**
 * Write a completed session summary to session_stats.
 * @param {import('./connection.js').Db} db
 * @param {{ sessionId: string, apiKey: string, domain: string, startedAt: string, endedAt: string, durationMs: number, captionsSent: number, captionsFailed: number, finalSequence: number, endedBy: string, broadcastId?: string|null }} data
 * @returns {Promise<void>}
 */
export async function writeSessionStat(db, { sessionId, apiKey, domain, startedAt, endedAt, durationMs, captionsSent, captionsFailed, finalSequence, endedBy, broadcastId }) {
  await db.session_stats.create({
    data: {
      session_id: sessionId,
      api_key: apiKey,
      domain: domain ?? null,
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: BigInt(Math.round(durationMs)),
      captions_sent: captionsSent ?? 0,
      captions_failed: captionsFailed ?? 0,
      final_sequence: finalSequence ?? 0,
      ended_by: endedBy ?? 'client',
      broadcast_id: broadcastId ?? null,
    },
  });
}

/**
 * Write a caption delivery error to caption_errors.
 * @param {import('./connection.js').Db} db
 * @param {{ apiKey: string, sessionId: string, errorCode: number|null, errorMsg: string, batchSize: number }} data
 * @returns {Promise<void>}
 */
export async function writeCaptionError(db, { apiKey, sessionId, errorCode, errorMsg, batchSize }) {
  await db.caption_errors.create({
    data: {
      api_key: apiKey,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      error_code: errorCode ?? null,
      error_msg: errorMsg ?? null,
      batch_size: batchSize ?? 1,
    },
  });
}

/**
 * Write an auth or usage-limit rejection to auth_events.
 * @param {import('./connection.js').Db} db
 * @param {{ apiKey?: string, eventType: string, domain?: string }} data
 * @returns {Promise<void>}
 */
export async function writeAuthEvent(db, { apiKey, eventType, domain }) {
  await db.auth_events.create({
    data: {
      api_key: apiKey ?? null,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      domain: domain ?? null,
    },
  });
}

/**
 * Get per-key stats from session_stats, caption_errors, and auth_events.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<{ sessions: object[], captionErrors: object[], authEvents: object[] }>}
 */
export async function getKeyStats(db, apiKey) {
  const where = { api_key: apiKey };
  const orderBy = { id: 'desc' };

  const sessionRows = await db.session_stats.findMany({ where, orderBy, take: 100 });
  const sessions = sessionRows.map(r => ({
    sessionId: r.session_id,
    domain: r.domain,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: num(r.duration_ms),
    captionsSent: r.captions_sent,
    captionsFailed: r.captions_failed,
    finalSequence: r.final_sequence,
    endedBy: r.ended_by,
    broadcastId: r.broadcast_id,
  }));

  const captionErrors = (await db.caption_errors.findMany({ where, orderBy, take: 100 })).map(r => ({
    timestamp: r.timestamp,
    errorCode: r.error_code,
    errorMsg: r.error_msg,
    batchSize: r.batch_size,
  }));

  const authEvents = (await db.auth_events.findMany({ where, orderBy, take: 100 })).map(r => ({
    eventType: r.event_type,
    timestamp: r.timestamp,
    domain: r.domain,
  }));

  return { sessions, captionErrors, authEvents };
}
