import { useEffect, useRef } from 'react';

/**
 * Attaches a window event listener while the component is mounted (and
 * while `enabled` is true, if provided).
 *
 * The handler is stored in a ref so callers do not need to memoize it.
 *
 * Replaces the repeated pattern:
 *
 *   useEffect(() => {
 *     function handler() { ... }
 *     window.addEventListener('some-event', handler);
 *     return () => window.removeEventListener('some-event', handler);
 *   }, []);
 *
 * @param {string}    eventName
 * @param {Function}  handler
 * @param {boolean}   [enabled=true]
 */
export function useWindowEvent(eventName, handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function listener(e) { handlerRef.current(e); }
    window.addEventListener(eventName, listener);
    return () => window.removeEventListener(eventName, listener);
  }, [eventName, enabled]);
}
