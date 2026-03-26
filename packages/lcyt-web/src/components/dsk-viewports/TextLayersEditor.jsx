import { dark, btnDanger, inputStyle, labelStyle } from './styles.js';

const COMMON_BINDINGS = ['section', 'stanza', 'speaker', 'song', 'lyrics'];

function TextLayerMiniPreview({ layer, vpWidth, vpHeight }) {
  const PREVIEW_W = 280;
  const scale = PREVIEW_W / vpWidth;
  const previewH = vpHeight * scale;
  return (
    <div style={{ position: 'relative', width: PREVIEW_W, height: previewH, background: '#181818', border: `1px solid ${dark.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: `${PREVIEW_W/8}px ${previewH/8}px` }} />
      <div style={{
        position: 'absolute',
        left:       (layer.x || 0) * scale,
        top:        (layer.y || 0) * scale,
        width:      (layer.width || 400) * scale,
        height:     (layer.height || 80) * scale,
        border:     '1px dashed rgba(68,255,136,0.6)',
        background: 'rgba(68,255,136,0.05)',
        display:    'flex',
        alignItems: 'center',
        justifyContent: layer.textAlign === 'right' ? 'flex-end' : layer.textAlign === 'center' ? 'center' : 'flex-start',
        fontSize:   Math.max(8, (layer.fontSize || 48) * scale),
        fontWeight: layer.fontWeight || 'bold',
        color:      layer.color || '#ffffff',
        padding:    '0 4px',
        overflow:   'hidden',
        whiteSpace: 'nowrap',
      }}>
        {layer.binding || layer.text || <span style={{ opacity: 0.4, fontStyle: 'italic' }}>binding</span>}
      </div>
    </div>
  );
}

export function TextLayersEditor({ layers, onChange, vpWidth, vpHeight }) {
  function updateLayer(idx, patch) {
    onChange(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function removeLayer(idx) {
    onChange(ls => ls.filter((_, i) => i !== idx));
  }

  if (layers.length === 0) {
    return <div style={{ color: dark.muted, fontSize: 13 }}>No text layers. Click &quot;+ Add Layer&quot; to add one.</div>;
  }

  return (
    <div>
      {layers.map((layer, idx) => (
        <div key={layer.id || idx} style={{ background: '#1a1a1a', border: `1px solid ${dark.border}`, borderRadius: 6, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 'bold', color: dark.text }}>
              Layer {idx + 1}{layer.binding ? ` — bound to "${layer.binding}"` : ' — static text'}
            </span>
            <button style={{ ...btnDanger, padding: '3px 8px', fontSize: 11 }} onClick={() => removeLayer(idx)}>Remove</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Binding (code key)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  list={`bindings-list-${idx}`}
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="section, stanza, speaker…"
                  value={layer.binding || ''}
                  onChange={e => updateLayer(idx, { binding: e.target.value })}
                />
                <datalist id={`bindings-list-${idx}`}>
                  {COMMON_BINDINGS.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Static text (shown when no binding value)</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                placeholder="optional fallback"
                value={layer.text || ''}
                onChange={e => updateLayer(idx, { text: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {[['x', 'X (px)'], ['y', 'Y (px)'], ['width', 'Width (px)'], ['height', 'Height (px)']].map(([key, lbl]) => (
              <div key={key} style={{ flex: '0 0 100px' }}>
                <label style={labelStyle}>{lbl}</label>
                <input
                  style={{ ...inputStyle, width: '100%' }}
                  type="number"
                  value={layer[key] ?? ''}
                  onChange={e => updateLayer(idx, { [key]: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
            ))}
            <div style={{ flex: '0 0 80px' }}>
              <label style={labelStyle}>Font size</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                type="number"
                value={layer.fontSize ?? 48}
                onChange={e => updateLayer(idx, { fontSize: parseInt(e.target.value, 10) || 48 })}
              />
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <label style={labelStyle}>Font weight</label>
              <select
                style={{ ...inputStyle, width: '100%' }}
                value={layer.fontWeight ?? 'bold'}
                onChange={e => updateLayer(idx, { fontWeight: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="600">600</option>
              </select>
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <label style={labelStyle}>Color</label>
              <input
                style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                type="color"
                value={layer.color || '#ffffff'}
                onChange={e => updateLayer(idx, { color: e.target.value })}
              />
            </div>
            <div style={{ flex: '0 0 100px' }}>
              <label style={labelStyle}>Align</label>
              <select
                style={{ ...inputStyle, width: '100%' }}
                value={layer.textAlign ?? 'center'}
                onChange={e => updateLayer(idx, { textAlign: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label style={labelStyle}>Text shadow (CSS)</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                placeholder="0 2px 8px rgba(0,0,0,0.8)"
                value={layer.textShadow || ''}
                onChange={e => updateLayer(idx, { textShadow: e.target.value })}
              />
            </div>
          </div>
          {(vpWidth && vpHeight) && (
            <div style={{ marginTop: 12 }}>
              <TextLayerMiniPreview layer={layer} vpWidth={vpWidth} vpHeight={vpHeight} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
