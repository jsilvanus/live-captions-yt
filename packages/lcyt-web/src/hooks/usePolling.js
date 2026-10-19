import { useEffect, useRef } from 'react';
import { createPoller } from '../lib/poller.js';

export { STOP_POLLING } from '../lib/poller.js';

/**
 * Run `task` every `intervalMs` while `enabled`: paused while the tab is
 * hidden, backs off after failures, stops on a 401 (see lib/poller.js).
 * `task` may be async; it always sees the latest closure (no resubscribe when
 * it changes). Re-created only when `intervalMs`/`enabled`/`runImmediately` change.
 */
export function usePolling(task, intervalMs, { enabled = true, runImmediately = true } = {}) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return undefined;
    const poller = createPoller({ task: () => taskRef.current(), intervalMs, runImmediately });
    poller.start();
    return () => poller.stop();
  }, [intervalMs, enabled, runImmediately]);
}
