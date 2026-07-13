/**
 * bus_events audit log — insert-only history of notable EventBus topics.
 *
 * This is a queryable human/debug audit trail, NOT a replay buffer for
 * reconnecting SSE subscribers (live delivery is best-effort broadcast, per
 * plan_pubsub_event_bus.md) and is kept separate from AgentEngine's
 * agent_context (which is prompt-shaping, curated for the model).
 *
 * Only a curated allowlist of topics is persisted. better-sqlite3 is
 * synchronous/single-writer, so logging high-frequency topics (caption.sent,
 * session.mic_state, stt.transcript, dsk.text, variable.updated) would put a DB
 * write on the hot path for no real benefit given the accepted gap tolerance.
 * We log only topics with real audit/debug value.
 */

/**
 * Topics persisted to bus_events. `assistant.action`/`assistant.suggestion` are
 * governance-relevant (what the autonomous agent actually did) and worth the
 * record; the rest are low-frequency config/state changes useful for debugging.
 * Values are exact topics or `<domain>.*` prefixes (matched by isAuditableTopic).
 */
export const AUDITED_TOPICS = [
  'role.assistant.assistant_action',
  'role.assistant.assistant_suggestion',
  'cue.fired',
  'dsk.graphics_changed',
  'dsk.templates_changed',
  'bridge.command_result',
  'target.*',
  'translation.*',
  'external.*',
  'mcp.tool_executed',
  'mcp.tool_staged',
  'operator.*',
];

/**
 * Is `topic` on the curated audit allowlist?
 * @param {string} topic
 * @returns {boolean}
 */
export function isAuditableTopic(topic) {
  for (const pattern of AUDITED_TOPICS) {
    if (pattern === topic) return true;
    if (pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Insert one audit row.
 * @param {import('better-sqlite3').Database} db
 * @param {{ projectId: string|null, topic: string, ts: number, payload: any }} entry
 */
export function insertBusEvent(db, { projectId, topic, ts, payload }) {
  db.prepare(
    'INSERT INTO bus_events (project_id, topic, ts, payload_json) VALUES (?, ?, ?, ?)',
  ).run(projectId ?? null, topic, ts, payload === undefined ? null : JSON.stringify(payload));
}

/**
 * Delete audit rows older than `retentionDays`.
 * @param {import('better-sqlite3').Database} db
 * @param {number} retentionDays
 * @returns {{ count: number }}
 */
export function deleteBusEventsOlderThan(db, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const info = db.prepare('DELETE FROM bus_events WHERE ts < ?').run(cutoff);
  return { count: info.changes };
}

/**
 * List recent audit rows (newest first). Not wired to any route yet; provided
 * for tests and a future GET /events/log consumer.
 * @param {import('better-sqlite3').Database} db
 * @param {{ projectId?: string, limit?: number }} [opts]
 */
export function listBusEvents(db, { projectId = null, limit = 100 } = {}) {
  const rows = projectId
    ? db.prepare('SELECT * FROM bus_events WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit)
    : db.prepare('SELECT * FROM bus_events ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map((r) => ({ ...r, payload: r.payload_json ? JSON.parse(r.payload_json) : null }));
}

/**
 * Register a tap on the shared EventBus that persists curated topics to
 * bus_events. Returns an unregister function.
 * @param {import('lcyt/event-bus').EventBus} eventBus
 * @param {import('better-sqlite3').Database} db
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {() => void}
 */
export function attachBusAuditLog(eventBus, db, { log = null } = {}) {
  return eventBus.tap((env) => {
    if (!isAuditableTopic(env.topic)) return;
    try {
      insertBusEvent(db, { projectId: env.projectId, topic: env.topic, ts: env.ts, payload: env.data });
    } catch (err) {
      if (log) log(`[bus-audit] insert failed for ${env.topic}: ${err?.message ?? err}`);
    }
  });
}
