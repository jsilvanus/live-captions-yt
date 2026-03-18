import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';

export function ViewportsWidget({ size }) {
  const { backendUrl, apiKey, connected } = useSessionContext();
  const [viewports, setViewports] = useState([]);
  const [activeGraphics, setActiveGraphics] = useState({});
  const esRef = useRef(null);

  useEffect(() => {
    if (!backendUrl || !apiKey || !connected) return;
    fetch(`${backendUrl}/dsk/${encodeURIComponent(apiKey)}/viewports/public`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.viewports) {
          setViewports([{ name: 'landscape', label: 'Landscape', width: 1920, height: 1080 }, ...data.viewports]);
        }
      })
      .catch(() => {});
  }, [backendUrl, apiKey, connected]);

  useEffect(() => {
    if (!backendUrl || !apiKey) { esRef.current?.close(); return; }
    esRef.current?.close();
    const es = new EventSource(`${backendUrl}/dsk/${encodeURIComponent(apiKey)}/events`);
    esRef.current = es;
    es.addEventListener('graphics', (e) => {
      try {
        const data = JSON.parse(e.data);
        setActiveGraphics(data.viewports || {});
      } catch {}
    });
    return () => { es.close(); esRef.current = null; };
  }, [backendUrl, apiKey]);

  function openViewport(vp) {
    const params = new URLSearchParams({ server: backendUrl });
    const url = `/dsk/${encodeURIComponent(apiKey)}?${params}&viewport=${encodeURIComponent(vp.name)}`;
    const w = vp.width || 1920;
    const h = vp.height || 1080;
    window.open(url, `viewport-${vp.name}`, `width=${w},height=${h},noopener`);
  }

  if (!connected) {
    return <div className="db-widget db-empty-note">Not connected.</div>;
  }
  if (viewports.length === 0) {
    return <div className="db-widget db-empty-note">No viewports. Configure in Graphics → Viewports.</div>;
  }

  const shown = size === 'small' ? viewports.slice(0, 2) : viewports;
  const cols = size === 'small' ? 2 : Math.min(3, shown.length);

  return (
    <div className="db-widget db-widget--viewports" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {shown.map(vp => {
        const active = activeGraphics[vp.name] || [];
        const w = vp.width || 1920;
        const h = vp.height || 1080;
        const aspect = h / w;
        return (
          <div key={vp.name} className="db-viewport-thumb">
            <div
              className="db-viewport-thumb__screen"
              style={{ paddingBottom: `${aspect * 100}%`, position: 'relative', background: '#000', borderRadius: 3, overflow: 'hidden' }}
            >
              {active.length > 0 && (
                <div className="db-viewport-thumb__overlay">
                  {active.slice(0, 3).map((name) => (
                    <span key={name} className="db-viewport-thumb__layer">{name}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="db-viewport-thumb__footer">
              <span className="db-viewport-thumb__label">
                {vp.label || vp.name}
                {active.length > 0 && <span className="db-dot db-dot--ok" style={{ marginLeft: 4 }} />}
              </span>
              <button
                className="btn btn--ghost btn--xs db-viewport-thumb__open-btn"
                onClick={() => openViewport(vp)}
                title={`Open ${vp.label || vp.name} viewport`}
              >
                ↗
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
