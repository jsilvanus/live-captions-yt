/**
 * Admin panel utilities — shared helpers for admin key management and API calls.
 */

const ADMIN_KEY_STORAGE = 'lcyt.admin.key';

export function getAdminKey() {
  try { return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch { return ''; }
}

export function setAdminKey(key) {
  try { sessionStorage.setItem(ADMIN_KEY_STORAGE, key); } catch { /* */ }
}

export function adminFetch(backendUrl, path, opts = {}) {
  const key = getAdminKey();
  return fetch(`${backendUrl}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': key,
      ...opts.headers,
    },
  });
}
