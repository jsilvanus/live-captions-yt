import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SessionContext } from '../contexts/SessionContext';

/**
 * DSK Graphics Template Editor
 *
 * URL: /dsk-editor?server=<backendUrl>&apikey=<key>
 *
 * Phase 1: template CRUD, layer property editor.
 * Phase 2: drag-to-move, 8-point resize handles, keyboard nudge.
 * Phase 3: undo/redo, multi-selection, snap to grid, snap to layer edges,
 *           ellipse shape type, shape grouping (group/ungroup).
 * Phase 4: Media Library — image upload, browse, insert, delete (PNG/JPEG/WebP/SVG).
 * Phase 5: Animations — preset picker, per-layer CSS animation shorthand, live preview.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const SCALE         = 0.5;   // preview is 50% of 1920×1080
const GRID_SIZE     = 20;    // template px; used by snap-to-grid
const SNAP_THRESH   = 10;    // template px; used by snap-to-layer-edges
const MAX_HISTORY   = 50;

// ── Resize handles ────────────────────────────────────────────────────────────

const HANDLE_LIST = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSORS = {
  nw: 'nw-resize', n: 'n-resize',  ne: 'ne-resize',
  e:  'e-resize',  se: 'se-resize', s:  's-resize',
  sw: 'sw-resize', w:  'w-resize',
};

function handleAnchor(handle, layer) {
  const x = Number(layer.x) || 0;
  const y = Number(layer.y) || 0;
  const w = Number(layer.width)  || 0;
  const h = Number(layer.height) || 0;
  return {
    left: handle.includes('e') ? x + w : handle.includes('w') ? x : x + w / 2,
    top:  handle.includes('s') ? y + h : handle.includes('n') ? y : y + h / 2,
  };
}

function applyResize(handle, startRect, dx, dy) {
  let { x, y, width, height } = startRect;
  if (handle.includes('e')) width  = width  + dx;
  if (handle.includes('w')) { x += dx; width  = width  - dx; }
  if (handle.includes('s')) height = height + dy;
  if (handle.includes('n')) { y += dy; height = height - dy; }
  return {
    x:      Math.round(x),
    y:      Math.round(y),
    width:  Math.max(4, Math.round(width)),
    height: Math.max(4, Math.round(height)),
  };
}

// ── Snap helpers ──────────────────────────────────────────────────────────────

function gridSnap(v) {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

/**
 * Snap the primary layer's tentative (x, y) to edges of non-moving layers.
 * Returns { x, y } adjusted by the best snap offset (≤ SNAP_THRESH) on each axis.
 */
function snapToLayerEdges(tentX, tentY, primaryLayer, allLayers, movingIds) {
  const w = Number(primaryLayer?.width)  || 0;
  const h = Number(primaryLayer?.height) || 0;
  if (!w || !h) return { x: tentX, y: tentY };

  const others = allLayers.filter(l =>
    !movingIds.has(l.id) && l.width != null && l.height != null,
  );

  // Moving layer edges
  const me = {
    l: tentX,     r: tentX + w,   cx: tentX + w / 2,
    t: tentY,     b: tentY + h,   cy: tentY + h / 2,
  };

  let bestXd = SNAP_THRESH, bestYd = SNAP_THRESH, snapDx = 0, snapDy = 0;

  for (const o of others) {
    const ox = o.x || 0, oy = o.y || 0, ow = o.width || 0, oh = o.height || 0;
    const oe = {
      l: ox,      r: ox + ow,    cx: ox + ow / 2,
      t: oy,      b: oy + oh,    cy: oy + oh / 2,
    };
    for (const mk of ['l', 'r', 'cx']) {
      for (const ok of ['l', 'r', 'cx']) {
        const d = Math.abs(me[mk] - oe[ok]);
        if (d < bestXd) { bestXd = d; snapDx = oe[ok] - me[mk]; }
      }
    }
    for (const mk of ['t', 'b', 'cy']) {
      for (const ok of ['t', 'b', 'cy']) {
        const d = Math.abs(me[mk] - oe[ok]);
        if (d < bestYd) { bestYd = d; snapDy = oe[ok] - me[mk]; }
      }
    }
  }
  return { x: tentX + snapDx, y: tentY + snapDy };
}

// ── Preset templates ──────────────────────────────────────────────────────────

const PRESETS = {
  'Lower Third': {
    background: 'transparent',
    width: 1920,
    height: 1080,
    groups: [{ id: 'lt', name: 'Lower Third' }],
    layers: [
      { id: 'bg',    type: 'rect', x: 0,  y: 790, width: 1920, height: 290, groupId: 'lt',
        style: { background: '#1a1a2e', opacity: '0.92', 'border-radius': '0' } },
      { id: 'name',  type: 'text', x: 80, y: 840, width: 1760, groupId: 'lt',
        text: 'Speaker Name',
        style: { 'font-size': '56px', 'font-family': 'Arial, sans-serif', color: '#ffffff', 'font-weight': 'bold', 'white-space': 'nowrap' } },
      { id: 'title', type: 'text', x: 80, y: 930, width: 1760, groupId: 'lt',
        text: 'Title / Organisation',
        style: { 'font-size': '38px', 'font-family': 'Arial, sans-serif', color: '#cccccc', 'white-space': 'nowrap' } },
    ],
  },
  'Corner Bug': {
    background: 'transparent',
    width: 1920,
    height: 1080,
    groups: [{ id: 'bug', name: 'Corner Bug' }],
    layers: [
      { id: 'bug-bg',   type: 'rect', x: 40, y: 40, width: 320, height: 100, groupId: 'bug',
        style: { background: '#000000', opacity: '0.75', 'border-radius': '8px' } },
      { id: 'bug-text', type: 'text', x: 60, y: 62, groupId: 'bug',
        text: 'LIVE',
        style: { 'font-size': '48px', 'font-family': 'Arial, sans-serif', color: '#ff3300', 'font-weight': 'bold', 'letter-spacing': '4px' } },
    ],
  },
  'Full-screen Title': {
    background: '#000000',
    width: 1920,
    height: 1080,
    layers: [
      { id: 'title',    type: 'text', x: 0, y: 420, width: 1920,
        text: 'Event Title',
        style: { 'font-size': '96px', 'font-family': 'Arial, sans-serif', color: '#ffffff', 'font-weight': 'bold', 'text-align': 'center' } },
      { id: 'subtitle', type: 'text', x: 0, y: 560, width: 1920,
        text: 'Subtitle or Date',
        style: { 'font-size': '52px', 'font-family': 'Arial, sans-serif', color: '#aaaaaa', 'text-align': 'center' } },
    ],
  },
};

