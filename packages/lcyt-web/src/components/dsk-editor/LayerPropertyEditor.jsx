import React from 'react';
import AnimationEditor from './AnimationEditor.jsx';

const inputStyle = {
  background: '#1e1e1e', border: '1px solid #444', color: '#eee',
  borderRadius: 3, padding: '3px 6px', fontSize: 13,
  flex: 1, minWidth: 0, boxSizing: 'border-box',
};
const fieldRowStyle    = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle       = { color: '#999', fontSize: 12, width: 90, flexShrink: 0, textAlign: 'right' };
const sectionLabelStyle = {
  borderTop: '1px solid #333', paddingTop: 6, marginTop: 2,
  color: '#777', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
};
const btnStyle = {
  background: '#2a2a2a', border: '1px solid #555', color: '#ddd',
  borderRadius: 4, padding: '4px 10px', fontSize: 13, cursor: 'pointer',
};
const btnActiveStyle  = { ...btnStyle, background: '#1a3a1a', border: '1px solid #44aa44', color: '#88ee88' };

function ColorTextInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <input type="color"
        value={value && value.startsWith('#') ? value.slice(0, 7) : '#000000'}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: 'none', cursor: 'pointer', flexShrink: 0 }}
      />
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

export default function LayerPropertyEditor({ layer, selectionCount, aspectLock, onAspectLock, onChange }) {
  if (selectionCount > 1 && !layer) {
    return <div style={{ color: '#888', fontSize: 13, padding: '16px 0' }}>{selectionCount} layers selected.</div>;
  }
  if (!layer) {
    return <div style={{ color: '#888', fontSize: 13, padding: '16px 0' }}>Select a layer to edit its properties.</div>;
  }

  function setField(key, value) {
    const numericKeys = ['x', 'y', 'width', 'height'];
    const val = value === '' ? undefined : (numericKeys.includes(key) ? Number(value) : value);
    onChange({ ...layer, [key]: val }, key === 'id' ? layer.id : undefined);
  }
  function setStyle(cssKey, value) {
    const style = { ...(layer.style || {}) };
    if (value === '' || value === undefined) delete style[cssKey]; else style[cssKey] = value;
    onChange({ ...layer, style });
  }

  const STYLE_FIELDS_RECT = [
    { key: 'background',   label: 'Background',   type: 'color-text' },
    { key: 'border-radius',label: 'Border radius',type: 'text', placeholder: '8px' },
  ];
  const STYLE_FIELDS_ELLIPSE = [
    { key: 'background', label: 'Background', type: 'color-text' },
  ];
  const STYLE_FIELDS_TEXT = [
    { key: 'font-family',  label: 'Font family',   type: 'text',   placeholder: 'Arial, sans-serif' },
    { key: 'font-size',    label: 'Font size',      type: 'text',   placeholder: '48px' },
    { key: 'font-weight',  label: 'Font weight',    type: 'select', options: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] },
    { key: 'font-style',   label: 'Italic',         type: 'select', options: ['normal', 'italic'] },
    { key: 'color',        label: 'Color',          type: 'color-text' },
    { key: 'letter-spacing', label: 'Letter spacing', type: 'text', placeholder: '2px' },
    { key: 'text-align',   label: 'Text align',     type: 'select', options: ['left', 'center', 'right'] },
    { key: 'white-space',  label: 'White space',    type: 'select', options: ['normal', 'nowrap', 'pre'] },
    { key: 'text-shadow',       label: 'Text shadow',  type: 'text', placeholder: '1px 1px 4px #000' },
    { key: '-webkit-text-stroke', label: 'Text stroke', type: 'text', placeholder: '1px #000' },
  ];
  const STYLE_FIELDS_BORDER = [
    { key: 'border',     label: 'Border',  type: 'text', placeholder: '2px solid #fff' },
    { key: 'box-shadow', label: 'Shadow',  type: 'text', placeholder: '0 2px 8px rgba(0,0,0,0.5)' },
  ];

  const styleFields = layer.type === 'text'    ? STYLE_FIELDS_TEXT
                    : layer.type === 'rect'    ? STYLE_FIELDS_RECT
                    : layer.type === 'ellipse' ? STYLE_FIELDS_ELLIPSE
                    : [];

  const opacityVal = layer.style?.opacity !== undefined ? Number(layer.style.opacity) : 1;

  function renderStyleField(f) {
    if (f.type === 'color-text')
      return <ColorTextInput value={layer.style?.[f.key] || ''} onChange={v => setStyle(f.key, v)} />;
    if (f.type === 'select')
      return (
        <select value={layer.style?.[f.key] || ''} onChange={e => setStyle(f.key, e.target.value)} style={inputStyle}>
          <option value="">—</option>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    return (
      <input type="text" value={layer.style?.[f.key] || ''} placeholder={f.placeholder || ''}
             onChange={e => setStyle(f.key, e.target.value)} style={inputStyle} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>ID</span>
        <input type="text" value={layer.id || ''} onChange={e => setField('id', e.target.value)} style={inputStyle} />
      </div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Type</span>
        <span style={{ color: '#aaa', fontSize: 13 }}>{layer.type}</span>
      </div>
      {layer.type === 'text' && (
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Text</span>
          <input type="text" value={layer.text || ''} onChange={e => setField('text', e.target.value)} style={inputStyle} />
        </div>
      )}
      {layer.type === 'text' && (
        <div style={fieldRowStyle}>
          <span style={labelStyle} title="When set, text is auto-updated from caption codes (section, stanza, speaker…) via SSE bindings. Leave blank for static text.">Binding</span>
          <input type="text" value={layer.binding || ''} onChange={e => setField('binding', e.target.value)} style={inputStyle} placeholder="section, stanza, speaker…" />
        </div>
      )}
      {layer.type === 'image' && (
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Src</span>
          <input type="text" value={layer.src || ''} onChange={e => setField('src', e.target.value)} style={inputStyle} />
        </div>
      )}

      <div style={sectionLabelStyle}>Position & Size</div>
      {['x','y','width','height'].map(f => (
        <div key={f} style={fieldRowStyle}>
          <span style={labelStyle}>{f.toUpperCase()}</span>
          <input type="number" value={layer[f] ?? ''} onChange={e => setField(f, e.target.value)}
                 style={{ ...inputStyle, width: 100 }} />
        </div>
      ))}
      {layer.type === 'image' && (
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Aspect lock</span>
          <button onClick={onAspectLock}
                  style={aspectLock ? btnActiveStyle : btnStyle}>
            {aspectLock ? '🔒 On' : '🔓 Off'}
          </button>
        </div>
      )}

      <div style={sectionLabelStyle}>Opacity</div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Opacity</span>
        <input type="range" min="0" max="1" step="0.01" value={opacityVal}
               onChange={e => setStyle('opacity', e.target.value)}
               style={{ flex: 1, accentColor: '#4af' }} />
        <span style={{ color: '#888', fontSize: 11, width: 32, textAlign: 'right', flexShrink: 0 }}>
          {Math.round(opacityVal * 100)}%
        </span>
      </div>

      {styleFields.length > 0 && <div style={sectionLabelStyle}>Style</div>}
      {styleFields.map(f => (
        <div key={f.key} style={fieldRowStyle}>
          <span style={labelStyle}>{f.label}</span>
          {renderStyleField(f)}
        </div>
      ))}

      <div style={sectionLabelStyle}>Border & Shadow</div>
      {STYLE_FIELDS_BORDER.map(f => (
        <div key={f.key} style={fieldRowStyle}>
          <span style={labelStyle}>{f.label}</span>
          <input type="text" value={layer.style?.[f.key] || ''} placeholder={f.placeholder || ''}
                 onChange={e => setStyle(f.key, e.target.value)} style={inputStyle} />
        </div>
      ))}

      <div style={sectionLabelStyle}>Animation</div>
      <AnimationEditor value={layer.animation || ''} onChange={v => setField('animation', v || undefined)} />
    </div>
  );
}
