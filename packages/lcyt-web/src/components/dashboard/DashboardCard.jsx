import { useState } from 'react';

export function DashboardCard({ id, title, onRemove, children, size, onSizeChange }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`db-card${collapsed ? ' db-card--collapsed' : ''}`}>
      <div className="db-card__header db-card__drag-handle">
        <span className="db-card__title">{title}</span>
        <div className="db-card__actions">
          {onSizeChange && (
            <button
              className="db-card__btn"
              onClick={() => onSizeChange(size === 'small' ? 'large' : 'small')}
              title={size === 'small' ? 'Enlarge' : 'Shrink'}
              aria-label={size === 'small' ? 'Enlarge widget' : 'Shrink widget'}
            >
              {size === 'small' ? '⊞' : '⊡'}
            </button>
          )}
          <button
            className="db-card__btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand widget' : 'Collapse widget'}
          >
            {collapsed ? '▲' : '▼'}
          </button>
          <button
            className="db-card__btn db-card__btn--remove"
            onClick={() => onRemove(id)}
            title="Remove widget"
            aria-label="Remove widget"
          >
            ✕
          </button>
        </div>
      </div>
      {!collapsed && <div className="db-card__body">{children}</div>}
    </div>
  );
}
