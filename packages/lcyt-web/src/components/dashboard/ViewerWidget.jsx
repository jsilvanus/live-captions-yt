import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { getEnabledTargets } from '../../lib/targetConfig';
import { resolveViewerText } from '../../lib/viewerUtils';

export function ViewerWidget({ size }) {
  const { backendUrl, connected } = useSessionContext();
  const [captions, setCaptions] = useState([]);
  const [viewerKey, setViewerKey] = useState('');
  const esRef = useRef(null);

  useEffect(() => {
    const targets = getEnabledTargets();
    const vt = targets.find(t => t.type === 'viewer' && t.viewerKey);
    setViewerKey(vt?.viewerKey || '');
  }, [connected]);

  useEffect(() => {
    if (!viewerKey || !backendUrl) { esRef.current?.close(); esRef.current = null; return; }
    esRef.current?.close();
    const es = new EventSource(`${backendUrl}/viewer/${encodeURIComponent(viewerKey)}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const text = resolveViewerText(data, null);
        if (text) {
          setCaptions(prev => {
            const next = [{ text, seq: data.sequence, ts: data.timestamp }, ...prev];
            return next.slice(0, 20);
          });
        }
      } catch {}
    };
    return () => { es.close(); esRef.current = null; };
  }, [viewerKey, backendUrl]);

  if (!viewerKey) {
    return <div className="db-widget db-empty-note">No viewer target configured. Add one in CC → Targets.</div>;
  }

  const limit = size === 'small' ? 5 : 12;
  const visible = captions.slice(0, limit);

  return (
    <div className="db-widget db-widget--viewer">
      <div className="db-viewer-key">{viewerKey}</div>
      {visible.length === 0 ? (
        <div className="db-empty-note">Waiting for captions…</div>
      ) : (
        visible.map((c, i) => (
          <div key={c.seq ?? i} className={`db-viewer-line${i === 0 ? ' db-viewer-line--current' : ''}`}>
            {c.text}
          </div>
        ))
      )}
    </div>
  );
}
