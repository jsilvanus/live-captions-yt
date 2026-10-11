const toSession = (r) => ({
  sessionId: r.session_id,
  apiKey: r.api_key,
  streamKey: r.stream_key,
  domain: r.domain,
  sequence: r.sequence,
  startedAt: r.started_at,
  lastActivity: r.last_activity,
  syncOffset: r.sync_offset,
  micHolder: r.mic_holder,
  data: r.data ? JSON.parse(r.data) : null,
});

/**
 * Save or update a session row.
 * @param {D} db
 * @param {{ sessionId: string, apiKey?: string, streamKey?: string, domain?: string, sequence?: number, startedAt?: string, lastActivity?: string, syncOffset?: number, micHolder?: string, data?: object }} s
 * @returns {Promise<void>}
 */
export async function saveSession(db, s) {
  const fields = {
    api_key: s.apiKey ?? null,
    stream_key: s.streamKey ?? null,
    domain: s.domain ?? null,
    sequence: s.sequence ?? 0,
    started_at: s.startedAt ?? null,
    last_activity: s.lastActivity ?? null,
    sync_offset: s.syncOffset ?? null,
    mic_holder: s.micHolder ?? null,
    data: s.data ? JSON.stringify(s.data) : null,
  };
  await db.sessions.upsert({
    where: { session_id: s.sessionId },
    create: { session_id: s.sessionId, ...fields },
    update: fields,
  });
}

/**
 * Load a session row by ID.
 * @param {import('./connection.js').Db} db
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function loadSession(db, sessionId) {
  const row = await db.sessions.findUnique({ where: { session_id: sessionId } });
  return row ? toSession(row) : null;
}

/**
 * Delete a persisted session.
 * @param {import('./connection.js').Db} db
 * @param {string} sessionId
 * @returns {Promise<{ changes: number }>} number of deleted rows (same field as the old better-sqlite3 result)
 */
export async function deleteSession(db, sessionId) {
  const r = await db.sessions.deleteMany({ where: { session_id: sessionId } });
  return { changes: r.count };
}

/**
 * List all persisted sessions.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object[]>}
 */
export async function listSessions(db) {
  return (await db.sessions.findMany()).map(toSession);
}

/**
 * Atomically increment and return the next sequence number for a session.
 * @param {import('./connection.js').Db} db
 * @param {string} sessionId
 * @returns {Promise<number|null>} new sequence
 */
export async function incSessionSequence(db, sessionId) {
  const run = async (tx) => {
    await tx.sessions.updateMany({ where: { session_id: sessionId }, data: { sequence: { increment: 1 } } });
    const row = await tx.sessions.findUnique({ where: { session_id: sessionId }, select: { sequence: true } });
    return row ? row.sequence : null;
  };
  return typeof db.$transaction === 'function' ? db.$transaction(run) : run(db);
}
