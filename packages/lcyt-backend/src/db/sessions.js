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
 * The session id of the most recently active session of a project, or null.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<string|null>}
 */
export async function findSessionIdByApiKey(db, apiKey) {
  const row = await db.sessions.findFirst({ where: { api_key: apiKey }, orderBy: { last_activity: 'desc' }, select: { session_id: true } });
  return row ? row.session_id : null;
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

/**
 * Record activity on a session without touching any other column, so one instance's stale view
 * of a session never overwrites what another instance wrote (sequence, mic holder, data).
 * @param {import('./connection.js').Db} db
 * @param {string} sessionId
 * @param {string} lastActivityIso
 */
export async function touchSessionRow(db, sessionId, lastActivityIso) {
  await db.sessions.updateMany({ where: { session_id: sessionId }, data: { last_activity: lastActivityIso } });
}

/**
 * Raise a session's sequence to `n` if it is lower. Never lowers it: with several instances
 * sending for one session the stored value only moves forward (use `setSessionSequence` for an
 * explicit reset).
 * @returns {Promise<number>} rows changed (0 or 1)
 */
export async function raiseSessionSequence(db, sessionId, n) {
  const r = await db.sessions.updateMany({ where: { session_id: sessionId, sequence: { lt: n } }, data: { sequence: n } });
  return r.count;
}

/** Set a session's sequence to exactly `n` (explicit client reset). */
export async function setSessionSequence(db, sessionId, n) {
  await db.sessions.updateMany({ where: { session_id: sessionId }, data: { sequence: n } });
}

/** Replace the JSON `data` column of a session row (targets, broadcast, recording). */
export async function setSessionData(db, sessionId, data) {
  await db.sessions.updateMany({ where: { session_id: sessionId }, data: { data: data ? JSON.stringify(data) : null } });
}

/** Persist the soft mic lock holder. */
export async function setSessionMicHolder(db, sessionId, holder) {
  await db.sessions.updateMany({ where: { session_id: sessionId }, data: { mic_holder: holder ?? null } });
}

/** Delete a session row only if nobody has been active since `cutoffIso` (TTL sweep across instances). */
export async function deleteSessionIfIdle(db, sessionId, cutoffIso) {
  const r = await db.sessions.deleteMany({
    where: { session_id: sessionId, OR: [{ last_activity: null }, { last_activity: { lte: cutoffIso } }] },
  });
  return r.count;
}

/** Is any session registered for this domain (browser origin)? */
export async function sessionDomainExists(db, domain) {
  return (await db.sessions.count({ where: { domain } })) > 0;
}
