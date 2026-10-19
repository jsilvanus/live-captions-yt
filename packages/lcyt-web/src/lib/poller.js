/**
 * Visibility- and failure-aware poll loop (framework-free, so it is testable
 * with injected timers). Used by `hooks/usePolling.js`.
 *
 * - No overlap: the next run is scheduled after the previous one settles.
 * - Paused while the tab is hidden; runs once right away when it comes back.
 * - Backs off (interval x2 per consecutive failure, capped) after errors.
 * - A 401 (thrown error with `status === 401`) asks `onUnauthorized()` whether
 *   the credentials were renewed (local install: sign in again); if not, the
 *   loop stops for good, since a stale token never recovers by retrying. The
 *   task returning `STOP_POLLING` stops it unconditionally.
 * - On becoming visible again the previous values stay on screen: the loop
 *   refetches once, after a small random delay so pollers do not all fire in
 *   the same instant, and only if the last run is older than one interval.
 */

export const STOP_POLLING = Symbol('stop-polling');

const noop = () => {};

/**
 * @param {{
 *   task: () => unknown|Promise<unknown>,
 *   intervalMs: number,
 *   maxBackoff?: number,
 *   runImmediately?: boolean,
 *   onUnauthorized?: () => Promise<boolean>|boolean,
 *   resumeJitterMs?: number,
 *   random?: () => number,
 *   now?: () => number,
 *   isHidden?: () => boolean,
 *   onVisibilityChange?: (cb: () => void) => (() => void),
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 * }} opts
 * @returns {{ start(): void, stop(): void, readonly stopped: boolean }}
 */
export function createPoller({
  task,
  intervalMs,
  maxBackoff = 4,
  runImmediately = true,
  onUnauthorized = () => false,
  resumeJitterMs = 600,
  random = Math.random,
  now = Date.now,
  isHidden = () => typeof document !== 'undefined' && document.hidden,
  onVisibilityChange = (cb) => {
    if (typeof document === 'undefined') return noop;
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
  },
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let running = false;
  let stopped = true;
  let failures = 0;
  let lastRunAt = 0;
  let unsubscribe = noop;

  const clear = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  const schedule = () => {
    clear();
    if (stopped || isHidden()) return;
    const delay = intervalMs * Math.min(2 ** failures, maxBackoff);
    timer = setTimer(run, delay);
  };

  async function run() {
    timer = null;
    if (stopped || running || isHidden()) return;
    running = true;
    lastRunAt = now();
    try {
      const result = await task();
      if (result === STOP_POLLING) { stop(); return; }
      failures = 0;
    } catch (err) {
      if (err && err.status === 401) {
        let renewed = false;
        try { renewed = !!(await onUnauthorized()); } catch { /* treated as not renewed */ }
        if (!renewed) { stop(); return; }
      }
      failures += 1;
    } finally {
      running = false;
    }
    schedule();
  }

  function onVisible() {
    if (stopped) return;
    if (isHidden()) { clear(); return; }
    if (running) return;
    clear();
    const age = now() - lastRunAt;
    if (age >= intervalMs) timer = setTimer(run, Math.floor(random() * resumeJitterMs));
    else timer = setTimer(run, intervalMs - age);
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    failures = 0;
    unsubscribe = onVisibilityChange(onVisible);
    if (runImmediately) void run(); else schedule();
  }

  function stop() {
    stopped = true;
    clear();
    unsubscribe();
    unsubscribe = noop;
  }

  return { start, stop, get stopped() { return stopped; } };
}
