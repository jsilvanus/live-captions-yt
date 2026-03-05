import { useState, useEffect } from 'react';

const MAX_ENTRIES = 500;
const STORAGE_KEY = 'lcyt:sent-log';
const STORAGE_MAX = 100; // persist only last N confirmed entries

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveToStorage(entries) {
  try {
    const toSave = entries
      .filter(e => !e.pending && !e.error)
      .slice(0, STORAGE_MAX);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

/**
 * Manages the in-memory log of sent captions (newest-first).
 * Entries start as pending and transition to confirmed or error via SSE callbacks.
 * Confirmed entries are persisted in localStorage and restored on page load.
 */
export function useSentLog() {
  const [entries, setEntries] = useState(loadFromStorage);

  // Persist confirmed entries to localStorage whenever the list changes
  useEffect(() => {
    saveToStorage(entries);
  }, [entries]);

  function add({ requestId, sequence, text, pending = false, hasTranslations = false,
    captionLang = null, captionTranslationText = null, showOriginal = false, otherTranslations = {} }) {
    const entry = {
      requestId,
      sequence,
      text,
      timestamp: new Date().toISOString(),
      pending,
      error: false,
      hasTranslations,
      captionLang,
      captionTranslationText,
      showOriginal,
      otherTranslations,
    };
    setEntries(prev => [entry, ...prev].slice(0, MAX_ENTRIES));
  }

  function confirm(requestIdOrObj, details = {}) {
    let requestId = requestIdOrObj;
    let { sequence, serverTimestamp } = details || {};
    if (requestIdOrObj && typeof requestIdOrObj === 'object') {
      requestId = requestIdOrObj.requestId;
      sequence = requestIdOrObj.sequence;
      serverTimestamp = requestIdOrObj.serverTimestamp;
    }

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
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  return { entries, add, confirm, markError, updateRequestId, clear };
}
