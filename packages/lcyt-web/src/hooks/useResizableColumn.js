import { useState, useCallback } from 'react';

/**
 * useResizableColumn — a persisted, drag-to-resize width for one column of a
 * multi-column desktop layout (e.g. a side panel with a resize handle on one
 * edge). Not meant for narrow/stacked mobile layouts — callers should skip
 * rendering the drag handle there, same as the width itself stops being used
 * once the column goes full-width.
 *
 * @param {string} storageKey - localStorage key the width is persisted under
 * @param {object} [opts]
 * @param {number} [opts.defaultWidth=240]
 * @param {number} [opts.min=160]
 * @param {number} [opts.max=600]
 * @param {'left'|'right'} [opts.handleSide='right'] - which edge of the
 *   column the drag handle sits on. 'right' means dragging right grows the
 *   column (handle is on the column's right edge); 'left' means dragging
 *   left grows it (handle is on the column's left edge, e.g. a panel
 *   anchored to the right side of the page).
 * @returns {[number, (e: PointerEvent) => void]} [width, startResize]
 */
export function useResizableColumn(storageKey, {
  defaultWidth = 240,
  min = 160,
  max = 600,
  handleSide = 'right',
} = {}) {
  const [width, setWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(storageKey), 10);
      return v > 0 ? Math.max(min, Math.min(max, v)) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const sign = handleSide === 'left' ? -1 : 1;

    function onMove(ev) {
      const next = Math.max(min, Math.min(max, startWidth + sign * (ev.clientX - startX)));
      setWidth(next);
      try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [width, min, max, handleSide, storageKey]);

  return [width, startResize];
}
