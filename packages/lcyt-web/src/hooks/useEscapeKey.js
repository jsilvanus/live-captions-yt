import { useEffect, useRef } from 'react';

/**
 * Registers a window-level keydown listener that calls `handler` when
 * the Escape key is pressed.  The listener is only active while `enabled`
 * is true — pass the modal's `isOpen` prop (or simply omit for always-on).
 *
 * The handler is stored in a ref so callers do not need to memoize it.
 *
 * @param {() => void} handler  — called on Escape press
 * @param {boolean}    [enabled=true]
 */
export function useEscapeKey(handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') handlerRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
