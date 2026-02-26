import { useState } from 'react';

const MAX_ENTRIES = 500;

/**
 * Manages the in-memory log of sent captions (newest-first).
 * Entries start as pending and transition to confirmed or error via SSE callbacks.
 */
export function useSentLog() {
  const [entries, setEntries] = useState([]);

  function add({ requestId, sequence, text, pending = false }) {
    const entry = {
      requestId,
      sequence,
      text,
      timestamp: new Date().toISOString(),
      pending,
      error: false,
    };
    setEntries(prev => [entry, ...prev].slice(0, MAX_ENTRIES));
  }

  function confirm(requestId, { sequence, serverTimestamp } = {}) {
    setEntries(prev =>
      prev.map(e =>
        e.requestId === requestId
          ? { ...e, pending: false, sequence, serverTimestamp }
          : e
      )
    );
  }

  function markError(requestId) {
    setEntries(prev =>
      prev.map(e =>
        e.requestId === requestId
          ? { ...e, pending: false, error: true }
          : e
      )
    );
  }

  // Remaps temp batch IDs to the real server requestId once the batch flushes
  function updateRequestId(oldId, newId) {
    setEntries(prev =>
      prev.map(e => e.requestId === oldId ? { ...e, requestId: newId } : e)
    );
  }

  function clear() {
    setEntries([]);
  }

  return { entries, add, confirm, markError, updateRequestId, clear };
}
