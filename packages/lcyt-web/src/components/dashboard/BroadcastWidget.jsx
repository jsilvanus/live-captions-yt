import { useState, useEffect } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';

export function BroadcastWidget({ size }) {
  const { connected, getRelayStatus } = useSessionContext();
  const [relayStatus, setRelayStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected) { setRelayStatus(null); return; }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await getRelayStatus();
        if (!cancelled) setRelayStatus(data);
      } catch {}
      if (!cancelled) setLoading(false);
    }
    load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected]);

  if (!connected) {
    return <div className="db-widget db-empty-note">Not connected.</div>;
  }

  if (loading && !relayStatus) {
    return <div className="db-widget db-empty-note">Loading…</div>;
  }

  const relays = relayStatus?.relays ?? [];
  const running = relayStatus?.runningSlots ?? [];
  const isActive = relayStatus?.active ?? false;

  if (size === 'small') {
    return (
      <div className="db-widget db-widget--broadcast-sm">
        <span className={`db-dot ${isActive ? 'db-dot--ok' : 'db-dot--idle'}`} />
        <span className="db-widget__value">{isActive ? 'Active' : 'Idle'}</span>
        {relays.length > 0 && (
          <span className="db-widget__muted">{running.length}/{relays.length} slots</span>
        )}
      </div>
    );
  }

  return (
    <div className="db-widget">
      <div className="db-row">
        <span className={`db-dot ${isActive ? 'db-dot--ok' : 'db-dot--idle'}`} />
        <span className="db-widget__value">Relay: {isActive ? 'Active' : 'Idle'}</span>
      </div>
      {relays.length > 0 ? (
        relays.map((r, i) => (
          <div key={i} className="db-row">
            <span className={`db-dot ${running.includes(r.slot) ? 'db-dot--ok' : 'db-dot--idle'}`} />
            <span className="db-widget__label">Slot {r.slot}</span>
            <span className="db-widget__value db-widget__value--trunc">
              {r.targetUrl ? r.targetUrl.replace('rtmp://a.rtmp.youtube.com/live2', 'YT') : '—'}
            </span>
          </div>
        ))
      ) : (
        <div className="db-empty-note">No relay slots configured.</div>
      )}
    </div>
  );
}
