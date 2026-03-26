import React from 'react';
import { parseAnimation, buildAnimation } from '../../lib/dskEditorAnimation.js';

// Inject LCYT keyframes into the browser document once (for the live preview).
const LCYT_KEYFRAMES_CSS = `
@keyframes lcyt-fadeIn       { from { opacity: 0 } to { opacity: 1 } }
@keyframes lcyt-fadeOut      { from { opacity: 1 } to { opacity: 0 } }
@keyframes lcyt-slideInLeft  { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes lcyt-slideInRight { from { transform: translateX(100%)  } to { transform: translateX(0) } }
@keyframes lcyt-slideInUp    { from { transform: translateY(100%)  } to { transform: translateY(0) } }
@keyframes lcyt-slideInDown  { from { transform: translateY(-100%) } to { transform: translateY(0) } }
@keyframes lcyt-slideOutLeft  { from { transform: translateX(0) } to { transform: translateX(-100%) } }
@keyframes lcyt-slideOutRight { from { transform: translateX(0) } to { transform: translateX(100%)  } }
@keyframes lcyt-zoomIn  { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes lcyt-zoomOut { from { transform: scale(1); opacity: 1 } to { transform: scale(0); opacity: 0 } }
@keyframes lcyt-pulse   { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.05) } }
@keyframes lcyt-blink   { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
@keyframes lcyt-typewriter { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0% 0 0) } }
`;

if (typeof document !== 'undefined' && !document.getElementById('lcyt-anim-keyframes')) {
  const s = document.createElement('style');
  s.id = 'lcyt-anim-keyframes';
  s.textContent = LCYT_KEYFRAMES_CSS;
  document.head.appendChild(s);
}

const ANIM_PRESETS = [
  { value: '',                   label: 'None' },
  { value: 'lcyt-fadeIn',        label: 'Fade In' },
  { value: 'lcyt-fadeOut',       label: 'Fade Out' },
  { value: 'lcyt-slideInLeft',   label: 'Slide In ←' },
  { value: 'lcyt-slideInRight',  label: 'Slide In →' },
  { value: 'lcyt-slideInUp',     label: 'Slide In ↑' },
  { value: 'lcyt-slideInDown',   label: 'Slide In ↓' },
  { value: 'lcyt-slideOutLeft',  label: 'Slide Out ←' },
  { value: 'lcyt-slideOutRight', label: 'Slide Out →' },
  { value: 'lcyt-zoomIn',        label: 'Zoom In' },
  { value: 'lcyt-zoomOut',       label: 'Zoom Out' },
  { value: 'lcyt-pulse',         label: 'Pulse' },
  { value: 'lcyt-blink',         label: 'Blink' },
  { value: 'lcyt-typewriter',    label: 'Typewriter' },
];

const inputStyle = {
  background: '#1e1e1e', border: '1px solid #444', color: '#eee',
  borderRadius: 3, padding: '3px 6px', fontSize: 13,
  flex: 1, minWidth: 0, boxSizing: 'border-box',
};
const fieldRowStyle    = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle       = { color: '#999', fontSize: 12, width: 90, flexShrink: 0, textAlign: 'right' };

export default function AnimationEditor({ value, onChange }) {
  const p = parseAnimation(value);
  function upd(field, val) { onChange(buildAnimation({ ...p, [field]: val })); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Preset</span>
        <select value={p.preset} onChange={e => upd('preset', e.target.value)} style={inputStyle}>
          {ANIM_PRESETS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>
      {p.preset && (<>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Duration</span>
          <input type="number" min="0" step="0.1" value={p.duration}
                 onChange={e => upd('duration', e.target.value)}
                 style={{ ...inputStyle, width: 70 }} />
          <span style={{ color: '#666', fontSize: 12, flexShrink: 0 }}>s</span>
        </div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Delay</span>
          <input type="number" min="0" step="0.1" value={p.delay}
                 onChange={e => upd('delay', e.target.value)}
                 style={{ ...inputStyle, width: 70 }} />
          <span style={{ color: '#666', fontSize: 12, flexShrink: 0 }}>s</span>
        </div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Easing</span>
          <select value={p.easing} onChange={e => upd('easing', e.target.value)} style={inputStyle}>
            {['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out'].map(v =>
              <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Iterations</span>
          <select value={p.iterations} onChange={e => upd('iterations', e.target.value)} style={inputStyle}>
            {['1', '2', '3', '5', '10', 'infinite'].map(v =>
              <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Direction</span>
          <select value={p.direction} onChange={e => upd('direction', e.target.value)} style={inputStyle}>
            {['normal', 'reverse', 'alternate', 'alternate-reverse'].map(v =>
              <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Fill</span>
          <select value={p.fillMode} onChange={e => upd('fillMode', e.target.value)} style={inputStyle}>
            {['forwards', 'backwards', 'both', 'none'].map(v =>
              <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Raw CSS</span>
          <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
        </div>
      </>)}
    </div>
  );
}
