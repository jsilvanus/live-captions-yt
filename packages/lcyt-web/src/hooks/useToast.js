import { useState } from 'react';

let nextId = 0;

/**
 * Manages a queue of floating toast notifications.
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);

  function showToast(message, type = 'info', duration = 5000) {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, message, type, duration }]);

    if (duration > 0) {
      // Use functional setState so the timeout always operates on fresh state
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }
  }

  function dismissToast(id) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return { toasts, showToast, dismissToast };
}
