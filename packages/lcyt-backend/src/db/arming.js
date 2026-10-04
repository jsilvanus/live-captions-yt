/**
 * Production arming (plan_backend_actions.md).
 *
 * One switch per project, stored on the broadcast it belongs to: the project's
 * live broadcast, else its active broadcast. Disarmed (the default) means
 * cue-triggered actions skip their device steps; manual runs always work.
 * Going live arms, the session ending disarms, and an operator can override
 * either way. Every change is published on the bus as
 * `production.arming_changed`.
 */

/**
 * The broadcast that carries the arming flag: the newest live one, else the
 * project's active (non-archived) one, else none.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ id: string, armed: number, status: string }|null}
 */
export function getArmingBroadcast(db, apiKey) {
  const live = db.prepare(
    "SELECT id, armed, status FROM broadcasts WHERE api_key = ? AND status = 'live' ORDER BY actual_start DESC, created_at DESC LIMIT 1",
  ).get(apiKey);
  if (live) return live;
  return db.prepare(`
    SELECT b.id, b.armed, b.status FROM broadcasts b
    JOIN api_keys k ON k.active_broadcast_id = b.id
    WHERE k.key = ? AND b.api_key = ? AND b.status != 'archived'
  `).get(apiKey, apiKey) ?? null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ armed: boolean, broadcastId: string|null, status: string|null }}
 */
export function getArming(db, apiKey) {
  const b = getArmingBroadcast(db, apiKey);
  return { armed: Boolean(b?.armed), broadcastId: b?.id ?? null, status: b?.status ?? null };
}

/** @param {import('better-sqlite3').Database} db @param {string} apiKey */
export function isArmed(db, apiKey) {
  return getArming(db, apiKey).armed;
}

/**
 * Operator override. Fails with 409 when the project has no live or active
 * broadcast to hold the flag.
 * @returns {{ ok: true, armed: boolean, broadcastId: string, changed: boolean }|{ ok: false, status: number, error: string }}
 */
export function setArmed(db, apiKey, armed) {
  const b = getArmingBroadcast(db, apiKey);
  if (!b) return { ok: false, status: 409, error: 'No live or active broadcast to arm' };
  const next = armed ? 1 : 0;
  const changed = b.armed !== next;
  if (changed) {
    db.prepare("UPDATE broadcasts SET armed = ?, updated_at = datetime('now') WHERE api_key = ? AND id = ?").run(next, apiKey, b.id);
  }
  return { ok: true, armed: Boolean(next), broadcastId: b.id, changed };
}

/**
 * Set the flag on a specific broadcast (go-live auto-arm, session-end disarm).
 * @returns {boolean} true when the value changed
 */
export function setBroadcastArmed(db, apiKey, broadcastId, armed) {
  if (!broadcastId) return false;
  const next = armed ? 1 : 0;
  return db.prepare("UPDATE broadcasts SET armed = ?, updated_at = datetime('now') WHERE api_key = ? AND id = ? AND armed != ?")
    .run(next, apiKey, broadcastId, next).changes > 0;
}

/**
 * Publish `production.arming_changed` for a project.
 * @param {{ publish: Function }|null} eventBus
 * @param {string} apiKey
 * @param {{ armed: boolean, broadcastId: string|null, reason: string }} change
 */
export function publishArmingChange(eventBus, apiKey, { armed, broadcastId, reason }) {
  if (!eventBus || !apiKey) return;
  try {
    eventBus.publish(apiKey, 'production.arming_changed', { armed, broadcastId, reason });
  } catch { /* telemetry must not break go-live */ }
}

/**
 * Arm a broadcast that just went live and announce it.
 * @returns {boolean} whether the state changed
 */
export function armOnGoLive(db, eventBus, apiKey, broadcastId) {
  const changed = setBroadcastArmed(db, apiKey, broadcastId, true);
  if (changed) publishArmingChange(eventBus, apiKey, { armed: true, broadcastId, reason: 'go_live' });
  return changed;
}

/**
 * Disarm a broadcast whose session ended and announce it. Call before
 * completeBroadcast (which clears the flag too, as a safety net).
 * @returns {boolean} whether the state changed
 */
export function disarmOnEnd(db, eventBus, apiKey, broadcastId) {
  const changed = setBroadcastArmed(db, apiKey, broadcastId, false);
  if (changed) publishArmingChange(eventBus, apiKey, { armed: false, broadcastId, reason: 'session_end' });
  return changed;
}
