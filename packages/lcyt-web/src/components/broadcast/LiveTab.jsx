import { useState } from 'react';
import { Responsive, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useDashboardConfig, WIDGET_REGISTRY } from '../../hooks/useDashboardConfig';
import { DashboardCard } from '../dashboard/DashboardCard';
import { StatusWidget } from '../dashboard/StatusWidget';
import { SentLogWidget } from '../dashboard/SentLogWidget';
import { AudioWidget } from '../dashboard/AudioWidget';
import { InputWidget } from '../dashboard/InputWidget';
import { FileWidget } from '../dashboard/FileWidget';
import { BroadcastWidget } from '../dashboard/BroadcastWidget';
import { ViewerWidget } from '../dashboard/ViewerWidget';
import { ViewportsWidget } from '../dashboard/ViewportsWidget';
import { PanelPicker } from '../dashboard/PanelPicker';
import { MetacodeWidget } from '../dashboard/MetacodeWidget';

// ─── Standard layout presets — sit on top of the fully-customizable
//     drag/resize engine (useDashboardConfig). Each preset is just a named
//     panel set; useDashboardConfig.setPanels() computes default positions
//     for any panel not already laid out. ────────────────────────────────
export const BROADCAST_PRESETS = [
  {
    id: 'captioner',
    label: 'Captioner',
    description: 'Status, quick send, and the sent-caption log — a focused view for captioning.',
    panels: ['status', 'input', 'sent-log'],
  },
  {
    id: 'full-operate',
    label: 'Full operate',
    description: 'Every available widget — status, audio, files, viewer, viewports, metacodes.',
    panels: WIDGET_REGISTRY.map(w => w.id),
  },
];

const ROW_HEIGHT_UNITS = 4;
const SM_MAX_COLS = 6;

function buildPresetLayouts(panels) {
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

function WidgetContent({ id, size, minimized }) {
  if (id.startsWith('file')) return <FileWidget id={id} size={size} minimized={minimized} />;
  if (id.startsWith('viewports')) return <ViewportsWidget id={id} size={size} />;
  switch (id) {
    case 'status':    return <StatusWidget size={size} minimized={minimized} />;
    case 'sent-log':  return <SentLogWidget size={size} />;
    case 'audio':     return <AudioWidget size={size} />;
    case 'input':     return <InputWidget size={size} />;
    case 'broadcast': return <BroadcastWidget size={size} />;
    case 'viewer':    return <ViewerWidget size={size} />;
    case 'metacode':  return <MetacodeWidget size={size} />;
    default: return <div className="db-empty-note">Unknown widget: {id}</div>;
  }
}

function PresetPicker({ panels, onApply }) {
  return (
    <div className="db-presets">
      <span className="db-presets__label">Presets:</span>
      {BROADCAST_PRESETS.map(preset => {
        const active = panels.length === preset.panels.length && panels.every(p => preset.panels.includes(p));
        return (
          <button
            key={preset.id}
            type="button"
            className={`btn btn--sm ${active ? 'btn--primary' : 'btn--ghost'}`}
            title={preset.description}
            onClick={() => onApply(preset)}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * LiveTab — the widget-grid operator console. Previously `DashboardPage` at
 * `/`; now lives as the default tab of `/broadcast`. Same engine
 * (useDashboardConfig / react-grid-layout / WIDGET_REGISTRY / PanelPicker /
 * DashboardCard / dashboard/* widgets) as before, plus a thin preset layer.
 */
export function LiveTab() {
  const { config, setPanels, updateLayouts, removePanel } = useDashboardConfig();
  const [sizes, setSizes] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [editMode, setEditMode] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();

  function getSize(id) { return sizes[id] || 'large'; }
  function setSize(id, sz) { setSizes(prev => ({ ...prev, [id]: sz })); }
  function toggleCollapsed(id) { setCollapsed(prev => ({ ...prev, [id]: !prev[id] })); }

  function applyPreset(preset) {
    setPanels(preset.panels);
    updateLayouts(buildPresetLayouts(preset.panels));
  }

  const panels = config.panels || [];
  const layouts = config.layouts || {};

  if (panels.length === 0) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-page__header">
          <h1 className="dashboard-page__title">Live</h1>
          <PresetPicker panels={panels} onApply={applyPreset} />
          <PanelPicker activePanels={panels} onChange={setPanels} />
        </div>
        <div className="db-empty-state">
          <div className="db-empty-state__icon">📊</div>
          <div className="db-empty-state__title">Your broadcast console is empty</div>
          <div className="db-empty-state__desc">Pick a preset or add widgets using the buttons above to monitor your broadcast.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page__header">
        <h1 className="dashboard-page__title">Live</h1>
        <PresetPicker panels={panels} onApply={applyPreset} />
        <button
          className={`btn btn--sm ${editMode ? 'btn--primary' : 'btn--secondary'} db-edit-btn`}
          onClick={() => setEditMode(v => !v)}
          title={editMode ? 'Lock layout' : 'Edit layout'}
        >
          {editMode ? '🔓 Editing' : '✏️ Edit'}
        </button>
        <PanelPicker activePanels={panels} onChange={setPanels} />
      </div>
      <div ref={containerRef} className="db-grid">
        {mounted && (
          <Responsive
            width={width}
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 768, sm: 480 }}
            cols={{ lg: 12, md: 8, sm: 4 }}
            rowHeight={40}
            /* Always set the draggable handle selector; use draggableCancel to
               defensively prevent dragging when a card has the locked class. */
            draggableHandle={'.db-card__drag-handle'}
            draggableCancel={'.db-card--locked *'}
            isDraggable={editMode}
            isResizable={editMode}
            onLayoutChange={(layout, allLayouts) => updateLayouts(allLayouts)}
            margin={[12, 12]}
          >
            {panels.map(id => {
              const baseId = id.startsWith('file') ? 'file' : id;
              const def = WIDGET_REGISTRY.find(w => w.id === baseId);
              const title = def?.title || id;
              const isCollapsed = !!collapsed[id];
              return (
                <div
                  key={id}
                  onMouseDown={e => { if (!editMode) e.stopPropagation(); }}
                  onTouchStart={e => { if (!editMode) e.stopPropagation(); }}
                  onPointerDown={e => { if (!editMode) e.stopPropagation(); }}
                >
                  <DashboardCard
                    id={id}
                    title={title}
                    onRemove={removePanel}
                    size={getSize(id)}
                    onSizeChange={(sz) => setSize(id, sz)}
                    editMode={editMode}
                    collapsed={isCollapsed}
                    onToggleCollapse={() => toggleCollapsed(id)}
                  >
                    <WidgetContent id={id} size={getSize(id)} minimized={isCollapsed} />
                  </DashboardCard>
                </div>
              );
            })}
          </Responsive>
        )}
      </div>
    </div>
  );
}
