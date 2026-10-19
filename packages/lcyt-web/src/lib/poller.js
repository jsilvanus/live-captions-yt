/**
 * Visibility- and failure-aware poll loop (framework-free, so it is testable
 * with injected timers). Used by `hooks/usePolling.js`.
 *
 * - No overlap: the next run is scheduled after the previous one settles.
 * - Paused while the tab is hidden; runs once right away when it comes back.
 * - Backs off (interval x2 per consecutive failure, capped) after errors.
 * - Stops for good on a 401 (thrown error with `status === 401`, or the task
 *   returning `STOP_POLLING`): a stale token never recovers by retrying.
 */

export const STOP_POLLING = Symbol('stop-polling');

const noop = () => {};

/**
 * @param {{
 *   task: () => unknown|Promise<unknown>,
 *   intervalMs: number,
 *   maxBackoff?: number,
 *   runImmediately?: boolean,
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
    try {
      const result = await task();
      if (result === STOP_POLLING) { stop(); return; }
      failures = 0;
    } catch (err) {
      if (err && err.status === 401) { stop(); return; }
      failures += 1;
    } finally {
      running = false;
    }
    schedule();
  }

  function onVisible() {
    if (stopped) return;
    if (isHidden()) { clear(); return; }
    if (!running) { clear(); void run(); }
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
