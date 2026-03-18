import { useState } from 'react';
import { Responsive, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useDashboardConfig, WIDGET_REGISTRY } from '../hooks/useDashboardConfig';
import { DashboardCard } from './dashboard/DashboardCard';
import { StatusWidget } from './dashboard/StatusWidget';
import { SentLogWidget } from './dashboard/SentLogWidget';
import { AudioWidget } from './dashboard/AudioWidget';
import { InputWidget } from './dashboard/InputWidget';
import { FileWidget } from './dashboard/FileWidget';
import { BroadcastWidget } from './dashboard/BroadcastWidget';
import { ViewerWidget } from './dashboard/ViewerWidget';
import { ViewportsWidget } from './dashboard/ViewportsWidget';
import { PanelPicker } from './dashboard/PanelPicker';

function WidgetContent({ id, size, minimized }) {
  if (id.startsWith('file')) return <FileWidget id={id} size={size} minimized={minimized} />;
  switch (id) {
    case 'status':    return <StatusWidget size={size} minimized={minimized} />;
    case 'sent-log':  return <SentLogWidget size={size} />;
    case 'audio':     return <AudioWidget size={size} />;
    case 'input':     return <InputWidget size={size} />;
    case 'broadcast': return <BroadcastWidget size={size} />;
    case 'viewer':    return <ViewerWidget size={size} />;
    case 'viewports': return <ViewportsWidget size={size} />;
    default: return <div className="db-empty-note">Unknown widget: {id}</div>;
  }
}

export function DashboardPage() {
  const { config, setPanels, updateLayouts, removePanel } = useDashboardConfig();
  const [sizes, setSizes] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [editMode, setEditMode] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();

  function getSize(id) { return sizes[id] || 'large'; }
  function setSize(id, sz) { setSizes(prev => ({ ...prev, [id]: sz })); }
  function toggleCollapsed(id) { setCollapsed(prev => ({ ...prev, [id]: !prev[id] })); }

  const panels = config.panels || [];
  const layouts = config.layouts || {};

  if (panels.length === 0) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-page__header">
          <h1 className="dashboard-page__title">Dashboard</h1>
          <PanelPicker activePanels={panels} onChange={setPanels} />
        </div>
        <div className="db-empty-state">
          <div className="db-empty-state__icon">📊</div>
          <div className="db-empty-state__title">Your dashboard is empty</div>
          <div className="db-empty-state__desc">Add widgets using the button above to monitor your broadcast.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page__header">
        <h1 className="dashboard-page__title">Dashboard</h1>
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
            draggableHandle=".db-card__drag-handle"
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
                <div key={id}>
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
