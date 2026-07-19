import { useCallback } from 'react';

/**
 * Returns a `fetch` wrapper that prefixes `backendUrl`, attaches the
 * session's bearer token (and a JSON `Content-Type`), and merges in any
 * per-call `opts` — the CRUD-manager pattern shared by CuesPage.jsx,
 * NamedActionsManager.jsx, and friends.
 *
 * @param {{ getSessionToken?: () => string|null }|null|undefined} session
 * @param {string} backendUrl
 * @returns {(path: string, opts?: RequestInit) => Promise<Response>}
 */
export function useAuthedFetch(session, backendUrl) {
  return useCallback((path, opts = {}) => {
    const token = session?.getSessionToken?.();
    return fetch(`${backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session, backendUrl]);
}
