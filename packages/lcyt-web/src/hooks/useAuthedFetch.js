import { useCallback } from 'react';
import { setupToken } from '../lib/setupToken.js';

/**
 * Returns a `fetch` wrapper that prefixes `backendUrl`, attaches the
 * project-access token when available (required by role-gated writes), otherwise
 * the live-session bearer token, and merges in any
 * per-call `opts` — the CRUD-manager pattern shared by CuesPage.jsx,
 * NamedActionsManager.jsx, and friends.
 *
 * @param {{ projectAccessToken?: string|null, getSessionToken?: () => string|null }|null|undefined} session
 * @param {string} backendUrl
 * @returns {(path: string, opts?: RequestInit) => Promise<Response>}
 */
export function useAuthedFetch(session, backendUrl) {
  return useCallback((path, opts = {}) => {
    const token = setupToken(session);
    return fetch(`${backendUrl}/api/v1${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session, backendUrl]);
}
