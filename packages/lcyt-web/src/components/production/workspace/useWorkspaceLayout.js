import { useState, useCallback, useEffect, useRef } from 'react';
import * as L from './layout.js';

// Thin React wrapper over the pure layout engine: holds the persisted view
// tree, re-initialises when the project scope changes, and exposes the
// structural edit + resize actions the grid needs.

export function useWorkspaceLayout(scope) {
  const [state, setState] = useState(() => L.initialLayoutState(scope));
  const scopeRef = useRef(scope);

  // Reload the stored layout when switching projects.
  useEffect(() => {
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      setState(L.initialLayoutState(scope));
    }
  }, [scope]);

  // Persist on every change.
  const apply = useCallback((producer) => {
    setState((s) => {
      const next = producer(s);
      L.persistLayoutState(scopeRef.current, next);
      return next;
    });
  }, []);

  const view = L.activeView(state);
  const isCustom = view.kind === 'custom';

  // ─── Resize drag handlers (one per axis) ─────────────────────────────
  const resizeCols = useCallback((e, i) => {
    const cont = e.currentTarget.closest('[data-cc="cols"]');
    if (!cont) return;
    const W = cont.clientWidth, start = e.clientX;
    const fracs = L.activeView(state).cols.map((c) => c.frac);
    const T = fracs.reduce((a, b) => a + b, 0);
    const move = (ev) => {
      const d = (ev.clientX - start) * T / W;
      const [na, nb] = L.resizePair(fracs, i, d, 0.06);
      apply((s) => L.updateActiveView(s, (v) => { v.cols[i].frac = na; v.cols[i + 1].frac = nb; }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  }, [state, apply]);

  const resizeRows = useCallback((e, ci, i) => {
    const cont = e.currentTarget.closest('[data-cc="rows"]');
    if (!cont) return;
    const H = cont.clientHeight, start = e.clientY;
    const fracs = L.activeView(state).cols[ci].rows.map((r) => r.frac);
    const T = fracs.reduce((a, b) => a + b, 0);
    const move = (ev) => {
      const d = (ev.clientY - start) * T / H;
      const [na, nb] = L.resizePair(fracs, i, d, 0.08);
      apply((s) => L.updateActiveView(s, (v) => { v.cols[ci].rows[i].frac = na; v.cols[ci].rows[i + 1].frac = nb; }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    document.body.style.cursor = 'row-resize'; e.preventDefault();
  }, [state, apply]);

  const resizePanes = useCallback((e, ci, ri, i) => {
    const cont = e.currentTarget.closest('[data-cc="panes"]');
    if (!cont) return;
    const W = cont.clientWidth, start = e.clientX;
    const row = L.activeView(state).cols[ci].rows[ri];
    const fracs = (row.split && row.split.length === row.panels.length) ? row.split.slice() : row.panels.map(() => 1);
    const T = fracs.reduce((a, b) => a + b, 0);
    const move = (ev) => {
      const d = (ev.clientX - start) * T / W;
      const [na, nb] = L.resizePair(fracs, i, d, 0.12);
      apply((s) => L.updateActiveView(s, (v) => {
        const r = v.cols[ci].rows[ri];
        if (!r.split || r.split.length !== r.panels.length) r.split = r.panels.map(() => 1);
        r.split[i] = na; r.split[i + 1] = nb;
      }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  }, [state, apply]);

  return {
    state, view, isCustom,
    setActiveView: (id) => apply((s) => L.setActiveView(s, id)),
    addView:       () => apply((s) => L.addCustomView(s)),
    removeView:    (id) => apply((s) => L.removeView(s, id)),
    addColumn:     () => apply((s) => L.addColumn(s)),
    addRow:        (ci) => apply((s) => L.addRow(s, ci)),
    addPane:       (ci, ri) => apply((s) => L.addPane(s, ci, ri)),
    changePaneType:(ci, ri, pi, t) => apply((s) => L.changePaneType(s, ci, ri, pi, t)),
    removePane:    (ci, ri, pi) => apply((s) => L.removePane(s, ci, ri, pi)),
    resizeCols, resizeRows, resizePanes,
  };
}
