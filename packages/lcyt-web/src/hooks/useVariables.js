import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Project-scoped {{ }} variable snapshot, backed by lcyt-connectors'
 * GET /variables + GET /variables/events SSE + POST /variables/refresh.
 *
 * See docs/plans/plan_api_connectors_variables.md §5, §6.
 *
 * @param {{ backendUrl: string, connected: boolean, getToken: () => string|null }} opts
 */
export function useVariables({ backendUrl, connected, getToken }) {
  // name -> { value, source, defaultValue, resolvedAt }
  const [variables, setVariables] = useState({});
  const esRef = useRef(null);
  const variablesRef = useRef(variables);
  variablesRef.current = variables;

  useEffect(() => {
    if (!connected || !backendUrl) {
      setVariables({});
      return;
    }
    const token = getToken?.();
    if (!token) return;

    let cancelled = false;
    fetch(`${backendUrl}/variables`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setVariables(data.variables || {}); })
      .catch(() => {});

    const es = new EventSource(`${backendUrl}/variables/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    es.addEventListener('variable_updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        setVariables((prev) => ({
          ...prev,
          [data.name]: {
            value: data.value,
            source: data.source,
            resolvedAt: data.resolvedAt,
            defaultValue: prev[data.name]?.defaultValue ?? null,
          },
        }));
      } catch { /* ignore malformed event */ }
    });

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, [backendUrl, connected, getToken]);

  /** { [name]: value } — the fallback chain (current -> default -> '') already applied server-side. */
  const snapshot = useCallback(() => {
    const out = {};
    for (const [name, v] of Object.entries(variablesRef.current)) out[name] = v.value ?? '';
    return out;
  }, []);

  /**
   * Fire a connector request. waitMs races it for a value (prefetch tier);
   * omit waitMs for fire-and-forget (pointer/send tiers).
   */
  const refresh = useCallback(async (connectorSlug, requestSlug, waitMs) => {
    const token = getToken?.();
    if (!token || !backendUrl) return null;
    try {
      const res = await fetch(`${backendUrl}/variables/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorSlug, requestSlug, waitMs }),
      });
      return res.ok ? res.json() : null;
    } catch {
      return null;
    }
  }, [backendUrl, getToken]);

  return { variables, snapshot, refresh };
}