const EMPTY_TEMPLATE = {
  background: 'transparent',
  width: 1920,
  height: 1080,
  groups: [],
  layers: [],
};

// ── Render a single layer element ─────────────────────────────────────────────

function renderLayerElement(layer, isSelected, isInSelection, onPointerDown) {
  if (layer.visible === false) return null;
  const base = {
    position: 'absolute',
    left:  Number(layer.x) || 0,
    top:   Number(layer.y) || 0,
    ...(layer.width  != null ? { width:  Number(layer.width)  } : {}),
    ...(layer.height != null ? { height: Number(layer.height) } : {}),
    ...(layer.animation ? { animation: layer.animation } : {}),
    outline: isSelected   ? '3px solid #4af'
           : isInSelection ? '2px dashed #48c'
           : undefined,
    cursor: 'move',
    boxSizing: 'border-box',
    userSelect: 'none',
  };

  const styleProps = {};
  if (layer.style) {
    for (const [k, v] of Object.entries(layer.style)) {
      styleProps[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
  }
  const merged = { ...base, ...styleProps };

  if (layer.type === 'text') {
    return (
      <div key={layer.id} style={merged} onPointerDown={onPointerDown}>
        {layer.binding
          ? <span style={{ opacity: 0.55, fontStyle: 'italic' }}>⟳{layer.binding}</span>
          : (layer.text || '')}
      </div>
    );
  }
  if (layer.type === 'rect') {
    return <div key={layer.id} style={merged} onPointerDown={onPointerDown} />;
  }
  if (layer.type === 'ellipse') {
    return <div key={layer.id} style={{ ...merged, borderRadius: '50%' }} onPointerDown={onPointerDown} />;
  }
  if (layer.type === 'image') {
    return (
      <img key={layer.id} src={layer.src || ''} alt=""
           draggable={false} style={merged} onPointerDown={onPointerDown} />
    );
  }
  return null;
}

// ── Preview ───────────────────────────────────────────────────────────────────

/**
 * Phase 3 TemplatePreview.
 *
 * Props:
 *   template        full template JSON
 *   selectedIds     Set<string> — all highlighted layer IDs
 *   primaryId       string | null — single "active" layer (for keyboard nudge)
 *   onSelect        (layerId, additive) => void — null layerId = deselect all
 *   onDragStart     () => void — push undo history before first movement
 *   onMoveSelected  (updates: {id, x, y}[]) => void
 *   onResizeLayer   (id, {x, y, width, height}) => void
 *   snapGrid        boolean
 */
function TemplatePreview({
  template, selectedIds, primaryId,
  onSelect, onDragStart, onMoveSelected, onResizeLayer, snapGrid, showSafeArea,
}) {
  const t = template || EMPTY_TEMPLATE;
  const layers = Array.isArray(t.layers) ? t.layers : [];

  const containerRef = useRef(null);
  const dragRef = useRef(null);
  // dragRef.current shape:
  //   { type:'move',   layerId, shiftKey, startPointer, startPositions:Map, dragIds:Set, hasMoved, historyPushed }
  //   { type:'resize', layerId, handle,   startPointer, startRect, hasMoved, historyPushed }
  //   { type:'background' }

  // ── Drag start ────────────────────────────────────────────────────────────

  function startLayerDrag(e, layerId) {
    e.stopPropagation();
    const layer = layers.find(l => l.id === layerId);

    // Which layers will move together?
    let dragIds;
    if (selectedIds.has(layerId)) {
      dragIds = new Set(selectedIds);
    } else if (layer?.groupId) {
      dragIds = new Set(layers.filter(l => l.groupId === layer.groupId).map(l => l.id));
    } else {
      dragIds = new Set([layerId]);
    }

    const startPositions = new Map(
      [...dragIds].map(id => {
        const l = layers.find(ll => ll.id === id);
        return [id, { x: Number(l?.x) || 0, y: Number(l?.y) || 0 }];
      }),
    );

    dragRef.current = {
      type: 'move', layerId, shiftKey: e.shiftKey,
      startPointer: { x: e.clientX, y: e.clientY },
      startPositions, dragIds,
      hasMoved: false, historyPushed: false,
    };
    containerRef.current?.setPointerCapture(e.pointerId);
  }

  function startHandleDrag(e, layerId, handle) {
    e.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    dragRef.current = {
      type: 'resize', layerId, handle,
      startPointer: { x: e.clientX, y: e.clientY },
      startRect: {
        x: Number(layer.x) || 0, y: Number(layer.y) || 0,
        width: Number(layer.width) || 0, height: Number(layer.height) || 0,
      },
      hasMoved: false, historyPushed: false,
    };
    containerRef.current?.setPointerCapture(e.pointerId);
  }

  // ── Container pointer events ──────────────────────────────────────────────

  function onContainerPointerDown(e) {
    dragRef.current = { type: 'background' };
  }

  function onContainerPointerMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.type === 'background') return;

    const rawDx = (e.clientX - drag.startPointer.x) / SCALE;
    const rawDy = (e.clientY - drag.startPointer.y) / SCALE;

    if (!drag.hasMoved && (Math.abs(e.clientX - drag.startPointer.x) > 3 ||
                           Math.abs(e.clientY - drag.startPointer.y) > 3)) {
      drag.hasMoved = true;
    }
    if (!drag.hasMoved) return;

    // Push undo history on first actual movement
    if (!drag.historyPushed) {
      drag.historyPushed = true;
      onDragStart();
    }

    if (drag.type === 'move') {
      const primaryLayer = layers.find(l => l.id === drag.layerId);
      const primaryStart = drag.startPositions.get(drag.layerId);

      // Tentative position for primary layer
      let tentX = primaryStart.x + rawDx;
      let tentY = primaryStart.y + rawDy;

      // Grid snap (applied to primary, same delta to all)
      if (snapGrid) {
        tentX = gridSnap(tentX);
        tentY = gridSnap(tentY);
      }

      // Layer edge snap (applied to primary)
      if (primaryLayer?.width && primaryLayer?.height) {
        const snapped = snapToLayerEdges(tentX, tentY, primaryLayer, layers, drag.dragIds);
        tentX = snapped.x;
        tentY = snapped.y;
      }

      const snappedDx = tentX - primaryStart.x;
      const snappedDy = tentY - primaryStart.y;

      const updates = [...drag.startPositions.entries()].map(([id, sp]) => ({
        id,
        x: Math.round(sp.x + snappedDx),
        y: Math.round(sp.y + snappedDy),
      }));
      onMoveSelected(updates);

    } else if (drag.type === 'resize') {
      onResizeLayer(drag.layerId, applyResize(drag.handle, drag.startRect, rawDx, rawDy));
    }
  }

  function onContainerPointerUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.type === 'background') {
      onSelect(null, false);
    } else if (!drag.hasMoved) {
      onSelect(drag.layerId, drag.shiftKey);
    }
  }

  // ── Keyboard nudge ────────────────────────────────────────────────────────

  function onContainerKeyDown(e) {
    if (!primaryId) return;
    const layer = layers.find(l => l.id === primaryId);
    if (!layer) return;
    const step = e.shiftKey ? 10 : 1;
    const x = Number(layer.x) || 0;
    const y = Number(layer.y) || 0;
    if (e.key === 'ArrowLeft')  { onMoveSelected([{ id: primaryId, x: x - step, y }]); e.preventDefault(); }
    if (e.key === 'ArrowRight') { onMoveSelected([{ id: primaryId, x: x + step, y }]); e.preventDefault(); }
    if (e.key === 'ArrowUp')    { onMoveSelected([{ id: primaryId, x, y: y - step }]); e.preventDefault(); }
    if (e.key === 'ArrowDown')  { onMoveSelected([{ id: primaryId, x, y: y + step }]); e.preventDefault(); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        width: 960, height: 540, position: 'relative', overflow: 'hidden',
        flexShrink: 0, border: '2px solid #444', borderRadius: 4,
        cursor: 'default', outline: 'none', touchAction: 'none',
      }}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onKeyDown={onContainerKeyDown}
    >
      <div style={{
        width: 1920, height: 1080, position: 'absolute', top: 0, left: 0,
        transform: 'scale(0.5)', transformOrigin: 'top left',
        background: t.background || 'transparent',
        backgroundImage: t.background === 'transparent' || !t.background
          ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 0 0 / 40px 40px'
          : undefined,
      }}>
        {layers.flatMap((layer) => {
          const isSelected    = layer.id === primaryId && selectedIds.size === 1;
          const isInSelection = selectedIds.has(layer.id);

          const el = renderLayerElement(
            layer, isSelected, isInSelection && !isSelected,
            e => startLayerDrag(e, layer.id),
          );
          if (!el) return [];

          if (!isSelected) return [el];

          // Add 8 resize handles for the single-selected (primary) layer
          const handles = HANDLE_LIST.map(handle => {
            const { left, top } = handleAnchor(handle, layer);
            return (
              <div key={`${layer.id}-${handle}`} style={{
                position: 'absolute', left, top,
                width: 16, height: 16,
                background: '#4af', border: '2px solid #fff', borderRadius: 2,
                cursor: HANDLE_CURSORS[handle], zIndex: 9999,
                transform: 'translate(-50%, -50%)', boxSizing: 'border-box',
                touchAction: 'none',
              }}
              onPointerDown={e => startHandleDrag(e, layer.id, handle)}
              />
            );
          });
          return [el, ...handles];
        })}
      </div>
      {/* Safe area guides — rendered at display (960×540) coords, outside the scaled inner div */}
      {showSafeArea && (<>
        <div style={{ position:'absolute', left:'5%', top:'5%', right:'5%', bottom:'5%',
                      border:'1px dashed rgba(255,255,0,0.6)', pointerEvents:'none', zIndex:10000,
                      boxSizing:'border-box' }} title="90% title-safe" />
        <div style={{ position:'absolute', left:'10%', top:'10%', right:'10%', bottom:'10%',
                      border:'1px dashed rgba(255,140,0,0.5)', pointerEvents:'none', zIndex:10000,
                      boxSizing:'border-box' }} title="80% action-safe" />
      </>)}
    </div>
  );
}

