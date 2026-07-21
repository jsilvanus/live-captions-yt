/**
 * storageQuota.js — plan_ui.md v2 §6d's localStorage quota monitoring.
 * `navigator.storage.estimate()` reports the *origin's* total storage quota
 * usage (localStorage + IndexedDB + caches, etc. combined) — there is no
 * browser API to measure localStorage in isolation or to intercept an
 * individual `localStorage.setItem()` call before it lands, so this checks
 * the origin-wide estimate periodically rather than gating each write.
 */

export const WARN_RATIO = 0.8;

/**
 * @returns {Promise<{ supported: boolean, usage: number, quota: number, ratio: number|null }>}
 */
export async function getStorageEstimate() {
  if (!navigator?.storage?.estimate) {
    return { supported: false, usage: 0, quota: 0, ratio: null };
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { supported: true, usage, quota, ratio: quota > 0 ? usage / quota : null };
  } catch {
    return { supported: false, usage: 0, quota: 0, ratio: null };
  }
}
