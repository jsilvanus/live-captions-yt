import { useState, useRef, useEffect } from 'react';
import { WIDGET_REGISTRY } from '../../hooks/useDashboardConfig';

export function PanelPicker({ activePanels, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function toggle(id) {
    const next = activePanels.includes(id)
      ? activePanels.filter(p => p !== id)
      : [...activePanels, id];
    onChange(next);
  }

  function addInstance(id) {
    // Generate a unique ID for the new instance: file-2, file-3, etc.
    const existingCount = activePanels.filter(p => p === id || p.startsWith(id + '-')).length;
    const newId = existingCount === 0 ? id : `${id}-${existingCount + 1}`;
    onChange([...activePanels, newId]);
  }

  return (
    <div className="db-panel-picker" ref={ref}>
      <button className="btn btn--secondary btn--sm db-add-btn" onClick={() => setOpen(o => !o)}>
        + Add widget
      </button>
      {open && (
        <div className="db-panel-picker__menu">
          {WIDGET_REGISTRY.map(w => {
            if (w.allowMultiple) {
              const count = activePanels.filter(p => p === w.id || p.startsWith(w.id + '-')).length;
              return (
                <div key={w.id} className="db-panel-picker__item db-panel-picker__item--multi">
                  <span className="db-panel-picker__multi-label">{w.title}</span>
                  {count > 0 && <span className="db-panel-picker__multi-count">{count} open</span>}
                  <button
                    className="btn btn--secondary btn--xs db-panel-picker__add-btn"
                    onClick={() => addInstance(w.id)}
                  >
                    + Add
                  </button>
                </div>
              );
            }
            return (
              <label key={w.id} className="db-panel-picker__item">
                <input
                  type="checkbox"
                  checked={activePanels.includes(w.id)}
                  onChange={() => toggle(w.id)}
                />
                {w.title}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
