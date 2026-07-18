import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../contexts/SessionContext';

/**
 * Fetches the project's predefined STT source-language list from the backend.
 * Reuses the pattern from LanguagesManager (/stt/source-languages endpoint).
 *
 * @returns {object} { sourceLanguages: Array<{lang, label?, sort_order}>, loading: bool, error: string|null }
 */
export function useSourceLanguages() {
  const session = useSessionContext();
  const [sourceLanguages, setSourceLanguages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const authedFetch = useCallback((path, opts = {}) => {
    const token = session?.getSessionToken?.();
    const backendUrl = session?.backendUrl || '';
    return fetch(`${backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session]);

  const load = useCallback(async () => {
    if (!session?.connected) {
      setSourceLanguages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/stt/source-languages');
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSourceLanguages(data.languages || []);
      } else {
        setError(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.connected, authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  return { sourceLanguages, loading, error };
}
