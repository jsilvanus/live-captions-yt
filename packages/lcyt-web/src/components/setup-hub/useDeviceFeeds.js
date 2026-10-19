import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FEEDS_CHANGED_EVENT, notifyFeedsChanged, linkBody, UNLINK_BODY, buildDeviceNames,
} from '../../lib/deviceFeeds.js';

/** Authenticated fetch against the backend's /api/v1 (same token as the Feeds card). */
function makeAuthedFetch(backendUrl, getSessionToken) {
  return (path, opts = {}) => {
    const token = getSessionToken?.();
    return fetch(`${backendUrl}/api/v1${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  };
}

/**
 * The project's feeds (`GET /feeds`) plus link/unlink. Reloads on FEEDS_CHANGED_EVENT, so a change made in
 * one card shows in the other. `feeds` is null until the first answer (or when feeds are unavailable).
 */
export function useDeviceFeeds({ connected, backendUrl, getSessionToken }) {
  const [feeds, setFeeds] = useState(null);
  const [error, setError] = useState('');
  const authedFetch = useMemo(() => makeAuthedFetch(backendUrl, getSessionToken), [backendUrl, getSessionToken]);

  const load = useCallback(async () => {
    if (!connected) return;
    try {
      const r = await authedFetch('/feeds');
      setFeeds(r.ok ? ((await r.json())?.feeds || []) : null);
    } catch {
      setFeeds(null);
    }
  }, [connected, authedFetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(FEEDS_CHANGED_EVENT, load);
    return () => window.removeEventListener(FEEDS_CHANGED_EVENT, load);
  }, [load]);

  // Resolves true when the server accepted the change. The listener above reloads the list.
  const writeLink = useCallback(async (feedId, body) => {
    setError('');
    try {
      const r = await authedFetch(`/feeds/${encodeURIComponent(feedId)}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!r.ok) return false;
      notifyFeedsChanged();
      return true;
    } catch {
      return false;
    }
  }, [authedFetch]);

  const link = useCallback(async (feedId, deviceType, deviceId) => {
    const ok = await writeLink(feedId, linkBody(deviceType, deviceId));
    if (!ok) setError('link');
    return ok;
  }, [writeLink]);

  const unlink = useCallback(async (feedId) => {
    const ok = await writeLink(feedId, UNLINK_BODY);
    if (!ok) setError('unlink');
    return ok;
  }, [writeLink]);

  return { feeds, error, setError, link, unlink };
}

/**
 * Device id -> name for the Feeds card chip. The three lists are fetched once when connected and kept in
 * state; a list that fails leaves its devices unnamed, and the chip falls back to the type and id.
 */
export function useDeviceNames({ connected, backendUrl, getSessionToken }) {
  const [names, setNames] = useState(() => new Map());
  const authedFetch = useMemo(() => makeAuthedFetch(backendUrl, getSessionToken), [backendUrl, getSessionToken]);

  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    const fetchList = async path => {
      try {
        const r = await authedFetch(path);
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };
    Promise.all([
      fetchList('/production/cameras'),
      fetchList('/production/mixers'),
      fetchList('/production/encoders'),
    ]).then(([camera, mixer, encoder]) => {
      if (!cancelled) setNames(buildDeviceNames({ camera, mixer, encoder }));
    });
    return () => { cancelled = true; };
  }, [connected, authedFetch]);

  return names;
}
