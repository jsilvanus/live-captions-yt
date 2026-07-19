/**
 * PollScheduler — session-long, pointer-independent background refresh.
 *
 * The !api:/api:/api!: metacode tiers stay exactly as they are: pointer-scoped,
 * owned entirely by the frontend (InputBar.jsx's onPointerChanged effect), and
 * this scheduler does not change their behavior in any way. "Constant poll" is
 * a deliberately separate, explicit opt-in per request — toggled via
 * PUT /connectors/:connectorSlug/requests/:requestSlug/poll (never implied by
 * writing !api:/api!: inline) — for a variable the operator wants kept fresh
 * continuously, independent of any caption pointer or open browser tab.
 *
 * Keyed by the request's stable `id`, not by (apiKey, connectorSlug,
 * requestSlug) strings. Every fire re-resolves the current api_key/
 * connectorSlug/requestSlug from the DB by id (getConstantPollTarget) instead
 * of closing over slugs captured at start() time — so a connector or request
 * slug rename takes effect on the very next tick with no explicit re-keying
 * anywhere in the route layer, and a deleted request self-heals (the next
 * fire finds nothing and stops itself) rather than needing every mutation
 * path to remember to call stop(). Only a changed prefetch_interval_ms still
 * needs an explicit start() to restart the timer at the new cadence — you
 * can't change a live setInterval's delay in place.
 *
 * Mirrors ttl-scheduler.js's shape otherwise: a Map<key, interval handle>,
 * restore() on startup, last-write-wins start() (clears any existing
 * interval first).
 *
 * See docs/plans/plan_live_variables.md §2.
 */
import logger from 'lcyt/logger';
import { listConstantPollRequests, getConstantPollTarget } from './db.js';

// Server-side polling has no natural brake (unlike the frontend prefetch tier,
// which only runs while a browser tab has the pointer on the line) — floor the
// interval so a misconfigured tiny prefetch_interval_ms can't hammer a
// third-party API indefinitely from the backend.
const MIN_INTERVAL_MS = 1000;

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {ReturnType<import('./resolution-engine.js').createResolutionEngine>} deps.engine
 */
export function createPollScheduler({ db, engine }) {
  /** @type {Map<string, NodeJS.Timeout>} requestId -> interval handle */
  const timers = new Map();

  function stop(requestId) {
    const t = timers.get(requestId);
    if (t) { clearInterval(t); timers.delete(requestId); }
  }

  // Failures here would otherwise vanish silently for the rest of the server
  // session — the poll keeps ticking but the watched variable just stops
  // updating, with no signal to the operator (the UI's "polling" badge only
  // reflects the DB flag, not fetch success).
  function fireAndLog(requestId) {
    let target;
    try {
      target = getConstantPollTarget(db, requestId);
    } catch (err) {
      logger.warn(`[poll-scheduler] ${requestId} lookup failed: ${err?.message ?? err}`);
      return;
    }
    if (!target || !target.constant_poll_enabled) {
      // The request was deleted, or polling was disabled through some path
      // that didn't call stop() — self-heal instead of firing forever.
      stop(requestId);
      return;
    }
    engine.fireRequest(target.api_key, target.connector_slug, target.request_slug)
      .then((result) => {
        if (!result?.ok) {
          logger.warn(`[poll-scheduler] ${target.api_key} ${target.connector_slug}.${target.request_slug} failed: ${result?.error || 'unknown error'}`);
        }
      })
      .catch((err) => {
        logger.warn(`[poll-scheduler] ${target.api_key} ${target.connector_slug}.${target.request_slug} threw: ${err?.message ?? err}`);
      });
  }

  /** (Re)start polling a request by id. Last-write-wins — clears any existing interval first. */
  function start(requestId, intervalMs) {
    stop(requestId);
    const delay = Math.max(MIN_INTERVAL_MS, Number(intervalMs) || 3000);
    const t = setInterval(() => fireAndLog(requestId), delay);
    if (typeof t.unref === 'function') t.unref();
    timers.set(requestId, t);
    // Fire once immediately (mirrors the frontend prefetch tier's "refresh on
    // arrival" behavior) rather than waiting a full interval for the first
    // value. Registering the timer first means fireAndLog's self-heal (an
    // invalid/deleted requestId) stops it right away instead of one tick late.
    fireAndLog(requestId);
  }

  function isPolling(requestId) {
    return timers.has(requestId);
  }

  /** On startup: (re)start every request persisted with constant_poll_enabled, across all projects. */
  function restore() {
    let rows = [];
    try {
      rows = listConstantPollRequests(db);
    } catch { /* table may not exist yet in some isolated contexts */ }
    for (const r of rows) start(r.request_id, r.interval_ms);
  }

  function stopAll() {
    for (const t of timers.values()) clearInterval(t);
    timers.clear();
  }

  return { start, stop, restore, stopAll, isPolling };
}
