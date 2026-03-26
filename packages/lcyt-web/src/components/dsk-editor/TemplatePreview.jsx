import React, { useRef } from 'react';
import { handleAnchor, applyResize, gridSnap, snapToLayerEdges, getLayerViewportPos } from '../../lib/dskEditorGeometry.js';

const HANDLE_LIST = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSORS = {
  nw: 'nw-resize', n: 'n-resize',  ne: 'ne-resize',
  e:  'e-resize',  se: 'se-resize', s:  's-resize',
  sw: 'sw-resize', w:  'w-resize',
};

const EMPTY_TEMPLATE = {
  background: 'transparent',
  width: 1920,
  height: 1080,
  groups: [],
  layers: [],
};

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

export default function TemplatePreview({
  template, selectedIds, primaryId, selectedViewport,
  onSelect, onDragStart, onMoveSelected, onResizeLayer, snapGrid, showSafeArea,
  vpWidth, vpHeight, previewTargetWidth = 960,
}) {
  const t = template || EMPTY_TEMPLATE;
  const layers = Array.isArray(t.layers) ? t.layers : [];

  // Compute effective layer positions for the currently selected viewport
  const effectiveLayers = layers.map(l => ({ ...l, ...getLayerViewportPos(l, selectedViewport) }));

  const containerRef = useRef(null);
  const dragRef = useRef(null);

  function startLayerDrag(e, layerId) {
    e.stopPropagation();
    const layer = effectiveLayers.find(l => l.id === layerId);

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
        const l = effectiveLayers.find(ll => ll.id === id);
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
    const layer = effectiveLayers.find(l => l.id === layerId);
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

  function onContainerPointerDown(e) {
    dragRef.current = { type: 'background' };
  }

  function onContainerPointerMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.type === 'background') return;

    const displayWidth = vpWidth || (t.width || 1920);
    const displayHeight = vpHeight || (t.height || 1080);
    const scale = previewTargetWidth / displayWidth;

    const rawDx = (e.clientX - drag.startPointer.x) / scale;
    const rawDy = (e.clientY - drag.startPointer.y) / scale;

    if (!drag.hasMoved && (Math.abs(e.clientX - drag.startPointer.x) > 3 ||
                           Math.abs(e.clientY - drag.startPointer.y) > 3)) {
      drag.hasMoved = true;
    }
    if (!drag.hasMoved) return;

    if (!drag.historyPushed) {
      drag.historyPushed = true;
      onDragStart();
    }

    if (drag.type === 'move') {
      const primaryLayer = effectiveLayers.find(l => l.id === drag.layerId);
      const primaryStart = drag.startPositions.get(drag.layerId);

      let tentX = primaryStart.x + rawDx;
      let tentY = primaryStart.y + rawDy;

      if (snapGrid) {
        tentX = gridSnap(tentX);
        tentY = gridSnap(tentY);
      }

      if (primaryLayer?.width && primaryLayer?.height) {
        const snapped = snapToLayerEdges(tentX, tentY, primaryLayer, effectiveLayers, drag.dragIds);
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

  function onContainerKeyDown(e) {
    if (!primaryId) return;
    const layer = effectiveLayers.find(l => l.id === primaryId);
    if (!layer) return;
    const step = e.shiftKey ? 10 : 1;
    const x = Number(layer.x) || 0;
    const y = Number(layer.y) || 0;
    if (e.key === 'ArrowLeft')  { onMoveSelected([{ id: primaryId, x: x - step, y }]); e.preventDefault(); }
    if (e.key === 'ArrowRight') { onMoveSelected([{ id: primaryId, x: x + step, y }]); e.preventDefault(); }
    if (e.key === 'ArrowUp')    { onMoveSelected([{ id: primaryId, x, y: y - step }]); e.preventDefault(); }
    if (e.key === 'ArrowDown')  { onMoveSelected([{ id: primaryId, x, y: y + step }]); e.preventDefault(); }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        width: previewTargetWidth, height: (vpHeight || (t.height || 1080)) * (previewTargetWidth / (vpWidth || (t.width || 1920))), position: 'relative', overflow: 'hidden',
        flexShrink: 0, border: '2px solid #444', borderRadius: 4,
        cursor: 'default', outline: 'none', touchAction: 'none',
      }}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onKeyDown={onContainerKeyDown}
    >
      <div style={{
        width: vpWidth || (t.width || 1920), height: vpHeight || (t.height || 1080), position: 'absolute', top: 0, left: 0,
        transform: `scale(${previewTargetWidth / (vpWidth || (t.width || 1920))})`, transformOrigin: 'top left',
        background: t.background || 'transparent',
        backgroundImage: t.background === 'transparent' || !t.background
          ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 0 0 / 40px 40px'
          : undefined,
      }}>
        {effectiveLayers.flatMap((layer) => {
          const isSelected    = layer.id === primaryId && selectedIds.size === 1;
          const isInSelection = selectedIds.has(layer.id);

          const el = renderLayerElement(
            layer, isSelected, isInSelection && !isSelected,
            e => startLayerDrag(e, layer.id),
          );
          if (!el) return [];

          if (!isSelected) return [el];

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
