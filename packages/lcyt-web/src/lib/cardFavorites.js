import { useState, useEffect, useCallback } from 'react';
import { KEYS } from './storageKeys.js';

/**
 * Setup Hub card favorites — which cards the user has starred, so the
 * "Favorites" filter pill can show just those. Client-only (localStorage);
 * no server concept of favorites exists, this is a per-browser preference.
 *
 * A tiny module-level pub/sub keeps every SetupCard's star button and
 * SetupHubPage's filter pill in sync without prop-drilling through the ~15
 * Section components that each own their SetupCard instance internally.
 */

const listeners = new Set();

function readSet() {
  try {
    const raw = localStorage.getItem(KEYS.setup.favorites);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function writeSet(set) {
  try { localStorage.setItem(KEYS.setup.favorites, JSON.stringify([...set])); } catch {}
  listeners.forEach(fn => fn(set));
}

export function toggleFavorite(id) {
  const set = readSet();
  if (set.has(id)) set.delete(id); else set.add(id);
  writeSet(set);
  return set;
}

/** React hook: current favorites Set (reactive) + a toggle function. */
export function useCardFavorites() {
  const [favorites, setFavorites] = useState(readSet);

  useEffect(() => {
    listeners.add(setFavorites);
    return () => listeners.delete(setFavorites);
  }, []);

  const toggle = useCallback((id) => toggleFavorite(id), []);

  return { favorites, isFavorite: (id) => favorites.has(id), toggle };
}
