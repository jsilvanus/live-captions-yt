/**
 * Which broadcast a caption session belongs to (plan_broadcast_lifecycle.md 2.5).
 *
 * A session never changes a broadcast's status. It attaches to one that the
 * operator (or the scheduler) has already staged or put live:
 *
 *   1. an explicit `broadcastId` must be `staging` or `live` (409 `not_staged` otherwise);
 *   2. else the project's current broadcast, when it is staging or live;
 *   3. else, for old clients, a broadcast of its own is made ("ad hoc"), staged
 *      and put live, so the session behaves as before;
 *   4. a project whose current broadcast is stopping or stopped answers 409
 *      `broadcast_stopped`: the session must not silently restart it.
 */

import { getBroadcast, createAdhocBroadcast } from '../db/broadcasts.js';

const ATTACHABLE = ['staging', 'live'];

export class SessionBindingError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {import('../db/connection.js').Db} db
 * @param {{ transition: Function, current: Function }|null} lifecycle
 * @param {string} apiKey
 * @param {{ broadcastId?: string, sequence?: number, recordEnabled?: boolean }} [opts]
 * @returns {Promise<{ broadcast: object, adhoc: boolean }>}
 */
export async function resolveSessionBroadcast(db, lifecycle, apiKey, { broadcastId, sequence = 0, recordEnabled = false } = {}) {
  if (broadcastId) {
    const b = await getBroadcast(db, apiKey, broadcastId);
    if (!b) throw new SessionBindingError('Broadcast not found', 404, 'not_found');
    if (!ATTACHABLE.includes(b.status)) {
      throw new SessionBindingError(`Broadcast is ${b.status}; stage it first`, 409, 'not_staged');
    }
    return { broadcast: b, adhoc: false };
  }

  const cur = lifecycle ? await lifecycle.current(apiKey) : null;
  if (cur) {
    if (ATTACHABLE.includes(cur.status)) return { broadcast: cur, adhoc: false };
    throw new SessionBindingError(`The project's broadcast "${cur.title || cur.id}" is ${cur.status}; go live again or complete it`, 409, 'broadcast_stopped');
  }

  const created = await createAdhocBroadcast(db, apiKey, { sequence, recordEnabled: false });
  if (!lifecycle) {
    await db.broadcasts.updateMany({ where: { id: created.id }, data: { status: 'live', actual_start: new Date().toISOString() } });
    return { broadcast: await getBroadcast(db, apiKey, created.id), adhoc: true };
  }
  const opts = { skipDeliverables: true, keepSequence: true, force: true, reason: 'session started' };
  await lifecycle.transition(apiKey, created.id, 'stage', opts);
  const { broadcast } = await lifecycle.transition(apiKey, created.id, 'go-live', opts);
  return { broadcast, adhoc: true };
}

/**
 * When the last session of an ad-hoc broadcast ends, the broadcast ends with it
 * (stop, then complete), as it did before sessions were decoupled. A broadcast
 * made on purpose is never touched by a session ending.
 * @param {{ entries: Function }} store
 * @param {{ transition: Function }|null} lifecycle
 * @param {{ apiKey?: string, broadcastId?: string|null, sessionId?: string }} ended  the session that just ended
 */
export async function endAdhocBroadcast(db, store, lifecycle, ended, logger = console) {
  if (!lifecycle || !ended?.broadcastId || !ended.apiKey) return;
  try {
    for (const [id, s] of store.entries()) {
      if (id !== ended.sessionId && s.broadcastId === ended.broadcastId) return; // another session still uses it
    }
    const b = await getBroadcast(db, ended.apiKey, ended.broadcastId);
    if (!b?.adhoc || !['staging', 'live', 'stopping', 'stopped'].includes(b.status)) return;
    const opts = { reason: 'session ended', force: true };
    if (b.status !== 'stopped') await lifecycle.transition(ended.apiKey, b.id, 'stop', opts);
    await lifecycle.transition(ended.apiKey, b.id, 'complete', opts);
  } catch (err) {
    logger.warn?.(`[broadcasts] ending the ad-hoc broadcast ${ended.broadcastId} failed: ${err?.message}`);
  }
}
