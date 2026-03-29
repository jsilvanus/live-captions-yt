/**
 * Admin panel utilities — shared helpers for admin authentication and API calls.
 *
 * Admin authentication is user-based: the logged-in user's JWT token is used as
 * a Bearer token. The server grants access when the user has `is_admin = 1`.
 *
 * Legacy `X-Admin-Key` support is maintained for deployments that set ADMIN_KEY.
 */

const ADMIN_KEY_STORAGE = 'lcyt.admin.key';
const USER_STORAGE_KEY = 'lcyt-user';

/** Get the legacy admin key (sessionStorage). Still used as fallback. */
export function getAdminKey() {
  try { return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch { return ''; }
}

/** Set the legacy admin key (sessionStorage). */
export function setAdminKey(key) {
  try { sessionStorage.setItem(ADMIN_KEY_STORAGE, key); } catch { /* */ }
}

/** Get the logged-in user's JWT token from localStorage. */
function getUserToken() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const { token } = JSON.parse(raw);
    return token || null;
  } catch { return null; }
}

/**
 * Perform an authenticated admin API request.
 * Prefers the user's JWT Bearer token (user-based admin).
 * Falls back to the legacy X-Admin-Key if no user token is available.
 */
export function adminFetch(backendUrl, path, opts = {}) {
  const userToken = getUserToken();
  const legacyKey = getAdminKey();

  const authHeaders = userToken
    ? { Authorization: `Bearer ${userToken}` }
    : legacyKey ? { 'X-Admin-Key': legacyKey } : {};

  return fetch(`${backendUrl}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...opts.headers,
    },
  });
}
