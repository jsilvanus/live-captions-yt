import { useEffect } from 'react';

/**
 * Attaches a window event listener while the component is mounted (and
 * while `enabled` is true, if provided).
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
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [eventName, handler, enabled]);
}
