// Geometry helpers for DSK editor (pure functions)

export const GRID_SIZE = 20;
export const SNAP_THRESH = 10;

export function handleAnchor(handle, layer) {
  const x = Number(layer.x) || 0;
  const y = Number(layer.y) || 0;
  const w = Number(layer.width) || 0;
  const h = Number(layer.height) || 0;
  return {
    left: handle.includes('e') ? x + w : handle.includes('w') ? x : x + w / 2,
    top:  handle.includes('s') ? y + h : handle.includes('n') ? y : y + h / 2,
  };
}

export function applyResize(handle, startRect, dx, dy) {
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

export function gridSnap(v) {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export function snapToLayerEdges(tentX, tentY, primaryLayer, allLayers, movingIds) {
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

export function getLayerViewportPos(layer, selectedViewport) {
  if (!layer) return { x: 0, y: 0 };
  if (!selectedViewport || selectedViewport === 'landscape') {
    return {
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      width: layer.width != null ? Number(layer.width) : undefined,
      height: layer.height != null ? Number(layer.height) : undefined,
    };
  }
  const vp = (layer.viewports && layer.viewports[selectedViewport]) || {};
  return {
    x: vp.x != null ? Number(vp.x) : (Number(layer.x) || 0),
    y: vp.y != null ? Number(vp.y) : (Number(layer.y) || 0),
    width: vp.width != null ? Number(vp.width) : (layer.width != null ? Number(layer.width) : undefined),
    height: vp.height != null ? Number(vp.height) : (layer.height != null ? Number(layer.height) : undefined),
  };
}
