/**
 * Caption clock sync owned by a live broadcast (plan_broadcast_lifecycle.md 2.5b).
 *
 * YouTube needs the sender's clock offset to stamp captions. A session used to
 * sync only when the operator pressed Sync; while a broadcast is live this
 * service re-syncs every `intervalS` seconds (plus up to 10 % jitter) by calling
 * `sender.sync()` on every YouTube sender of the sessions bound to the broadcast,
 * and stores the result on the broadcast row.
 *
 * Failures never stop a broadcast: the previous offset stays in use, the failure
 * count goes up, and the interval backs off (x2, capped at x4) until one works.
 * One instance syncs a broadcast at a time (lease `broadcast-sync:<id>`).
 */

import { sqlNow } from '../db/helpers.js';

const JITTER = 0.1;
const MAX_BACKOFF = 4;
const WARN_AFTER_FAILURES = 3;

/**
 * @param {object} opts
 * @param {import('../db/connection.js').Db} opts.db
 * @param {{ entries: Function }} opts.store  SessionStore (iterated for sessions bound to the broadcast)
 * @param {{ publish: Function }|null} [opts.eventBus]
 * @param {{ acquire: Function }|null} [opts.leases]
 * @param {() => number} [opts.intervalS]  seconds, read on every schedule so a setting change applies
 * @param {{ warn: Function }} [opts.logger]
 * @param {(fn: Function, ms: number) => any} [opts.setTimer]
 * @param {(t: any) => void} [opts.clearTimer]
 * @param {() => number} [opts.random]
 */
export function createBroadcastCaptionSync({
  db, store, eventBus = null, leases = null, intervalS = () => 300, logger = console,
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer = clearTimeout, random = Math.random,
}) {
  /** broadcastId -> { apiKey, timer, failures } */
  const running = new Map();

  function sendersOf(broadcastId) {
    const out = [];
    for (const [, session] of store.entries()) {
      if (session.broadcastId !== broadcastId) continue;
      if (session.sender?.sync) out.push({ session, sender: session.sender });
      for (const t of session.extraTargets || []) {
        if (t.type === 'youtube' && t.sender?.sync) out.push({ session, sender: t.sender });
      }
    }
    return out;
  }

  /**
   * One sync round. Resolves `{ ok, offsetMs?, rttMs?, error?, senders }`; never throws.
   */
  async function syncNow(apiKey, broadcastId) {
    const targets = sendersOf(broadcastId);
    if (!targets.length) return { ok: false, skipped: true, error: 'no sender to sync', senders: 0 };
    let first = null;
    let lastError = null;
    for (const { session, sender } of targets) {
      try {
        const r = await sender.sync();
        if (session.syncOffset !== undefined || r?.syncOffset !== undefined) session.syncOffset = r.syncOffset;
        if (!first) first = { offsetMs: r.syncOffset, rttMs: r.roundTripTime };
      } catch (err) {
        lastError = err?.message || String(err);
      }
    }
    const now = sqlNow();
    if (first) {
      await db.broadcasts.updateMany({
        where: { api_key: apiKey, id: broadcastId },
        data: { sync_offset_ms: Math.round(first.offsetMs ?? 0), last_synced_at: now, sync_failures: 0 },
      });
      eventBus?.publish?.(apiKey, 'broadcast.caption_synced', { broadcastId, offsetMs: first.offsetMs, rttMs: first.rttMs ?? null });
      return { ok: true, ...first, senders: targets.length };
    }
    await db.broadcasts.updateMany({
      where: { api_key: apiKey, id: broadcastId },
      data: { sync_failures: { increment: 1 } },
    });
    return { ok: false, error: lastError, senders: targets.length };
  }

  function nextDelayMs(failures) {
    const base = Math.max(5, Number(intervalS()) || 300) * 1000;
    const backoff = Math.min(MAX_BACKOFF, failures > 0 ? 2 ** failures : 1);
    return Math.round(base * backoff * (1 + random() * JITTER));
  }

  function schedule(broadcastId) {
    const entry = running.get(broadcastId);
    if (!entry) return;
    entry.timer = setTimer(async () => {
      const cur = running.get(broadcastId);
      if (!cur) return;
      try {
        const held = leases ? await leases.acquire(`broadcast-sync:${broadcastId}`, Math.max(60_000, nextDelayMs(0) * 2)) : true;
        if (held) {
          const r = await syncNow(cur.apiKey, broadcastId);
          if (!r.skipped) cur.failures = r.ok ? 0 : cur.failures + 1;
          if (!r.ok && !r.skipped && cur.failures === WARN_AFTER_FAILURES) {
            logger.warn(`[broadcast] caption sync failed ${cur.failures} times in a row for ${broadcastId}: ${r.error}`);
          }
        }
      } catch (err) {
        cur.failures += 1;
        logger.warn(`[broadcast] caption sync error for ${broadcastId}: ${err?.message}`);
      }
      schedule(broadcastId);
    }, nextDelayMs(entry.failures));
  }

  /** Start periodic syncing (idempotent). Does not sync immediately; call `syncNow` for that. */
  function start(apiKey, broadcastId) {
    if (running.has(broadcastId)) return;
    running.set(broadcastId, { apiKey, timer: null, failures: 0 });
    schedule(broadcastId);
  }

  function stop(broadcastId) {
    const entry = running.get(broadcastId);
    if (!entry) return;
    if (entry.timer) clearTimer(entry.timer);
    running.delete(broadcastId);
  }

  function stopAll() { for (const id of [...running.keys()]) stop(id); }

  return { start, stop, stopAll, syncNow, isRunning: (id) => running.has(id), nextDelayMs };
}
