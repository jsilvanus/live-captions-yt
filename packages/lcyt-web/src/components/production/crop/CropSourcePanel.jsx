import { C } from '../workspace/theme.js';

const ACC = '#3b6fb0';

/** Right column — camera / mixer / PTZ-preset source buttons. Crop
 *  positions are tied to *sources* (plan_vertical_crop.md §4: "camera 1 on
 *  preset 1" vs "camera 1 on preset 2" get their own crop window), so this
 *  panel is where the operator picks which source they're authoring a
 *  position for, and binds it to whichever preset is loaded in the canvas. */
export function CropSourcePanel({ hook }) {
  const { config, cameras, selectedSource, editingPreset, busy, boundEntryFor, sources, presets, actions } = hook;

  const bySourceCamera = (cameraId) => sources.filter((s) => s.cameraId === cameraId);

  async function bind() {
    if (!selectedSource || !editingPreset) return;
    await actions.bindSource(selectedSource, editingPreset.id);
  }
  async function unbind() {
    if (!selectedSource) return;
    await actions.unbindSource(selectedSource);
  }

  return (
    <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.panelBorder}`, background: C.panelBg, overflow: 'hidden' }}>
      <div style={{ padding: '10px 10px 6px' }}>
        <span style={{ fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.textMuted }}>Sources</span>
        <p style={{ fontSize: '.62rem', color: C.textFaint, margin: '4px 0 0', lineHeight: 1.5 }}>
          Pick a camera or PTZ preset, then bind it to the preset shown on the canvas.
        </p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cameras.length === 0 && (
          <p style={{ fontSize: '.66rem', color: C.textFaint, padding: '6px 4px' }}>No cameras configured yet.</p>
        )}
        {cameras.map((cam) => (
          <div key={cam.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: '.66rem', fontWeight: 600, color: '#c8c8c8', padding: '0 2px' }}>{cam.name}</span>
            {bySourceCamera(cam.id).map((src) => {
              const isSel = selectedSource && src.cameraId === selectedSource.cameraId && src.cameraPreset === selectedSource.cameraPreset;
              const bound = boundEntryFor(src);
              const boundPreset = bound ? presets.find((p) => p.id === bound.presetId) : null;
              return (
                <button key={`${src.cameraId}:${src.cameraPreset ?? 'any'}`} onClick={() => actions.selectSource(src)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', padding: '6px 9px', borderRadius: 6,
                    background: isSel ? 'rgba(59,111,176,.18)' : C.tileBg, border: `1px solid ${isSel ? ACC : C.tileBorder}`,
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: boundPreset ? C.ok : '#4a4a4a', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: '.7rem', color: '#dcdcdc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {src.presetName || 'whole camera'}
                  </span>
                  {boundPreset && (
                    <span style={{ fontSize: '.56rem', fontFamily: C.mono, color: C.okBright, flexShrink: 0, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{boundPreset.name}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ padding: 9, borderTop: `1px solid ${C.panelBorder}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {selectedSource ? (
          <>
            <div style={{ fontSize: '.62rem', color: C.textMuted, lineHeight: 1.5 }}>
              <strong style={{ color: '#ccc' }}>{selectedSource.label}</strong>
              {editingPreset ? <> → <strong style={{ color: '#8fd8a8' }}>{editingPreset.name}</strong></> : ' — no preset loaded'}
            </div>
            <button onClick={bind} disabled={!editingPreset || busy} style={{
              fontSize: '.7rem', fontWeight: 600, padding: '7px 9px', borderRadius: 6,
              background: editingPreset ? '#1a7f4b' : C.btnBg, border: `1px solid ${editingPreset ? '#25995c' : C.btnBorder}`, color: editingPreset ? '#fff' : C.textFaint,
            }}>Bind this source</button>
            {boundEntryFor(selectedSource) && (
              <button onClick={unbind} disabled={busy} style={{ fontSize: '.66rem', color: '#e08a92', background: 'none', padding: '4px 0' }}>Unbind</button>
            )}
          </>
        ) : (
          <p style={{ fontSize: '.62rem', color: C.textFaint, margin: 0 }}>Select a source above.</p>
        )}
      </div>
      {config?.followProgram === false && (
        <p style={{ fontSize: '.58rem', color: C.gold, padding: '0 9px 9px', lineHeight: 1.5 }}>
          "Follow program" is off — bindings are saved but won't auto-apply on camera/mixer switches.
        </p>
      )}
    </div>
  );
}
