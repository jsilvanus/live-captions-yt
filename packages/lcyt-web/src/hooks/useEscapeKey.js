import { useEffect } from 'react';

/**
 * Registers a window-level keydown listener that calls `handler` when
 * the Escape key is pressed.  The listener is only active while `enabled`
 * is true — pass the modal's `isOpen` prop (or simply omit for always-on).
 *
 * @param {() => void} handler  — called on Escape press
 * @param {boolean}    [enabled=true]
 */
export function useEscapeKey(handler, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') handler();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, enabled]);
}
