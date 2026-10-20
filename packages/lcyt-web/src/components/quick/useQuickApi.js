import { useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';

/**
 * Authenticated JSON calls against `/api/v1` for the quick pages. Uses the project access token where there is one
 * (Setup-tier writes need a user token, see lib/setupToken.js), else the session token. Failed calls throw an Error
 * with `status` and the server's `error` text.
 * @returns {{ connected: boolean, call: (path: string, opts?: { method?: string, body?: object }) => Promise<any> }}
 */
export function useQuickApi() {
  const session = useSessionContext();
  const connected = !!session?.connected;
  const backendUrl = session?.backendUrl;
  const projectAccessToken = session?.projectAccessToken;
  const getSessionToken = session?.getSessionToken;

  const call = useCallback(async (path, { method = 'GET', body } = {}) => {
    const token = projectAccessToken || getSessionToken?.() || null;
    const r = await fetch(`${backendUrl}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data?.error || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  }, [backendUrl, projectAccessToken, getSessionToken]);

  return { connected, call };
}
