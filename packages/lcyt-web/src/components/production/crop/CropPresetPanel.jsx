import { useState } from 'react';
import { C } from '../workspace/theme.js';
import { useToastContext } from '../../../contexts/ToastContext';

const ACC = '#3b6fb0';

/** Left column — preset-set (bank) tabs + the preset list for whichever set
 *  is currently being browsed/edited (plan_vertical_crop.md §5 "Preset-set
 *  (bank) UI"). */
export function CropPresetPanel({ hook }) {
  const { config, sets, presets, viewSetId, editingPresetId, busy, actions } = hook;
  const { showToast } = useToastContext();
  const [renaming, setRenaming] = useState(null); // set id being renamed
  const [renameVal, setRenameVal] = useState('');

  const tabs = [{ id: null, name: 'Default' }, ...sets];
  const activeSetId = config?.activeSetId ?? null;

  async function newSet() {
    const name = window.prompt('New set name:');
    if (!name) return;
    const clone = viewSetId !== undefined && window.confirm(`Start from a copy of the "${tabs.find((t) => t.id === viewSetId)?.name || 'current'}" set?`);
    const res = await actions.createSet(name.trim(), clone ? viewSetId : null);
    if (!res.ok) showToast(res.error, 'error');
  }

  async function commitRename(id) {
    const name = renameVal.trim();
    setRenaming(null);
    if (!name) return;
    const ok = await actions.renameSet(id, name);
    if (!ok) showToast('Could not rename set', 'error');
  }

  async function removeSet(id, name) {
    if (!window.confirm(`Delete set "${name}"? Its presets and bindings are removed too.`)) return;
    await actions.deleteSet(id);
  }

  return (
    <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.panelBorder}`, background: C.panelBg, overflow: 'hidden' }}>
      <div style={{ padding: '10px 10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.textMuted }}>Sets</span>
        <button onClick={newSet} title="New set" style={{ width: 20, height: 20, borderRadius: 5, background: C.btnBg, border: `1px solid ${C.panelBorder}`, color: '#bbb', fontSize: '.8rem', lineHeight: 1 }}>+</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 6px 8px', borderBottom: `1px solid ${C.panelBorder}`, maxHeight: 180, overflowY: 'auto' }}>
        {tabs.map((s) => {
          const active = s.id === viewSetId;
          const isLive = s.id === activeSetId;
          return (
            <div key={s.id ?? 'default'} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {renaming === s.id ? (
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => commitRename(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(s.id); if (e.key === 'Escape') setRenaming(null); }}
                  style={{ flex: 1, fontSize: '.7rem', background: C.inputBg, border: `1px solid ${ACC}`, borderRadius: 5, padding: '5px 8px', color: '#fff' }} />
              ) : (
                <button onClick={() => actions.selectSet(s.id)} onDoubleClick={() => { if (s.id !== null) { setRenaming(s.id); setRenameVal(s.name); } }}
                  title={s.id !== null ? 'Double-click to rename' : undefined}
                  style={{
                    flex: 1, textAlign: 'left', padding: '6px 9px', borderRadius: 5, fontSize: '.72rem', fontWeight: active ? 600 : 500,
                    background: active ? 'rgba(59,111,176,.18)' : 'transparent', color: active ? '#cfe0f8' : '#bbb',
                    border: `1px solid ${active ? ACC : 'transparent'}`, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                  }}>
                  {isLive && <span title="Active set — follow-program draws from here" style={{ width: 6, height: 6, borderRadius: '50%', background: C.ok, flexShrink: 0 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </button>
              )}
              {s.id !== activeSetId && (
                <button onClick={() => actions.activateSet(s.id)} disabled={busy} title="Make this the active set" style={{ fontSize: '.58rem', color: '#8fbef0', background: 'none', padding: '2px 4px', flexShrink: 0 }}>activate</button>
              )}
              {s.id !== null && (
                <button onClick={() => removeSet(s.id, s.name)} title="Delete set" style={{ color: '#a55', background: 'none', fontSize: '.7rem', padding: '2px 4px', flexShrink: 0 }}>×</button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '9px 10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.textMuted }}>Presets</span>
        <button onClick={() => actions.selectPreset(null)} title="Start a new position" style={{ fontSize: '.6rem', color: '#8fbef0', background: 'none', padding: '2px 4px' }}>+ new</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {presets.length === 0 && (
          <p style={{ fontSize: '.66rem', color: C.textFaint, padding: '6px 4px', lineHeight: 1.5 }}>
            No presets in this set yet. Drag the crop box on the canvas and save it as a preset.
          </p>
        )}
        {presets.map((p) => {
          const active = p.id === editingPresetId;
          const isLivePreset = config?.activePresetId === p.id;
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6,
              background: active ? 'rgba(59,111,176,.16)' : C.tileBg, border: `1px solid ${active ? ACC : C.tileBorder}`,
            }}>
              <button onClick={() => actions.selectPreset(p.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none' }}>
                <div style={{ fontSize: '.74rem', fontWeight: 600, color: '#e2e2e2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {isLivePreset && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.liveBright, flexShrink: 0 }} title="Currently on air" />}
                  {p.name}
                </div>
                <div style={{ fontSize: '.6rem', fontFamily: C.mono, color: C.textMuted }}>x{(p.xNorm * 100).toFixed(0)}% y{(p.yNorm * 100).toFixed(0)}%</div>
              </button>
              <button onClick={() => actions.activatePreset(p.id)} disabled={busy || !config?.running} title={config?.running ? 'Apply live' : 'Renderer not running'}
                style={{ fontSize: '.6rem', fontWeight: 700, padding: '4px 7px', borderRadius: 5, background: config?.running ? C.ok : C.btnBg, color: config?.running ? '#fff' : C.textFaint, border: `1px solid ${config?.running ? C.ok : C.btnBorder}`, flexShrink: 0 }}>
                GO
              </button>
              <button onClick={() => actions.deletePreset(p.id)} title="Delete preset" style={{ color: '#a55', background: 'none', fontSize: '.7rem', padding: '2px 4px', flexShrink: 0 }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
