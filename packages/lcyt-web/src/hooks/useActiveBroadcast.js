import { useCallback, useEffect, useRef, useState } from 'react';

// Shared "current active broadcast" hook (plan/broadcasts_next, Feature D).
//
// Fetches GET /broadcasts/active — which returns the project's active-broadcast
// pointer, the full broadcast row (with linked assets/files), and the project's
// display name — and re-fetches whenever any component announces a change via
// notifyActiveBroadcastChanged(). Auth: any Bearer JWT the /broadcasts routes
// accept (session token, or user token + projectKey → X-Project-Id header).

export const ACTIVE_BROADCAST_EVENT = 'lcyt:active-broadcast-changed';

export function notifyActiveBroadcastChanged() {
  window.dispatchEvent(new Event(ACTIVE_BROADCAST_EVENT));
}

const EMPTY_DATA = { broadcast: null, projectName: null };

export function useActiveBroadcast({ backendUrl, token, projectKey = null, enabled = true }) {
  const [state, setState] = useState({
    scopeKey: null,
    data: EMPTY_DATA,
    hasResolved: false,
    refreshing: false,
    error: null,
  });
  const requestId = useRef(0);
  const scopeKey = JSON.stringify([enabled, backendUrl ?? null, token ?? null, projectKey ?? null]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;

    if (!enabled || !backendUrl || !token) {
      setState({
        scopeKey,
        data: EMPTY_DATA,
        hasResolved: true,
        refreshing: false,
        error: null,
      });
      return;
    }

    // Keep the last good snapshot visible during refreshes, but never carry it
    // across an auth/project/backend scope change.
    setState((previous) => ({
      scopeKey,
      data: previous.scopeKey === scopeKey ? previous.data : EMPTY_DATA,
      hasResolved: previous.scopeKey === scopeKey && previous.hasResolved,
      refreshing: true,
      error: null,
    }));

    try {
      // Accept either an origin (http://localhost:3000) or an API base
      // (http://localhost:3000/api/v1). Normalize once to avoid double-prefixing.
      const apiBase = `${backendUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;
      const res = await fetch(`${apiBase}/broadcasts/active`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(projectKey ? { 'X-Project-Id': projectKey } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (requestId.current !== id) return;
      setState({
        scopeKey,
        data: {
          broadcast: data.broadcast ?? null,
          projectName: data.projectName ?? null,
        },
        hasResolved: true,
        refreshing: false,
        error: null,
      });
    } catch (err) {
      if (requestId.current !== id) return;
      setState((previous) => ({
        scopeKey,
        data: previous.scopeKey === scopeKey ? previous.data : EMPTY_DATA,
        hasResolved: true,
        refreshing: false,
        error: err.message || 'Failed to load active broadcast',
      }));
    }
  }, [enabled, backendUrl, token, projectKey, scopeKey]);

  useEffect(() => {
    reload();
    return () => {
      // Ignore responses from requests started under the previous hook scope
      // (or after unmount).
      requestId.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    window.addEventListener(ACTIVE_BROADCAST_EVENT, reload);
    return () => window.removeEventListener(ACTIVE_BROADCAST_EVENT, reload);
  }, [reload]);

  const current = state.scopeKey === scopeKey
    ? state
    : { data: EMPTY_DATA, hasResolved: false, refreshing: false, error: null };

  return {
    broadcast: current.data.broadcast,
    activeBroadcastId: current.data.broadcast?.id ?? null,
    projectName: current.data.projectName,
    // Keep the legacy flag for initial-load UI; background refreshes should not
    // make consumers replace already-rendered content with a loading state.
    loading: !current.hasResolved && current.refreshing,
    refreshing: current.refreshing,
    error: current.error,
    reload,
  };
}
