import { useState, useEffect } from 'react';
import { dark, btnPrimary, btnDanger, btnSmall, inputStyle, labelStyle } from './styles.js';

function ImageRow({ img, settings, isExpanded, onToggleExpand, onSave, serverUrl }) {
  const visible = settings.visible !== false;
  const hasPos  = settings.x != null || settings.y != null || settings.width != null || settings.height != null;
  const hasAnim = !!settings.animation;

  const [draft, setDraft] = useState({
    x:         settings.x         != null ? String(settings.x)         : '',
    y:         settings.y         != null ? String(settings.y)         : '',
    width:     settings.width     != null ? String(settings.width)     : '',
    height:    settings.height    != null ? String(settings.height)    : '',
    animation: settings.animation ?? '',
  });

  useEffect(() => {
    setDraft({
      x:         settings.x         != null ? String(settings.x)         : '',
      y:         settings.y         != null ? String(settings.y)         : '',
      width:     settings.width     != null ? String(settings.width)     : '',
      height:    settings.height    != null ? String(settings.height)    : '',
      animation: settings.animation ?? '',
    });
  }, [settings.x, settings.y, settings.width, settings.height, settings.animation]); // eslint-disable-line react-hooks/exhaustive-deps

  function parsePx(val) {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }

  function handleSave() {
    onSave({
      x:         parsePx(draft.x),
      y:         parsePx(draft.y),
      width:     parsePx(draft.width),
      height:    parsePx(draft.height),
      animation: draft.animation || null,
    });
  }

  return (
    <div style={{ borderBottom: `1px solid ${dark.border}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 80px 80px', gap: 8, padding: '6px 8px', alignItems: 'center' }}>
        <img
          src={`${serverUrl}/images/${img.id}`}
          alt=""
          style={{ width: 40, height: 40, objectFit: 'contain', background: '#111', borderRadius: 4, border: `1px solid ${dark.border}` }}
          crossOrigin="anonymous"
        />
        <div>
          <code style={{ fontSize: 13, color: '#aef' }}>{img.shorthand}</code>
          <span style={{ fontSize: 11, color: dark.muted, marginLeft: 8 }}>{img.mimeType?.split('/')[1]}</span>
        </div>
        <div>
          <input
            type="checkbox"
            checked={visible}
            onChange={e => onSave({ visible: e.target.checked })}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
        </div>
        <button
          style={{ ...btnSmall, background: isExpanded ? dark.cardHover : 'transparent', border: `1px solid ${isExpanded ? dark.border : 'transparent'}` }}
          onClick={onToggleExpand}
          title="Position & animation overrides"
        >
          {hasPos || hasAnim ? '✎' : '+'} pos
        </button>
      </div>

      {isExpanded && (
        <div style={{ padding: '8px 56px 12px', background: '#1a1a1a', borderTop: `1px solid ${dark.border}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            {[['x', 'X (px)'], ['y', 'Y (px)'], ['width', 'Width (px)'], ['height', 'Height (px)']].map(([key, lbl]) => (
              <div key={key} style={{ flex: '0 0 100px' }}>
                <label style={labelStyle}>{lbl}</label>
                <input
                  style={{ ...inputStyle, width: '100%' }}
                  type="number"
                  placeholder="auto"
                  value={draft[key]}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Animation</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                placeholder="e.g. lcyt-fadeIn 0.5s"
                value={draft.animation}
                onChange={e => setDraft(d => ({ ...d, animation: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={handleSave}>Save</button>
            <button style={btnDanger} onClick={() => onSave({ x: null, y: null, width: null, height: null, animation: null })}>
              Reset position
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ImageSettingsTable({ images, viewportName, getImgVpSettings, saveImgVpSettings, serverUrl }) {
  const [expanded, setExpanded] = useState(new Set());

  function toggle(id) {
    setExpanded(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 80px 80px', gap: 8, padding: '4px 8px', fontSize: 11, color: dark.muted, borderBottom: `1px solid ${dark.border}`, marginBottom: 4 }}>
        <span />
        <span>Shorthand</span>
        <span>Visible</span>
        <span>Position</span>
      </div>
      {images.map(img => {
        const settings = getImgVpSettings(img, viewportName);
        const isExpanded = expanded.has(img.id);
        return (
          <ImageRow
            key={img.id}
            img={img}
            settings={settings}
            isExpanded={isExpanded}
            onToggleExpand={() => toggle(img.id)}
            onSave={patch => saveImgVpSettings(img, viewportName, patch)}
            serverUrl={serverUrl}
          />
        );
      })}
    </div>
  );
}
