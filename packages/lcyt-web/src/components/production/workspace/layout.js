// Production workspace layout engine.
//
// Pure, framework-agnostic model + helpers for the tileable Production page,
// ported from the Claude Design mockup (project 9919ac53, "Production Page.dc.html").
//
// A "view" is a named tiling of the workspace:
//   view = { name, kind: 'builtin'|'custom', cols: Column[] }
//   Column = { frac, rows: Row[] }
//   Row    = { frac, panels: PaneType[], split: number[] }  // split[i] = flex-grow of panel i
//
// Built-in views ship read-only content; custom views are editable (retype,
// split, remove, add rows/cols) and cloned from whatever view was active.

const STORAGE_VERSION = 4;
const STORAGE_PREFIX = 'lcyt.production.workspace';

/** localStorage key, scoped per project so each project keeps its own layout. */
export function storageKey(scope) {
  return `${STORAGE_PREFIX}.${scope || 'default'}`;
}

/** A row helper: fill split with 1s when not given. */
function makeRow(frac, panels, split) {
  return { frac, panels, split: split || panels.map(() => 1) };
}

// A pane entry is either a bare type string (the original, still-valid shape)
// or { type, settings } for pane types that need per-instance config (e.g.
// which variable names a "variables" widget watches). Normalizers below let
// every consumer treat both shapes uniformly without a storage-version bump —
// old saved layouts (bare strings) keep working unchanged.
export function paneType(pane) {
  return typeof pane === 'string' ? pane : pane?.type;
}

export function paneSettings(pane) {
  return typeof pane === 'string' ? undefined : pane?.settings;
}

/** The four built-in views and their default order. */
export function defaultViews() {
  const views = {
    preflight: {
      name: 'Pre-flight', kind: 'builtin', cols: [
        { frac: 0.27, rows: [makeRow(0.56, ['cameras']), makeRow(0.44, ['thumbnails'])] },
        { frac: 0.43, rows: [makeRow(0.6, ['mixer']), makeRow(0.4, ['monitors'])] },
        { frac: 0.30, rows: [makeRow(0.32, ['youtube']), makeRow(0.36, ['ytpreview']), makeRow(0.32, ['lowerthirds'])] },
      ],
    },
    relay: {
      name: 'Live Relay', kind: 'builtin', cols: [
        { frac: 0.22, rows: [makeRow(0.4, ['cameras']), makeRow(0.3, ['mixerbtns']), makeRow(0.3, ['general'])] },
        { frac: 0.50, rows: [makeRow(0.5, ['program', 'ytmonitor']), makeRow(0.5, ['rundown'])] },
        { frac: 0.28, rows: [makeRow(0.5, ['sent']), makeRow(0.5, ['chat'])] },
      ],
    },
    mixer: {
      name: 'Live Mixer', kind: 'builtin', cols: [
        { frac: 0.22, rows: [makeRow(0.6, ['cameras']), makeRow(0.4, ['mixerbtns'])] },
        { frac: 0.52, rows: [makeRow(1, ['mixer'])] },
        { frac: 0.26, rows: [makeRow(0.55, ['monitors']), makeRow(0.45, ['ytpreview'])] },
      ],
    },
    captions: {
      name: 'Captions', kind: 'builtin', cols: [
        { frac: 0.20, rows: [makeRow(0.6, ['general']), makeRow(0.4, ['captionInput'])] },
        { frac: 0.50, rows: [makeRow(1, ['rundown'])] },
        { frac: 0.30, rows: [makeRow(0.5, ['sent']), makeRow(0.5, ['chat'])] },
      ],
    },
  };
  return { views, viewOrder: ['preflight', 'relay', 'mixer', 'captions'] };
}

/** Full persisted layout state (views + order + which is active + custom counter). */
export function initialLayoutState(scope) {
  const d = defaultViews();
  let stored = null;
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === STORAGE_VERSION) stored = p;
    }
  } catch { /* ignore malformed */ }
  return {
    views:       stored ? stored.views : d.views,
    viewOrder:   stored ? stored.viewOrder : d.viewOrder,
    activeView:  stored && stored.views[stored.activeView] ? stored.activeView : 'preflight',
    customCount: stored ? stored.customCount : 0,
  };
}

