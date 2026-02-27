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

  function confirm(requestIdOrObj, details = {}) {
    let requestId = requestIdOrObj;
    let { sequence, serverTimestamp, count } = details || {};
    if (requestIdOrObj && typeof requestIdOrObj === 'object') {
      requestId = requestIdOrObj.requestId;
      sequence = requestIdOrObj.sequence;
      serverTimestamp = requestIdOrObj.serverTimestamp;
      count = requestIdOrObj.count;
    }

    setEntries(prev => {
      let assigned = 0;
      return prev.map(e => {
        if (e.requestId !== requestId) return e;
        let seq = sequence;
        if (typeof count === 'number' && count > 0 && Number.isFinite(sequence)) {
          seq = sequence + (count - 1 - assigned);
          assigned += 1;
        }
        return { ...e, pending: false, sequence: seq, serverTimestamp };
      });
    });
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
