import { C } from './theme.js';

// Top header (title + status chips) and the view-pill bar.

function short(key) {
  if (!key) return null;
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;
}

const BROADCAST_STATUS_OPTIONS = ['draft', 'scheduled', 'live', 'completed'];

const BROADCAST_STATUS_COLORS = {
  draft:     { bg: C.chipBg, color: '#999' },
  scheduled: { bg: 'rgba(46,95,163,.22)', color: '#6ea8e8' },
  live:      { bg: 'rgba(204,0,34,.25)', color: '#ff7788' },
  completed: { bg: C.chipBg, color: '#777' },
  archived:  { bg: C.chipBg, color: '#555' },
};

function BroadcastStatusControl({ broadcast, onSetStatus }) {
  if (!broadcast) return null;
  const status = broadcast.status || 'draft';
  const colors = BROADCAST_STATUS_COLORS[status] || BROADCAST_STATUS_COLORS.draft;

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: '.72rem', fontWeight: 600, color: '#cfcfcf', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={broadcast.title}>
        {broadcast.title || `Broadcast ${broadcast.id}`}
      </span>
      {status === 'archived' ? (
        <span style={{ fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: colors.bg, color: colors.color }}>
          Archived
        </span>
      ) : (
        <select
          value={status}
          onChange={(e) => onSetStatus(e.target.value)}
          title="Broadcast status"
          style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '3px 6px', borderRadius: 5, background: colors.bg, color: colors.color, border: `1px solid ${C.panelBorder}`, cursor: 'pointer' }}
        >
          {BROADCAST_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
    </span>
  );
}

export function ProductionHeader({ D }) {
  const { ui } = D;
  const projectLabel = short(D.creds.apiKey);
  const cc = ui.captioning
    ? { bg: 'rgba(58,158,90,.16)', color: C.okBright, dot: C.ok, label: 'CC Live' }
    : { bg: C.chipBg, color: '#888', dot: '#5a5a5a', label: 'CC Off' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px', background: C.panelBg, borderBottom: `1px solid ${C.headerBorder}`, flexShrink: 0 }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(46,95,163,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#6ea8e8' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 5C2 4.4 2.4 4 3 4H8.5C9.1 4 9.5 4.4 9.5 5V11C9.5 11.6 9.1 12 8.5 12H3C2.4 12 2 11.6 2 11V5Z" stroke="currentColor" strokeWidth="1.2" /><path d="M9.5 6.5L14 4.5V11.5L9.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
      </div>
      <span style={{ fontSize: '.98rem', fontWeight: 700, letterSpacing: '-.01em', color: C.text }}>Production</span>
      {projectLabel && (
        <span style={{ fontSize: '.68rem', color: '#666', fontFamily: C.mono, background: C.chipBg, padding: '3px 8px', borderRadius: 5 }}>{projectLabel}</span>
      )}
      <BroadcastStatusControl broadcast={D.broadcast} onSetStatus={D.actions.setBroadcastStatus} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.64rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: 5, background: cc.bg, color: cc.color }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: cc.dot }} />{cc.label}
        </span>
        {ui.recording && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.64rem', fontWeight: 700, color: C.liveBright }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.liveBright }} />REC
          </span>
        )}
        <span style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.06em', padding: '5px 13px', borderRadius: 5, background: ui.onAir ? '#cc0022' : '#333', color: '#fff', transition: 'background .3s' }}>
          {ui.onAir ? 'ON AIR' : 'OFF AIR'}
        </span>
      </div>
    </div>
  );
}

export function ViewPills({ wl }) {
  const { state } = wl;
  const ids = state.viewOrder.filter((id) => state.views[id]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#141414', borderBottom: '1px solid #242424', overflowX: 'auto', flexShrink: 0 }}>
      {ids.map((id) => {
        const v = state.views[id];
        const active = id === state.activeView;
        const custom = v.kind === 'custom';
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <button onClick={() => wl.setActiveView(id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7,
                background: active ? '#e8e8e8' : C.tileBg, color: active ? '#111' : '#cfcfcf',
                fontSize: '.76rem', fontWeight: 600, whiteSpace: 'nowrap', border: `1px solid ${active ? '#e8e8e8' : C.panelBorder}` }}>
              {v.name}
            </button>
            {custom && (
              <button onClick={() => wl.removeView(id)} title="Delete view" style={{ marginLeft: -1, width: 20, height: 22, color: '#888', background: 'none', fontSize: '.85rem', lineHeight: 1 }}>×</button>
            )}
          </div>
        );
      })}
      <button onClick={wl.addView} title="New custom view" style={{ width: 28, height: 28, borderRadius: 7, background: C.tileBg, border: `1px solid ${C.panelBorder}`, color: '#bbb', fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }}>+</button>
      <span style={{ marginLeft: 'auto', fontSize: '.62rem', color: C.textFaint, whiteSpace: 'nowrap', paddingLeft: 10 }}>
        {wl.isCustom ? 'Custom view — retype, split (+), or remove (×) any panel · drag borders to resize' : 'Drag panel borders to resize · press + for an editable custom view'}
      </span>
    </div>
  );
}