// ── Animation support ─────────────────────────────────────────────────────────

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

// CSS animation shorthand: name duration timing-function delay iteration-count direction fill-mode
function parseAnimation(anim) {
  if (!anim || !anim.trim()) {
    return { preset: '', duration: '1', easing: 'ease', delay: '0', iterations: '1', direction: 'normal', fillMode: 'forwards' };
  }
  const parts = anim.trim().split(/\s+/);
  return {
    preset:     parts[0] || '',
    duration:   (parts[1] || '1s').replace(/s$/, ''),
    easing:     parts[2] || 'ease',
    delay:      (parts[3] || '0s').replace(/s$/, ''),
    iterations: parts[4] || '1',
    direction:  parts[5] || 'normal',
    fillMode:   parts[6] || 'forwards',
  };
}

function buildAnimation({ preset, duration, easing, delay, iterations, direction, fillMode }) {
  if (!preset) return '';
  return `${preset} ${duration}s ${easing} ${delay}s ${iterations} ${direction} ${fillMode}`;
}

function AnimationEditor({ value, onChange }) {
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

// ── Layer property editor ─────────────────────────────────────────────────────

const COMMON_FIELDS = [
  { key: 'x', label: 'X', type: 'number' },
  { key: 'y', label: 'Y', type: 'number' },
  { key: 'width',  label: 'Width',  type: 'number' },
  { key: 'height', label: 'Height', type: 'number' },
];

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

// Shared for all layer types
const STYLE_FIELDS_BORDER = [
  { key: 'border',     label: 'Border',  type: 'text', placeholder: '2px solid #fff' },
  { key: 'box-shadow', label: 'Shadow',  type: 'text', placeholder: '0 2px 8px rgba(0,0,0,0.5)' },
];

function ColorTextInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input type="color"
        value={value && value.startsWith('#') ? value.slice(0, 7) : '#000000'}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: 'none', cursor: 'pointer', flexShrink: 0 }}
      />
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

