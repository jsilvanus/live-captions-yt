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
import { sqlNow } from './helpers.js';

const ARMING_FIELDS = { id: true, armed: true, status: true };

/**
 * The broadcast that carries the arming flag: the newest live one, else the
 * project's active (non-archived) one, else none.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<{ id: string, armed: number, status: string }|null>}
 */
export async function getArmingBroadcast(db, apiKey) {
  // NULL actual_start sorts last on both dialects (PostgreSQL would put NULLs first on DESC).
  const live = await db.broadcasts.findFirst({
    where: { api_key: apiKey, status: 'live' },
    orderBy: [{ actual_start: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
    select: ARMING_FIELDS,
  });
  if (live) return live;
  const key = await db.api_keys.findUnique({ where: { key: apiKey }, select: { active_broadcast_id: true } });
  if (!key?.active_broadcast_id) return null;
  return (await db.broadcasts.findFirst({
    where: { id: key.active_broadcast_id, api_key: apiKey, status: { not: 'archived' } },
    select: ARMING_FIELDS,
  })) ?? null;
}

/**
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<{ armed: boolean, broadcastId: string|null, status: string|null }>}
 */
export async function getArming(db, apiKey) {
  const b = await getArmingBroadcast(db, apiKey);
  return { armed: Boolean(b?.armed), broadcastId: b?.id ?? null, status: b?.status ?? null };
}

/** @param {import('./connection.js').Db} db @param {string} apiKey @returns {Promise<boolean>} */
export async function isArmed(db, apiKey) {
  return (await getArming(db, apiKey)).armed;
}

/**
 * Operator override. Fails with 409 when the project has no live or active
 * broadcast to hold the flag.
 * @param {import('./connection.js').Db} db
 * @returns {Promise<{ ok: true, armed: boolean, broadcastId: string, changed: boolean }|{ ok: false, status: number, error: string }>}
 */
export async function setArmed(db, apiKey, armed) {
  const b = await getArmingBroadcast(db, apiKey);
  if (!b) return { ok: false, status: 409, error: 'No live or active broadcast to arm' };
  const next = armed ? 1 : 0;
  const changed = b.armed !== next;
  if (changed) {
    await db.broadcasts.updateMany({ where: { api_key: apiKey, id: b.id }, data: { armed: next, updated_at: sqlNow() } });
  }
  return { ok: true, armed: Boolean(next), broadcastId: b.id, changed };
}

/**
 * Set the flag on a specific broadcast (go-live auto-arm, session-end disarm).
 * @param {import('./connection.js').Db} db
 * @returns {Promise<boolean>} true when the value changed
 */
export async function setBroadcastArmed(db, apiKey, broadcastId, armed) {
  if (!broadcastId) return false;
  const next = armed ? 1 : 0;
  const res = await db.broadcasts.updateMany({
    where: { api_key: apiKey, id: broadcastId, armed: { not: next } },
    data: { armed: next, updated_at: sqlNow() },
  });
  return res.count > 0;
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
 * @param {import('./connection.js').Db} db
 * @returns {Promise<boolean>} whether the state changed
 */
export async function armOnGoLive(db, eventBus, apiKey, broadcastId) {
  const changed = await setBroadcastArmed(db, apiKey, broadcastId, true);
  if (changed) publishArmingChange(eventBus, apiKey, { armed: true, broadcastId, reason: 'go_live' });
  return changed;
}

/**
 * Disarm a broadcast whose session ended and announce it. Call before
 * completeBroadcast (which clears the flag too, as a safety net).
 * @param {import('./connection.js').Db} db
 * @returns {Promise<boolean>} whether the state changed
 */
export async function disarmOnEnd(db, eventBus, apiKey, broadcastId) {
  const changed = await setBroadcastArmed(db, apiKey, broadcastId, false);
  if (changed) publishArmingChange(eventBus, apiKey, { armed: false, broadcastId, reason: 'session_end' });
  return changed;
}
