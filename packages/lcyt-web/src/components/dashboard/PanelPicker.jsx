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

  return (
    <div className="db-panel-picker" ref={ref}>
      <button className="btn btn--secondary btn--sm db-add-btn" onClick={() => setOpen(o => !o)}>
        + Add widget
      </button>
      {open && (
        <div className="db-panel-picker__menu">
          {WIDGET_REGISTRY.map(w => (
            <label key={w.id} className="db-panel-picker__item">
              <input
                type="checkbox"
                checked={activePanels.includes(w.id)}
                onChange={() => toggle(w.id)}
              />
              {w.title}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