function LayerPropertyEditor({ layer, selectionCount, aspectLock, onAspectLock, onChange }) {
  if (selectionCount > 1 && !layer) {
    return <div style={{ color: '#888', fontSize: 13, padding: '16px 0' }}>{selectionCount} layers selected.</div>;
  }
  if (!layer) {
    return <div style={{ color: '#888', fontSize: 13, padding: '16px 0' }}>Select a layer to edit its properties.</div>;
  }

  function setField(key, value) {
    const numericKeys = ['x', 'y', 'width', 'height'];
    onChange({ ...layer, [key]: value === '' ? undefined : (numericKeys.includes(key) ? Number(value) : value) });
  }
  function setStyle(cssKey, value) {
    const style = { ...(layer.style || {}) };
    if (value === '' || value === undefined) delete style[cssKey]; else style[cssKey] = value;
    onChange({ ...layer, style });
  }

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
      {COMMON_FIELDS.map(f => (
        <div key={f.key} style={fieldRowStyle}>
          <span style={labelStyle}>{f.label}</span>
          <input type="number" value={layer[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)}
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

      {/* Global opacity for all types */}
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

// ── Styles ────────────────────────────────────────────────────────────────────

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
const btnPrimaryStyle = { ...btnStyle, background: '#2255aa', border: '1px solid #4488dd', color: '#fff' };
const btnDangerStyle  = { ...btnStyle, background: '#550000', border: '1px solid #882222', color: '#ffaaaa' };
const btnActiveStyle  = { ...btnStyle, background: '#1a3a1a', border: '1px solid #44aa44', color: '#88ee88' };

// ── Counters ──────────────────────────────────────────────────────────────────

let _layerCounter = 0, _groupCounter = 0;
function newLayerId(type) { _layerCounter += 1; return `${type}-${_layerCounter}`; }
function newGroupId()     { _groupCounter += 1; return `grp-${_groupCounter}`; }

// ── Main component ────────────────────────────────────────────────────────────

export function DskEditorPage() {
  const session   = useContext(SessionContext);
  const params    = new URLSearchParams(window.location.search);
  const apiKey    = params.get('apikey') || session?.apiKey || '';
  const serverUrl = (params.get('server') || session?.backendUrl || '').replace(/\/$/, '');

  const [templates, setTemplates]     = useState([]);
  const [selectedId, setSelectedId]   = useState(null);   // backend template id
  const [templateName, setTemplateName] = useState('');
  const [template, setTemplate]       = useState(EMPTY_TEMPLATE);
  const [selectedIds, setSelectedIds] = useState(new Set()); // canvas multi-selection
  const [primaryId, setPrimaryId]     = useState(null);    // property-panel target
  const [snapGrid, setSnapGrid]       = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [aspectLock, setAspectLock]   = useState(true);
  const [status, setStatus]           = useState('');
  const [loading, setLoading]         = useState(false);

  // Media Library state
  const [images, setImages]               = useState([]);
  const [imgPending, setImgPending]       = useState(null);   // File awaiting shorthand
  const [shorthandInput, setShorthandInput] = useState('');
  const [imgLibOpen, setImgLibOpen]       = useState(true);
  const [imgUploading, setImgUploading]   = useState(false);
  const [imgUploadErr, setImgUploadErr]   = useState('');

  const isDirty      = useRef(false);
  const imgInputRef  = useRef(null);
  const clipboardRef = useRef(null);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  const historyRef = useRef({ past: [], future: [] });
  const templateRef = useRef(template); // mirror for use inside event listeners
  useEffect(() => { templateRef.current = template; }, [template]);

  // ── Undo / redo ─────────────────────────────────────────────────────────

  function pushHistory(tmpl) {
    historyRef.current.past.push(JSON.stringify(tmpl));
    historyRef.current.future = [];
    if (historyRef.current.past.length > MAX_HISTORY) historyRef.current.past.shift();
  }

  // Global keyboard handler — attached once so it always has the latest template
  useEffect(() => {
    function onGlobalKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { past, future } = historyRef.current;
        if (!past.length) return;
        future.push(JSON.stringify(templateRef.current));
        setTemplate(JSON.parse(past.pop()));
        isDirty.current = true;
      }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        const { past, future } = historyRef.current;
        if (!future.length) return;
        past.push(JSON.stringify(templateRef.current));
        setTemplate(JSON.parse(future.pop()));
        isDirty.current = true;
      }
      if (e.key === 'c') {
        const ids = selectedIdsRef.current;
        if (!ids.size) return;
        clipboardRef.current = templateRef.current.layers
          .filter(l => ids.has(l.id))
          .map(l => JSON.parse(JSON.stringify(l)));
      }
      if (e.key === 'v') {
        e.preventDefault();
        if (!clipboardRef.current?.length) return;
        const tmpl = templateRef.current;
        const pasted = clipboardRef.current.map(l => ({
          ...l, id: newLayerId(l.type), x: (l.x || 0) + 20, y: (l.y || 0) + 20,
        }));
        historyRef.current.past.push(JSON.stringify(tmpl));
        historyRef.current.future = [];
        setTemplate(t => ({ ...t, layers: [...t.layers, ...pasted] }));
        setSelectedIds(new Set(pasted.map(l => l.id)));
        setPrimaryId(pasted[pasted.length - 1].id);
        isDirty.current = true;
      }
    }
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  function undo() {
    const { past, future } = historyRef.current;
    if (!past.length) return;
    future.push(JSON.stringify(templateRef.current));
    setTemplate(JSON.parse(past.pop()));
    isDirty.current = true;
  }
  function redo() {
    const { past, future } = historyRef.current;
    if (!future.length) return;
    past.push(JSON.stringify(templateRef.current));
    setTemplate(JSON.parse(future.pop()));
    isDirty.current = true;
  }

  // ── API ──────────────────────────────────────────────────────────────────

  function apiFetch(path, opts = {}) {
    return fetch(`${serverUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, ...(opts.headers || {}) },
    });
  }

  const fetchTemplates = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`);
      if (!res.ok) throw new Error(await res.text());
      setTemplates((await res.json()).templates || []);
    } catch (err) { setStatus(`Error loading templates: ${err.message}`); }
  }, [serverUrl, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const loadImages = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/images`);
      const data = await res.json();
      setImages(data.images || []);
    } catch {}
  }, [serverUrl, apiKey]);

  useEffect(() => { loadImages(); }, [loadImages]);

  // ── Template lifecycle ───────────────────────────────────────────────────

  async function loadTemplate(id) {
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const { template: row } = await res.json();
      setSelectedId(row.id);
      setTemplateName(row.name);
      setTemplate(row.templateJson || EMPTY_TEMPLATE);
      clearSelection();
      historyRef.current = { past: [], future: [] };
      isDirty.current = false;
      setStatus('');
    } catch (err) { setStatus(`Error loading template: ${err.message}`); }
  }

  function newFromPreset(presetName) {
    setSelectedId(null);
    setTemplateName(presetName);
    setTemplate(JSON.parse(JSON.stringify(PRESETS[presetName])));
    clearSelection();
    historyRef.current = { past: [], future: [] };
    isDirty.current = true;
    setStatus('');
  }

  function newBlank() {
    setSelectedId(null);
    setTemplateName('New Template');
    setTemplate(JSON.parse(JSON.stringify(EMPTY_TEMPLATE)));
    clearSelection();
    historyRef.current = { past: [], future: [] };
    isDirty.current = true;
    setStatus('');
  }

  async function saveTemplate() {
    if (!templateName.trim()) { setStatus('Template name is required'); return; }
    setLoading(true); setStatus('Saving…');
    try {
      let res;
      if (selectedId) {
        res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${selectedId}`, {
          method: 'PUT', body: JSON.stringify({ name: templateName.trim(), template }),
        });
      } else {
        res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`, {
          method: 'POST', body: JSON.stringify({ name: templateName.trim(), template }),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!selectedId) setSelectedId(data.id);
      isDirty.current = false; setStatus('Saved.');
      await fetchTemplates();
    } catch (err) { setStatus(`Save error: ${err.message}`);
    } finally { setLoading(false); }
  }

  async function deleteTemplateById(id, name) {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      if (selectedId === id) { setSelectedId(null); setTemplateName(''); setTemplate(EMPTY_TEMPLATE); clearSelection(); }
      await fetchTemplates(); setStatus('Deleted.');
    } catch (err) { setStatus(`Delete error: ${err.message}`); }
  }

  // ── Selection ────────────────────────────────────────────────────────────

  function clearSelection() {
    setSelectedIds(new Set());
    setPrimaryId(null);
  }

  /** Called by TemplatePreview on click. id=null = deselect all. */
  function handleCanvasSelect(id, additive) {
    if (!id) { clearSelection(); return; }
    const layer = template.layers.find(l => l.id === id);
    const groupMemberIds = layer?.groupId
      ? template.layers.filter(l => l.groupId === layer.groupId).map(l => l.id)
      : [id];

    if (additive) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        const allIn = groupMemberIds.every(mid => next.has(mid));
        if (allIn) groupMemberIds.forEach(mid => next.delete(mid));
        else       groupMemberIds.forEach(mid => next.add(mid));
        return next;
      });
    } else {
      setSelectedIds(new Set(groupMemberIds));
    }
    setPrimaryId(id);
  }

  function selectLayerFromList(id) {
    const layer = template.layers.find(l => l.id === id);
    const groupMemberIds = layer?.groupId
      ? template.layers.filter(l => l.groupId === layer.groupId).map(l => l.id)
      : [id];
    setSelectedIds(new Set(groupMemberIds));
    setPrimaryId(id);
  }

  // ── Layer mutations ──────────────────────────────────────────────────────

  function addLayer(type) {
    pushHistory(template);
    const id = newLayerId(type);
    const defaults = {
      rect:    { id, type: 'rect',    x: 100, y: 100, width: 400, height: 100, style: { background: '#333333', opacity: '0.9' } },
      ellipse: { id, type: 'ellipse', x: 200, y: 200, width: 200, height: 200, style: { background: '#336699' } },
      text:    { id, type: 'text',    x: 100, y: 100, text: 'Text', style: { 'font-size': '48px', 'font-family': 'Arial, sans-serif', color: '#ffffff' } },
      image:   { id, type: 'image',   x: 0,   y: 0,   width: 400, height: 300, src: '' },
    };
    const newLayer = defaults[type] || defaults.rect;
    setTemplate(t => ({ ...t, layers: [...(t.layers || []), newLayer] }));
    setSelectedIds(new Set([id]));
    setPrimaryId(id);
    isDirty.current = true;
  }

  function updateLayer(updated) {
    pushHistory(template);
    setTemplate(t => ({ ...t, layers: t.layers.map(l => l.id === updated.id ? updated : l) }));
    isDirty.current = true;
  }

  function deleteLayer(id) {
    pushHistory(template);
    setTemplate(t => ({ ...t, layers: t.layers.filter(l => l.id !== id) }));
    if (primaryId === id) clearSelection();
    isDirty.current = true;
  }

  function reorderLayer(id, dir) {
    pushHistory(template);
    setTemplate(t => {
      const layers = [...t.layers];
      const idx = layers.findIndex(l => l.id === id);
      if (idx < 0) return t;
      const target = idx + dir;
      if (target < 0 || target >= layers.length) return t;
      [layers[idx], layers[target]] = [layers[target], layers[idx]];
      return { ...t, layers };
    });
    isDirty.current = true;
  }

  function toggleLayerVisibility(id) {
    const layer = template.layers.find(l => l.id === id);
    if (!layer) return;
    updateLayer({ ...layer, visible: layer.visible === false ? undefined : false });
  }

  function duplicateLayer(id) {
    pushHistory(template);
    const src = template.layers.find(l => l.id === id);
    if (!src) return;
    const newId = newLayerId(src.type);
    const copy = { ...JSON.parse(JSON.stringify(src)), id: newId, x: (src.x || 0) + 20, y: (src.y || 0) + 20 };
    setTemplate(t => ({ ...t, layers: [...t.layers, copy] }));
    setSelectedIds(new Set([newId]));
    setPrimaryId(newId);
    isDirty.current = true;
  }

  function alignLayers(axis, anchor) {
    if (selectedIds.size < 1) return;
    pushHistory(template);
    const sel = template.layers.filter(l => selectedIds.has(l.id));
    const minX = Math.min(...sel.map(l => l.x || 0));
    const maxX = Math.max(...sel.map(l => (l.x || 0) + (l.width || 0)));
    const minY = Math.min(...sel.map(l => l.y || 0));
    const maxY = Math.max(...sel.map(l => (l.y || 0) + (l.height || 0)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => {
        if (!selectedIds.has(l.id)) return l;
        const w = l.width || 0, h = l.height || 0;
        if (axis === 'x') {
          const nx = anchor === 'min' ? minX : anchor === 'center' ? cx - w / 2 : maxX - w;
          return { ...l, x: Math.round(nx) };
        } else {
          const ny = anchor === 'min' ? minY : anchor === 'center' ? cy - h / 2 : maxY - h;
          return { ...l, y: Math.round(ny) };
        }
      }),
    }));
    isDirty.current = true;
  }

  // ── Phase 2 direct-manipulation callbacks ────────────────────────────────

  /** Called by TemplatePreview when a drag begins (push undo before first move). */
  function handleDragStart() {
    pushHistory(template);
  }

  /** Called continuously during drag with updated positions for all moving layers. */
  function handleMoveSelected(updates) {
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => {
        const upd = updates.find(u => u.id === l.id);
        return upd ? { ...l, x: upd.x, y: upd.y } : l;
      }),
    }));
    isDirty.current = true;
  }

  function handleResizeLayer(id, rect) {
    let final = rect;
    if (aspectLock && primaryLayer?.type === 'image' && primaryLayer.id === id) {
      const orig = primaryLayer;
      const ratio = (orig.width || 1) / (orig.height || 1);
      if (rect.width !== (orig.width || 0)) {
        final = { ...rect, height: Math.max(4, Math.round(rect.width / ratio)) };
      } else {
        final = { ...rect, width: Math.max(4, Math.round(rect.height * ratio)) };
      }
    }
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => l.id === id ? { ...l, ...final } : l),
    }));
    isDirty.current = true;
  }

  // ── Phase 3 group management ─────────────────────────────────────────────

  /** Group all currently selected layers into a new named group. */
  function groupSelected() {
    if (selectedIds.size < 2) return;
    // Don't group if they already all belong to the same group
    const existingGroupIds = new Set(
      template.layers.filter(l => selectedIds.has(l.id) && l.groupId).map(l => l.groupId),
    );
    if (existingGroupIds.size === 1 &&
        template.layers.filter(l => l.groupId === [...existingGroupIds][0]).every(l => selectedIds.has(l.id))) {
      return; // already one coherent group
    }
    pushHistory(template);
    const gid  = newGroupId();
    const name = `Group ${_groupCounter}`;
    setTemplate(t => ({
      ...t,
      groups: [...(t.groups || []), { id: gid, name }],
      layers: t.layers.map(l => selectedIds.has(l.id) ? { ...l, groupId: gid } : l),
    }));
    isDirty.current = true;
  }

  /** Remove group membership from all selected layers. */
  function ungroupSelected() {
    const groupIds = new Set(
      template.layers.filter(l => selectedIds.has(l.id) && l.groupId).map(l => l.groupId),
    );
    if (!groupIds.size) return;
    pushHistory(template);
    setTemplate(t => ({
      ...t,
      groups: (t.groups || []).filter(g => !groupIds.has(g.id)),
      layers: t.layers.map(l => {
        if (!groupIds.has(l.groupId)) return l;
        const { groupId: _gid, ...rest } = l;
        return rest;
      }),
    }));
    clearSelection();
    isDirty.current = true;
  }

  // ── Media Library ────────────────────────────────────────────────────────

  async function uploadImage(file, shorthand) {
    setImgUploading(true); setImgUploadErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('shorthand', shorthand);
      const res = await fetch(`${serverUrl}/images`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
        body: fd,
      });
      if (!res.ok) { const txt = await res.text(); throw new Error(txt); }
      setImgPending(null); setShorthandInput('');
      await loadImages();
    } catch (err) { setImgUploadErr(err.message); }
    finally { setImgUploading(false); }
  }

  async function deleteImageById(id) {
    try {
      await fetch(`${serverUrl}/images/${id}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey },
      });
      await loadImages();
    } catch {}
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    setShorthandInput(base || 'image');
    setImgPending(file);
    e.target.value = '';
  }

  function useImageFromLibrary(img) {
    const url = `${serverUrl}/images/${img.id}`;
    if (primaryLayer?.type === 'image') {
      updateLayer({ ...primaryLayer, src: url });
    } else {
      pushHistory(template);
      const id = newLayerId('image');
      const newLayer = { id, type: 'image', x: 0, y: 0, width: 400, height: 300, src: url };
      setTemplate(t => ({ ...t, layers: [...(t.layers || []), newLayer] }));
      setSelectedIds(new Set([id]));
      setPrimaryId(id);
      isDirty.current = true;
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const primaryLayer    = template.layers?.find(l => l.id === primaryId) || null;
  const canGroup        = selectedIds.size >= 2;
  const canUngroup      = [...selectedIds].some(id => template.layers.find(l => l.id === id)?.groupId);

  // Group name lookup
  const groupNameById = Object.fromEntries((template.groups || []).map(g => [g.id, g.name]));

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (!serverUrl || !apiKey) {
    return (
      <div style={{ padding: 32, color: 'var(--color-text-muted, #888)', fontFamily: 'sans-serif', fontSize: 16 }}>
        {session
          ? 'Connect to a backend first (click Connect in the top bar).'
          : 'Missing ?server= and ?apikey= URL parameters.'}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#111', color: '#ddd', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* ── Left: template list ── */}
      <div style={{ width: 220, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', fontWeight: 'bold', fontSize: 14, color: '#bbb' }}>Templates</div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>New from preset</div>
          {Object.keys(PRESETS).map(name => (
            <button key={name} onClick={() => newFromPreset(name)} style={{ ...btnStyle, textAlign: 'left', fontSize: 12 }}>{name}</button>
          ))}
          <button onClick={newBlank} style={{ ...btnStyle, textAlign: 'left', fontSize: 12 }}>Blank</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {templates.length === 0 && <div style={{ padding: 12, color: '#555', fontSize: 13 }}>No templates yet.</div>}
          {templates.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', padding: '8px 10px', cursor: 'pointer',
              background: t.id === selectedId ? '#1e3a5f' : 'transparent', borderBottom: '1px solid #222',
            }} onClick={() => loadTemplate(t.id)}>
              <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <button onClick={e => { e.stopPropagation(); deleteTemplateById(t.id, t.name); }}
                      title="Delete" style={{ ...btnDangerStyle, padding: '2px 6px', fontSize: 11, marginLeft: 4 }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <input type="text" value={templateName}
            onChange={e => { setTemplateName(e.target.value); isDirty.current = true; }}
            placeholder="Template name" style={{ ...inputStyle, width: 200 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#888' }}>BG:</span>
            <input type="color"
              value={template.background && template.background !== 'transparent' ? template.background.slice(0, 7) : '#000000'}
              onChange={e => { setTemplate(t => ({ ...t, background: e.target.value })); isDirty.current = true; }}
              style={{ width: 28, height: 22, padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="text" value={template.background || 'transparent'}
              onChange={e => { setTemplate(t => ({ ...t, background: e.target.value })); isDirty.current = true; }}
              style={{ ...inputStyle, width: 110 }} />
          </div>

          {/* Undo / Redo */}
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={{ ...btnStyle, opacity: canUndo ? 1 : 0.4 }}>↩</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" style={{ ...btnStyle, opacity: canRedo ? 1 : 0.4 }}>↪</button>

          {/* Snap to grid */}
          <button onClick={() => setSnapGrid(v => !v)} title="Snap to grid"
                  style={snapGrid ? btnActiveStyle : btnStyle}>
            ⊞ {snapGrid ? 'Grid on' : 'Grid'}
          </button>

          {/* Safe area guides */}
          <button onClick={() => setShowSafeArea(v => !v)} title="Safe area guides"
                  style={showSafeArea ? btnActiveStyle : btnStyle}>
            ⬜ Safe
          </button>

          <span style={{ flex: 1 }} />
          {status && <span style={{ fontSize: 12, color: status.startsWith('Error') || status.startsWith('Save error') ? '#f88' : '#8d8' }}>{status}</span>}
          <button onClick={saveTemplate} disabled={loading} style={btnPrimaryStyle}>{loading ? 'Saving…' : 'Save'}</button>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Preview + layer list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, overflow: 'auto' }}>

            <TemplatePreview
              template={template}
              selectedIds={selectedIds}
              primaryId={primaryId}
              onSelect={handleCanvasSelect}
              onDragStart={handleDragStart}
              onMoveSelected={handleMoveSelected}
              onResizeLayer={handleResizeLayer}
              snapGrid={snapGrid}
              showSafeArea={showSafeArea}
            />

            {/* Layer list header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold' }}>Layers</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => addLayer('ellipse')} style={{ ...btnStyle, fontSize: 12 }}>+ Ellipse</button>
              <button onClick={() => addLayer('rect')}    style={{ ...btnStyle, fontSize: 12 }}>+ Rect</button>
              <button onClick={() => addLayer('text')}    style={{ ...btnStyle, fontSize: 12 }}>+ Text</button>
              <button onClick={() => addLayer('image')}   style={{ ...btnStyle, fontSize: 12 }}>+ Image</button>
              {canGroup   && <button onClick={groupSelected}   title="Group selected layers" style={{ ...btnStyle, fontSize: 12 }}>Group</button>}
              {canUngroup && <button onClick={ungroupSelected} title="Remove from group"     style={{ ...btnDangerStyle, fontSize: 12 }}>Ungroup</button>}
            </div>
            {/* Alignment tools — shown when ≥2 layers selected */}
            {selectedIds.size >= 2 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#666', marginRight: 2 }}>Align:</span>
                <button onClick={() => alignLayers('x', 'min')}    title="Align left"            style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬅L</button>
                <button onClick={() => alignLayers('x', 'center')} title="Align center (H)"      style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬛C</button>
                <button onClick={() => alignLayers('x', 'max')}    title="Align right"           style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>R➡</button>
                <span style={{ width: 4 }} />
                <button onClick={() => alignLayers('y', 'min')}    title="Align top"             style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬆T</button>
                <button onClick={() => alignLayers('y', 'center')} title="Align middle (V)"      style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬛M</button>
                <button onClick={() => alignLayers('y', 'max')}    title="Align bottom"          style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>B⬇</button>
              </div>
            )}

            {(template.layers || []).length === 0 && (
              <div style={{ color: '#555', fontSize: 13 }}>No layers yet.</div>
            )}

            {[...(template.layers || [])].reverse().map((layer) => {
              const isInSel   = selectedIds.has(layer.id);
              const isPrimary = layer.id === primaryId;
              const gName     = layer.groupId ? groupNameById[layer.groupId] || layer.groupId : null;
              const isHidden  = layer.visible === false;
              return (
                <div key={layer.id} style={{
                  display: 'flex', alignItems: 'center', padding: '4px 8px', marginBottom: 2,
                  background: isInSel ? '#1e3a5f' : '#1a1a1a', borderRadius: 3, cursor: 'pointer',
                  border: isPrimary ? '1px solid #4488dd' : isInSel ? '1px solid #336' : '1px solid transparent',
                  opacity: isHidden ? 0.4 : 1,
                }} onClick={() => selectLayerFromList(layer.id)}>
                  <button onClick={e => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                          title={isHidden ? 'Show layer' : 'Hide layer'}
                          style={{ ...btnStyle, padding: '1px 5px', fontSize: 11, marginRight: 4, flexShrink: 0 }}>
                    {isHidden ? '○' : '●'}
                  </button>
                  <span style={{ fontSize: 11, color: '#666', width: 44, flexShrink: 0 }}>{layer.type}</span>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {layer.id}
                    {layer.type === 'text' && layer.binding
                      ? <span style={{ color: '#44bb88', marginLeft: 6 }}>⟳{layer.binding}</span>
                      : layer.type === 'text' && layer.text
                        ? <span style={{ color: '#777', marginLeft: 6 }}>"{layer.text}"</span>
                        : null}
                  </span>
                  {gName && (
                    <span style={{ fontSize: 10, color: '#6af', background: '#1a2a3a', borderRadius: 3,
                                   padding: '1px 5px', marginRight: 4, flexShrink: 0, maxWidth: 80,
                                   overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={gName}>
                      {gName}
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); reorderLayer(layer.id, -1); }}  title="Move up"   style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>↑</button>
                  <button onClick={e => { e.stopPropagation(); reorderLayer(layer.id,  1); }}  title="Move down" style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>↓</button>
                  <button onClick={e => { e.stopPropagation(); duplicateLayer(layer.id); }}    title="Duplicate" style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>⧉</button>
                  <button onClick={e => { e.stopPropagation(); deleteLayer(layer.id); }}       title="Delete"    style={{ ...btnDangerStyle, padding: '1px 5px', fontSize: 11, marginLeft: 4 }}>✕</button>
                </div>
              );
            })}

            {/* ── Media Library ── */}
            <div style={{ borderTop: '1px solid #333', marginTop: 4, paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold', flex: 1 }}>Media Library</span>
                <button onClick={() => imgInputRef.current?.click()} style={{ ...btnStyle, fontSize: 12 }}>Upload</button>
                <button onClick={() => setImgLibOpen(v => !v)} style={{ ...btnStyle, fontSize: 12, padding: '4px 8px' }}>
                  {imgLibOpen ? '▲' : '▼'}
                </button>
                <input ref={imgInputRef} type="file"
                       accept="image/png,image/jpeg,image/webp,image/svg+xml"
                       style={{ display: 'none' }} onChange={handleFileInputChange} />
              </div>

              {imgLibOpen && (
                <>
                  {imgPending && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#aaa' }}>{imgPending.name}</span>
                      <input type="text" value={shorthandInput}
                             onChange={e => setShorthandInput(e.target.value)}
                             placeholder="shorthand" style={{ ...inputStyle, width: 120 }} />
                      <button onClick={() => uploadImage(imgPending, shorthandInput)}
                              disabled={imgUploading || !shorthandInput.trim()}
                              style={{ ...btnPrimaryStyle, fontSize: 12 }}>
                        {imgUploading ? '…' : 'OK'}
                      </button>
                      <button onClick={() => { setImgPending(null); setShorthandInput(''); setImgUploadErr(''); }}
                              style={{ ...btnStyle, fontSize: 12 }}>Cancel</button>
                      {imgUploadErr && <span style={{ color: '#f88', fontSize: 12 }}>{imgUploadErr}</span>}
                    </div>
                  )}

                  {images.length === 0 && !imgPending && (
                    <div style={{ color: '#555', fontSize: 13, paddingBottom: 4 }}>No images yet. Click Upload to add one.</div>
                  )}

                  {images.map(img => (
                    <div key={img.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
                      borderBottom: '1px solid #1e1e1e',
                    }}>
                      <img src={`${serverUrl}/images/${img.id}`} alt={img.shorthand}
                           style={{ width: 40, height: 40, objectFit: 'contain', background: '#222', borderRadius: 3, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={img.shorthand}>{img.shorthand}</span>
                      <span style={{ fontSize: 11, color: '#666', flexShrink: 0 }}>
                        {img.mimeType?.split('/')[1]?.toUpperCase()}
                      </span>
                      <button onClick={() => useImageFromLibrary(img)} title="Insert into canvas"
                              style={{ ...btnStyle, padding: '2px 6px', fontSize: 11 }}>Use</button>
                      <button onClick={() => { if (window.confirm(`Delete image "${img.shorthand}"?`)) deleteImageById(img.id); }}
                              title="Delete" style={{ ...btnDangerStyle, padding: '2px 6px', fontSize: 11 }}>✕</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Properties panel */}
          <div style={{ width: 280, borderLeft: '1px solid #333', padding: 12, overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold', marginBottom: 10 }}>Properties</div>
            <LayerPropertyEditor
              layer={primaryLayer}
              selectionCount={selectedIds.size}
              aspectLock={aspectLock}
              onAspectLock={() => setAspectLock(v => !v)}
              onChange={updateLayer}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
