import { useState, useCallback } from 'react';
import { KEYS } from '../lib/storageKeys.js';

// Available widget definitions
export const WIDGET_REGISTRY = [
  { id: 'status',     title: 'Status',          defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 } },
  { id: 'sent-log',   title: 'Sent Log',         defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 } },
  { id: 'audio',      title: 'Audio Capture',    defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 } },
  { id: 'input',      title: 'Quick Send',       defaultLayout: { w: 6, h: 2, minW: 3, minH: 2 } },
  { id: 'file',       title: 'File Preview',     defaultLayout: { w: 3, h: 5, minW: 2, minH: 3 } },
  { id: 'broadcast',  title: 'Broadcast',        defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 } },
  { id: 'viewer',     title: 'Viewer',           defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 } },
  { id: 'viewports',  title: 'Viewports',        defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 } },
];

const DEFAULT_PANELS = ['status', 'sent-log', 'input'];

const ROW_HEIGHT_UNITS = 4;
const SM_MAX_COLS = 6;

// Build default layout for a set of panels, left-to-right, auto positioning
function buildDefaultLayouts(panels) {
  let x = 0, y = 0;
  const items = [];
  for (const id of panels) {
    const def = WIDGET_REGISTRY.find(w => w.id === id);
    if (!def) continue;
    const { w, h, minW, minH } = def.defaultLayout;
    if (x + w > 12) { x = 0; y += ROW_HEIGHT_UNITS; }
    items.push({ i: id, x, y, w, h, minW, minH });
    x += w;
  }
  return { lg: items, md: items, sm: items.map(item => ({ ...item, w: Math.min(item.w, SM_MAX_COLS), x: 0 })) };
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(KEYS.dashboard.config);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveConfig(panels, layouts) {
  try {
    localStorage.setItem(KEYS.dashboard.config, JSON.stringify({ panels, layouts }));
  } catch {}
}

export function useDashboardConfig() {
  const [config, setConfig] = useState(() => {
    const saved = loadConfig();
    if (saved && saved.panels) return saved;
    const panels = DEFAULT_PANELS;
    return { panels, layouts: buildDefaultLayouts(panels) };
  });

  const setPanels = useCallback((newPanels) => {
    setConfig(prev => {
      const existing = prev.layouts?.lg || [];
      const existingIds = new Set(existing.map(l => l.i));
      const newItems = [];
      for (const id of newPanels) {
        if (existingIds.has(id)) continue;
        const def = WIDGET_REGISTRY.find(w => w.id === id);
        if (!def) continue;
        const { w, h, minW, minH } = def.defaultLayout;
        const maxY = existing.reduce((m, l) => Math.max(m, l.y + l.h), 0);
        newItems.push({ i: id, x: 0, y: maxY, w, h, minW, minH });
      }
      const lgLayout = [...existing.filter(l => newPanels.includes(l.i)), ...newItems];
      const newLayouts = { lg: lgLayout, md: lgLayout, sm: lgLayout.map(l => ({ ...l, w: Math.min(l.w, SM_MAX_COLS), x: 0 })) };
      const next = { panels: newPanels, layouts: newLayouts };
      saveConfig(newPanels, newLayouts);
      return next;
    });
  }, []);

  const updateLayouts = useCallback((layouts) => {
    setConfig(prev => {
      const next = { ...prev, layouts };
      saveConfig(prev.panels, layouts);
      return next;
    });
  }, []);

  const removePanel = useCallback((id) => {
    setConfig(prev => {
      const panels = prev.panels.filter(p => p !== id);
      const layouts = {
        lg: (prev.layouts?.lg || []).filter(l => l.i !== id),
        md: (prev.layouts?.md || []).filter(l => l.i !== id),
        sm: (prev.layouts?.sm || []).filter(l => l.i !== id),
      };
      saveConfig(panels, layouts);
      return { panels, layouts };
    });
  }, []);

  const resetToDefault = useCallback(() => {
    const panels = DEFAULT_PANELS;
    const layouts = buildDefaultLayouts(panels);
    saveConfig(panels, layouts);
    setConfig({ panels, layouts });
  }, []);

  return { config, setPanels, updateLayouts, removePanel, resetToDefault };
}
