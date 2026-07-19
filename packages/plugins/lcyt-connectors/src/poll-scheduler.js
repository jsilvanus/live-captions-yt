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
 * Mirrors ttl-scheduler.js's shape: a Map<key, interval handle>, restore() on
 * startup, last-write-wins start() (clears any existing interval first).
 *
 * See docs/plans/plan_live_variables.md §2.
 */
import { listConstantPollRequests } from './db.js';

const SEP = ' ';
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
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();
  const keyOf = (apiKey, connectorSlug, requestSlug) => `${apiKey}${SEP}${connectorSlug}.${requestSlug}`;

  function stop(apiKey, connectorSlug, requestSlug) {
    const k = keyOf(apiKey, connectorSlug, requestSlug);
    const t = timers.get(k);
    if (t) { clearInterval(t); timers.delete(k); }
  }

  /** (Re)start polling a request. Last-write-wins — clears any existing interval first. */
  function start(apiKey, connectorSlug, requestSlug, intervalMs) {
    stop(apiKey, connectorSlug, requestSlug);
    const delay = Math.max(MIN_INTERVAL_MS, Number(intervalMs) || 3000);
    // Fire once immediately (mirrors the frontend prefetch tier's "refresh on
    // arrival" behavior) rather than waiting a full interval for the first value.
    engine.fireRequest(apiKey, connectorSlug, requestSlug).catch(() => {});
    const t = setInterval(() => {
      engine.fireRequest(apiKey, connectorSlug, requestSlug).catch(() => {});
    }, delay);
    if (typeof t.unref === 'function') t.unref();
    timers.set(keyOf(apiKey, connectorSlug, requestSlug), t);
  }

  function isPolling(apiKey, connectorSlug, requestSlug) {
    return timers.has(keyOf(apiKey, connectorSlug, requestSlug));
  }

  /** On startup: (re)start every request persisted with constant_poll_enabled, across all projects. */
  function restore() {
    let rows = [];
    try {
      rows = listConstantPollRequests(db);
    } catch { /* table may not exist yet in some isolated contexts */ }
    for (const r of rows) start(r.api_key, r.connector_slug, r.request_slug, r.interval_ms);
  }

  function stopAll() {
    for (const t of timers.values()) clearInterval(t);
    timers.clear();
  }

  return { start, stop, restore, stopAll, isPolling };
}
