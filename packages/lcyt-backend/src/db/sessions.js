/**
 * Save or update a session row.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, apiKey?: string, streamKey?: string, domain?: string, sequence?: number, startedAt?: string, lastActivity?: string, syncOffset?: number, micHolder?: string, data?: object }} s
 */
export function saveSession(db, s) {
  db.prepare(
    `INSERT INTO sessions (session_id, api_key, stream_key, domain, sequence, started_at, last_activity, sync_offset, mic_holder, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       api_key = excluded.api_key,
       stream_key = excluded.stream_key,
       domain = excluded.domain,
       sequence = excluded.sequence,
       started_at = excluded.started_at,
       last_activity = excluded.last_activity,
       sync_offset = excluded.sync_offset,
       mic_holder = excluded.mic_holder,
       data = excluded.data
    `
  ).run(
    s.sessionId,
    s.apiKey ?? null,
    s.streamKey ?? null,
    s.domain ?? null,
    s.sequence ?? 0,
    s.startedAt ?? null,
    s.lastActivity ?? null,
    s.syncOffset ?? null,
    s.micHolder ?? null,
    s.data ? JSON.stringify(s.data) : null
  );
}

/**
 * Load a session row by ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
export function loadSession(db, sessionId) {
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  if (!row) return null;
  return {
    sessionId: row.session_id,
    apiKey: row.api_key,
    streamKey: row.stream_key,
    domain: row.domain,
    sequence: row.sequence,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    syncOffset: row.sync_offset,
    micHolder: row.mic_holder,
    data: row.data ? JSON.parse(row.data) : null,
  };
}

/**
 * Delete a persisted session.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
export function deleteSession(db, sessionId) {
  return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

/**
 * List all persisted sessions.
 * @param {import('better-sqlite3').Database} db
 */
export function listSessions(db) {
  return db.prepare('SELECT * FROM sessions').all().map(r => ({
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
  }));
}

/**
 * Atomically increment and return the next sequence number for a session.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 * @returns {number} new sequence
 */
export function incSessionSequence(db, sessionId) {
  const tx = db.transaction((sid) => {
    db.prepare('UPDATE sessions SET sequence = sequence + 1 WHERE session_id = ?').run(sid);
    const row = db.prepare('SELECT sequence FROM sessions WHERE session_id = ?').get(sid);
    return row ? row.sequence : null;
  });
  return tx(sessionId);
}
