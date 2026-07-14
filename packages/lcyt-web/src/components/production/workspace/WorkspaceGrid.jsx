import { C } from './theme.js';
import { paneMeta, TYPE_OPTIONS } from './paneTypes.js';
import { PaneBody, PaneHeaderActions } from './panes/index.jsx';

// Renders the column → row → pane tiling for the active view, plus resize
// handles and (in custom views) the per-pane retype / split / remove controls.

function ResizeHandle({ onPointerDown, orientation }) {
  const base = { position: 'absolute', zIndex: 5 };
  const style = orientation === 'col'
    ? { ...base, top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize' }
    : { ...base, left: 0, bottom: -3, width: '100%', height: 6, cursor: 'row-resize' };
  return <div onPointerDown={onPointerDown} style={style} />;
}

function Pane({ D, wl, type, ci, ri, pi, panelsLen, splitArr }) {
  const meta = paneMeta(type);
  const frac = splitArr && splitArr[pi] != null ? splitArr[pi] : 1;
  const hasSplitAfter = pi < panelsLen - 1;

  return (
    <div style={{ position: 'relative', flexGrow: frac, flexBasis: 0, minWidth: 0, display: 'flex' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: C.panelBg, border: `1px solid ${C.panelBorder}`, borderRadius: 8, overflow: 'hidden' }}>
        {/* Panel header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', background: C.headerBg, borderBottom: `1px solid ${C.headerBorder}`, flexShrink: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: meta.dot, flexShrink: 0 }} />
          <span style={{ fontSize: '.63rem', fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.title}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <PaneHeaderActions type={type} D={D} />
            {wl.isCustom && (
              <>
                <select value={type} onChange={(e) => wl.changePaneType(ci, ri, pi, e.target.value)}
                  style={{ background: '#222', color: '#ccc', border: `1px solid ${C.panelBorder}`, borderRadius: 5, fontSize: '.6rem', padding: '2px 4px', maxWidth: 112 }}>
                  {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button onClick={() => wl.addPane(ci, ri)} title="Split horizontally" style={iconBtn}>+</button>
                <button onClick={() => wl.removePane(ci, ri, pi)} title="Remove panel" style={iconBtn}>×</button>
              </>
            )}
          </div>
        </div>
        {/* Panel body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <PaneBody type={type} D={D} />
        </div>
      </div>
      {hasSplitAfter && <ResizeHandle orientation="col" onPointerDown={(e) => wl.resizePanes(e, ci, ri, pi)} />}
    </div>
  );
}

const iconBtn = { width: 20, height: 20, borderRadius: 5, background: '#222', border: `1px solid ${C.panelBorder}`, color: '#aaa', fontSize: '.8rem', lineHeight: 1 };

export function WorkspaceGrid({ D, wl }) {
  const { view } = wl;
  return (
    <div data-cc="cols" style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6, padding: 8, background: C.pageBg }}>
      {view.cols.map((col, ci) => (
        <div key={ci} data-cc="rows" style={{ position: 'relative', flexGrow: col.frac, flexBasis: 0, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {col.rows.map((row, ri) => (
            <div key={ri} data-cc="panes" style={{ position: 'relative', flexGrow: row.frac, flexBasis: 0, minHeight: 0, minWidth: 0, display: 'flex', gap: 6 }}>
              {row.panels.map((type, pi) => (
                <Pane key={pi} D={D} wl={wl} type={type} ci={ci} ri={ri} pi={pi} panelsLen={row.panels.length} splitArr={row.split} />
              ))}
              {ri < col.rows.length - 1 && <ResizeHandle orientation="row" onPointerDown={(e) => wl.resizeRows(e, ci, ri)} />}
            </div>
          ))}
          {wl.isCustom && (
            <button onClick={() => wl.addRow(ci)} style={{ flexShrink: 0, padding: 6, borderRadius: 6, background: 'transparent', border: '1px dashed #333', color: C.textMuted, fontSize: '.64rem', fontWeight: 600 }}>+ Panel</button>
          )}
          {ci < view.cols.length - 1 && <ResizeHandle orientation="col" onPointerDown={(e) => wl.resizeCols(e, ci)} />}
        </div>
      ))}
      {wl.isCustom && (
        <button onClick={wl.addColumn} title="Add column" style={{ flexShrink: 0, width: 44, borderRadius: 8, background: 'transparent', border: '1px dashed #333', color: C.textMuted, fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      )}
    </div>
  );
}
