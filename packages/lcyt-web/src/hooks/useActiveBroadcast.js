import { useCallback, useEffect, useState } from 'react';

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

export function useActiveBroadcast({ backendUrl, token, projectKey = null, enabled = true }) {
  const [broadcast, setBroadcast] = useState(null);
  const [projectName, setProjectName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!enabled || !backendUrl || !token) {
      setBroadcast(null);
      setProjectName(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/broadcasts/active`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(projectKey ? { 'X-Project-Id': projectKey } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBroadcast(data.broadcast ?? null);
      setProjectName(data.projectName ?? null);
    } catch (err) {
      setError(err.message || 'Failed to load active broadcast');
    } finally {
      setLoading(false);
    }
  }, [enabled, backendUrl, token, projectKey]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    window.addEventListener(ACTIVE_BROADCAST_EVENT, reload);
    return () => window.removeEventListener(ACTIVE_BROADCAST_EVENT, reload);
  }, [reload]);

  return {
    broadcast,
    activeBroadcastId: broadcast?.id ?? null,
    projectName,
    loading,
    error,
    reload,
  };
}
