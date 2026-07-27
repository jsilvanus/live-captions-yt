/**
 * Client for the broadcast-platform sync API (`/platforms*`).
 *
 * Replaces `lib/youtubeAuth.js` + `lib/youtubeApi.js`, which drove the YouTube
 * Data API straight from the browser using a Google Identity Services implicit
 * token. That flow could never produce a refresh token, so nothing it did
 * survived the tab closing. Everything here goes through lcyt-backend, which
 * holds an encrypted, auto-refreshing credential.
 *
 * MULTI-CHANNEL: a project may connect several accounts per platform, so every
 * per-broadcast call takes an optional `credentialId`. When it is omitted and
 * the project has more than one live account, the backend answers 409 with
 * `code: 'ambiguous_credential'` and the candidate list — enough to render a
 * picker without a second round-trip. `PlatformApiError` carries that payload
 * through so callers can branch on it.
 *
 * See docs/plans/plan_broadcast_platform_sync.md.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext.jsx';
import { useUserAuth } from './useUserAuth.js';

/** Carries the backend's machine-readable `code` and any candidate list. */
export class PlatformApiError extends Error {
  constructor(message, { status = 0, code = null, candidates = null, reason = null } = {}) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.code = code;
    this.candidates = candidates;
    this.reason = reason;
  }
}

/**
 * Human-readable guidance for the error codes the backend can return. Kept
 * here rather than inline at each call site so the same situation reads the
 * same way in the Setup Hub card and the broadcast panel.
 */
export function describePlatformError(err) {
  if (!(err instanceof PlatformApiError)) return err?.message || 'Something went wrong';
  switch (err.code) {
    case 'not_connected':
      return 'No account is connected for this platform yet — connect one in Setup → Broadcast platforms.';
    case 'ambiguous_credential':
      return 'This project has several accounts connected. Pick which one to use.';
    case 'credential_unusable':
      return err.reason === 'revoked'
        ? 'That account was disconnected. Reconnect it to continue.'
        : `${err.message} Reconnect the account in Setup → Broadcast platforms.`;
    case 'no_credential_key':
      return 'This server has no PLATFORM_CREDENTIAL_KEY configured, so platform accounts cannot be stored. Ask an administrator to set one.';
    case 'not_linked':
      return 'Schedule this broadcast on the platform first.';
    case 'quotaExceeded':
    case 'rateLimitExceeded':
      return 'The platform’s API quota is exhausted. Try again later.';
    default:
      return err.message;
  }
}

export function usePlatforms() {
  const session = useSessionContext();
  const { token: userToken, backendUrl: userBackendUrl } = useUserAuth();
  // Depend on the specific fields read, not the whole session object — a fresh
  // useSession() return value each render would otherwise give `call` a new
  // identity every time and re-trigger every effect depending on it.
  const backendUrl = userBackendUrl || session?.backendUrl || '';
  const getSessionToken = session?.getSessionToken;

  const call = useCallback(async (path, { method = 'GET', body } = {}) => {
    const token = getSessionToken?.() || userToken;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${backendUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PlatformApiError(data.error || `Request failed (${res.status})`, {
        status: res.status,
        code: data.code || null,
        candidates: data.candidates || null,
        reason: data.reason || null,
      });
    }
    return data;
  }, [backendUrl, getSessionToken, userToken]);

  return useMemo(() => ({
    call,
    ready: !!backendUrl,

    listCredentials: () => call('/platforms'),

    /**
     * Begin consent. Returns the URL to navigate the *top-level window* to —
     * a fetch() cannot follow a cross-origin redirect to a consent screen, so
     * the caller must assign to window.location itself.
     */
    startConnect: (platform) => call(`/platforms/${platform}/oauth/start`),

    disconnect: (platform, credentialId) =>
      call(`/platforms/${platform}/disconnect`, { method: 'POST', body: { credentialId } }),

    listLinks: (broadcastId) => call(`/broadcasts/${broadcastId}/platforms`),

    schedule: (broadcastId, platform, body = {}) =>
      call(`/broadcasts/${broadcastId}/platforms/${platform}/schedule`, { method: 'POST', body }),

    setThumbnail: (broadcastId, platform, body) =>
      call(`/broadcasts/${broadcastId}/platforms/${platform}/thumbnail`, { method: 'POST', body }),

    goLive: (broadcastId, platform, body = {}) =>
      call(`/broadcasts/${broadcastId}/platforms/${platform}/go-live`, { method: 'POST', body }),

    endBroadcast: (broadcastId, platform, body = {}) =>
      call(`/broadcasts/${broadcastId}/platforms/${platform}/end`, { method: 'POST', body }),

    getStats: (broadcastId, platform, { history = false } = {}) =>
      call(`/broadcasts/${broadcastId}/platforms/${platform}/stats${history ? '?history=1' : ''}`),
  }), [call, backendUrl]);
}

/**
 * Connected accounts for the project, with the reload the OAuth round-trip
 * needs (the browser leaves and comes back, so the list must re-fetch on
 * return rather than trusting what it had before navigating away).
 */
export function usePlatformCredentials() {
  const api = usePlatforms();
  const [credentials, setCredentials] = useState([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      const data = await api.listCredentials();
      setCredentials(data.credentials || []);
      setStorageAvailable(data.credentialStorageAvailable !== false);
      setError('');
    } catch (err) {
      setError(describePlatformError(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { reload(); }, [reload]);

  return { credentials, storageAvailable, loading, error, reload, api };
}

/** Live accounts for one platform — what a picker offers. */
export function liveCredentialsFor(credentials, platform) {
  return (credentials || []).filter(c => c.platform === platform && !c.revokedAt);
}
