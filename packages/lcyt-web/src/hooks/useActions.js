import { useCallback, useEffect, useRef, useState } from 'react';
import { parseActionItems } from '../lib/metacode-actions.js';

/**
 * Project-scoped named actions, backed by lcyt-actions' `GET /actions`.
 * The stored `definition` is a raw composite expression string; this hook parses
 * each into an item list so `resolveDef(slug)` can feed expandActionItems().
 *
 * See docs/plans/plan_named_actions.md.
 *
 * @param {{ backendUrl: string, connected: boolean, getToken: () => string|null }} opts
 */
export function useActions({ backendUrl, connected, getToken }) {
  // slug -> { name, definition, items }
  const [defs, setDefs] = useState({});
  const defsRef = useRef(defs);
  defsRef.current = defs;

  const load = useCallback(() => {
    const token = getToken?.();
    if (!connected || !backendUrl || !token) { setDefs({}); return; }
    fetch(`${backendUrl}/actions`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.actions) return;
        const map = {};
        for (const a of data.actions) map[a.slug] = { name: a.name, definition: a.definition, items: parseActionItems(a.definition) };
        setDefs(map);
      })
      .catch(() => {});
  }, [backendUrl, connected, getToken]);

  useEffect(() => { load(); }, [load]);

  /** Resolve a named action's item list by slug (for expandActionItems). */
  const resolveDef = useCallback((slug) => defsRef.current[slug]?.items || null, []);

  return { defs, resolveDef, refresh: load };
}