export function persistLayoutState(scope, state) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify({
      v: STORAGE_VERSION,
      views: state.views,
      viewOrder: state.viewOrder,
      activeView: state.activeView,
      customCount: state.customCount,
    }));
  } catch { /* quota / disabled storage — non-fatal */ }
}

export function activeView(state) {
  return state.views[state.activeView] || state.views.preflight;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Return a new state with `fn` applied to a deep clone of the active view.
 * Guards against mutating a built-in id that has vanished by falling back to preflight.
 */
export function updateActiveView(state, fn) {
  const views = { ...state.views };
  const id = views[state.activeView] ? state.activeView : 'preflight';
  const v = clone(views[id]);
  fn(v);
  views[id] = v;
  return { ...state, views };
}

export function setActiveView(state, id) {
  return { ...state, activeView: state.views[id] ? id : state.activeView };
}

/** Clone the active view into a new numbered custom view and switch to it. */
export function addCustomView(state) {
  const n = state.customCount + 1;
  const id = 'custom' + n;
  const src = state.views[state.activeView] || state.views.preflight;
  const cloneView = { name: String(n), kind: 'custom', cols: clone(src.cols) };
  return {
    ...state,
    views: { ...state.views, [id]: cloneView },
    viewOrder: [...state.viewOrder, id],
    activeView: id,
    customCount: n,
  };
}

export function removeView(state, id) {
  const views = { ...state.views };
  delete views[id];
  return {
    ...state,
    views,
    viewOrder: state.viewOrder.filter((x) => x !== id),
    activeView: state.activeView === id ? 'preflight' : state.activeView,
  };
}

// ─── Structural edits (custom views) ──────────────────────────────────────

export function addColumn(state) {
  return updateActiveView(state, (v) => {
    v.cols.push({ frac: 0.25, rows: [makeRow(1, ['monitors'])] });
  });
}

export function addRow(state, ci) {
  return updateActiveView(state, (v) => {
    v.cols[ci].rows.push(makeRow(0.5, ['monitors']));
  });
}

export function addPane(state, ci, ri) {
  return updateActiveView(state, (v) => {
    const r = v.cols[ci].rows[ri];
    r.panels.push('monitors');
    r.split = r.panels.map(() => 1);
  });
}

export function changePaneType(state, ci, ri, pi, type) {
  return updateActiveView(state, (v) => {
    v.cols[ci].rows[ri].panels[pi] = type;
  });
}

/** Update a pane's per-instance settings, preserving its current type. */
export function changePaneSettings(state, ci, ri, pi, settings) {
  return updateActiveView(state, (v) => {
    const r = v.cols[ci].rows[ri];
    r.panels[pi] = { type: paneType(r.panels[pi]), settings };
  });
}

export function removePane(state, ci, ri, pi) {
  return updateActiveView(state, (v) => {
    const r = v.cols[ci].rows[ri];
    r.panels.splice(pi, 1);
    if (r.split) r.split.splice(pi, 1);
    if (r.panels.length === 0) v.cols[ci].rows.splice(ri, 1);
    if (v.cols[ci].rows.length === 0 && v.cols.length > 1) v.cols.splice(ci, 1);
  });
}

// ─── Resize math (pure) ───────────────────────────────────────────────────
// Given the current fraction array and a pixel delta, returns a new pair of
// fractions for indices i and i+1, clamped to a minimum share. Used by the
// pointer-drag handlers for column / row / pane splitters.

export function resizePair(fracs, i, deltaFraction, minShare) {
  const T = fracs.reduce((a, b) => a + b, 0);
  const min = minShare * T;
  let a = fracs[i] + deltaFraction;
  let b = fracs[i + 1] - deltaFraction;
  if (a < min) { b -= min - a; a = min; }
  if (b < min) { a -= min - b; b = min; }
  return [a, b];
}
