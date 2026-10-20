import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { setupToken } from '../lib/setupToken.js';

/**
 * The project's feeds (`GET /feeds`) and the feed the server STT listens to (`stt_config.feedId`,
 * `GET/PUT /stt/config`). `feeds` is empty when feeds are unavailable or the project is not connected.
 * `setFeed(id)` saves the choice ('' clears it, so the audio source / stream key of the STT card applies).
 */
export function useSttFeed() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const token = setupToken(session);
  const [feeds, setFeeds] = useState([]);
  const [feedId, setFeedId] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!connected || !backendUrl || !token) return undefined;
    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}` };
    (async () => {
      try {
        const [f, c] = await Promise.all([
          fetch(`${backendUrl}/api/v1/feeds`, { headers }),
          fetch(`${backendUrl}/api/v1/stt/config`, { headers }),
        ]);
        if (cancelled) return;
        setFeeds(f.ok ? ((await f.json())?.feeds || []) : []);
        setFeedId(c.ok ? ((await c.json())?.config?.feedId || '') : '');
      } catch {
        if (!cancelled) setFeeds([]);
      }
    })();
    return () => { cancelled = true; };
  }, [connected, backendUrl, token]);

  const setFeed = useCallback(async (id) => {
    if (!backendUrl || !token) return false;
    setError(false);
    try {
      const r = await fetch(`${backendUrl}/api/v1/stt/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feedId: id || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFeedId(id || '');
      return true;
    } catch {
      setError(true);
      return false;
    }
  }, [backendUrl, token]);

  return { feeds, feedId, setFeed, error };
}
