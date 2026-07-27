/**
 * Live viewer-stats poller.
 *
 * Mirrors lcyt-connectors' poll-scheduler.js in shape: one repeating loop,
 * `restore()` on startup, and — importantly — it re-reads its work from the DB
 * on every tick rather than closing over a list captured at start time. A
 * broadcast that ends, is deleted, or has its link status change simply stops
 * appearing in `listLiveLinks()`, so the poller self-heals instead of requiring
 * every mutation path to remember to deregister it.
 *
 * Unlike connectors, this is a *single* interval walking all live links rather
 * than one timer per target: live broadcasts are few, and one timer keeps the
 * quota story simple (see below).
 *
 * QUOTA. The YouTube Data API quota is per-project and finite, and this loop
 * has no natural brake — nobody's browser has to be open for it to keep
 * running. Three guards:
 *   - it only polls links whose status is 'live';
 *   - the interval is floored, so a misconfigured tiny value can't hammer the
 *     API from the backend;
 *   - a 403 quota/rate-limit response backs the whole loop off for a cooldown
 *     rather than retrying tightly on the next tick.
 */
import logger from 'lcyt/logger';
import {
  listLiveLinks, insertStats, updateLink, STATS_LIVE_SNAPSHOT,
} from './db.js';

/** Server-side polling with no user-facing brake needs a hard floor. */
export const MIN_INTERVAL_MS = 5_000;
export const DEFAULT_INTERVAL_MS = 30_000;
/** How long to stand down after the provider reports a quota/rate-limit error. */
export const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

const QUOTA_REASONS = new Set(['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded']);

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {(platform: string) => object|null} deps.getAdapter
 * @param {(credentialId: string) => Promise<string>} deps.getAccessToken
 * @param {(broadcastId: string) => string|null} deps.getProjectForBroadcast  broadcast → api_key, for per-project event delivery
 * @param {{ publish: (projectId: string, topic: string, data: object) => void }} [deps.eventBus]
 * @param {() => number} [deps.getIntervalMs]
 */
export function createStatsPoller({
  db, getAdapter, getAccessToken, getProjectForBroadcast,
  eventBus = null, getIntervalMs = () => DEFAULT_INTERVAL_MS,
}) {
  /** @type {NodeJS.Timeout|null} */
  let timer = null;
  /** @type {number} */
  let currentIntervalMs = 0;
  /** epoch ms before which we don't call the provider at all */
  let cooldownUntil = 0;

  function resolveInterval() {
    const raw = Number(getIntervalMs());
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
    return Math.max(MIN_INTERVAL_MS, raw);
  }

  /**
   * Poll one live link. Errors are recorded on the link and swallowed — one
   * broadcast's failure must not stop the others from being polled, and a
   * throw here would otherwise take out the whole interval callback.
   * @returns {Promise<'ok'|'quota'|'error'>}
   */
  async function pollLink(link) {
    const adapter = getAdapter(link.platform);
    if (!adapter) return 'error';

    try {
      const accessToken = await getAccessToken(link.credential_id);
      const { concurrentViewers } = await adapter.getLiveStats(accessToken, link.external_broadcast_id);

      insertStats(db, {
        broadcastId: link.broadcast_id,
        platform: link.platform,
        kind: STATS_LIVE_SNAPSHOT,
        concurrentViewers,
      });
      updateLink(db, link.id, { lastSyncError: null });

      // Push rather than making the UI poll our REST route on top of us
      // polling YouTube — same delivery pattern as dsk.*/cue.* topics.
      const projectId = getProjectForBroadcast(link.broadcast_id);
      if (eventBus && projectId) {
        eventBus.publish(projectId, 'platform.stats_updated', {
          broadcastId: link.broadcast_id,
          platform: link.platform,
          concurrentViewers,
          capturedAt: new Date().toISOString().replace(/Z$/, ''),
        });
      }
      return 'ok';
    } catch (err) {
      // Recorded on the link so the operator can see *why* the viewer count
      // went stale, instead of it just silently stopping.
      updateLink(db, link.id, { lastSyncError: err.message });

      if (err?.statusCode === 403 && QUOTA_REASONS.has(err.reason)) {
        logger.warn(`[platforms] ${link.platform} quota exceeded — backing off stats polling`);
        return 'quota';
      }
      if (err?.name === 'CredentialUnusableError') {
        // No amount of retrying fixes this; the operator has to reconnect.
        logger.warn(`[platforms] stats poll skipped for broadcast ${link.broadcast_id}: ${err.message}`);
        return 'error';
      }
      logger.warn(`[platforms] stats poll failed for broadcast ${link.broadcast_id}: ${err.message}`);
      return 'error';
    }
  }

  /** One sweep over every currently-live link. */
  async function tick(now = Date.now()) {
    if (now < cooldownUntil) return;

    let links;
    try {
      links = listLiveLinks(db);
    } catch (err) {
      logger.warn(`[platforms] could not read live links: ${err.message}`);
      return;
    }
    if (!links.length) return;

    for (const link of links) {
      const result = await pollLink(link);
      if (result === 'quota') {
        cooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
        // Quota is per-project on the provider side, so once it is exhausted
        // the remaining links this tick would fail identically.
        break;
      }
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /**
   * (Re)start the loop. Safe to call repeatedly — a changed interval restarts
   * the timer, since a live setInterval's delay cannot be changed in place.
   */
  function start() {
    const interval = resolveInterval();
    if (timer && interval === currentIntervalMs) return;
    stop();
    currentIntervalMs = interval;
    timer = setInterval(() => { tick().catch(() => {}); }, interval);
    // Never hold the process open for a viewer counter.
    timer.unref?.();
  }

  /** Called once at startup, mirroring the connectors scheduler's restore(). */
  function restore() {
    start();
  }

  return {
    start, stop, restore, tick,
    /** @returns {number} 0 when not running */
    get intervalMs() { return timer ? currentIntervalMs : 0; },
    get cooldownUntil() { return cooldownUntil; },
  };
}
