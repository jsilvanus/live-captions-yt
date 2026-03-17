import { KEYS } from './storageKeys.js';

const KEY_TARGETS = KEYS.targets.list;

/**
 * Load the list of configured caption targets from localStorage.
 *
 * Each entry:
 *   {
 *     id: string,          // UUID
 *     enabled: boolean,
 *     type: 'youtube' | 'generic' | 'viewer',
 *     streamKey?: string,  // YouTube stream key (type='youtube')
 *     url?: string,        // Endpoint URL (type='generic')
 *     headers?: string,    // Raw JSON string of extra HTTP headers (type='generic')
 *     viewerKey?: string,  // Short URL-safe key for viewer page (type='viewer')
 *   }
 *
 * @returns {Array}
 */
export function getTargets() {
  try {
    const raw = localStorage.getItem(KEY_TARGETS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function setTargets(list) {
  try { localStorage.setItem(KEY_TARGETS, JSON.stringify(list)); } catch {}
}

/** Convenience: returns only enabled targets. */
export function getEnabledTargets() {
  return getTargets().filter(t => t.enabled);
}

/**
 * Returns true if any enabled target has batch sending disabled.
 * Used to lock the global batch-window setting in Caption options.
 */
export function getAnyTargetNoBatch() {
  return getEnabledTargets().some(t => t.noBatch);
}
