import { useCallback, useEffect, useMemo, useState } from 'react';

export function BroadcastsSection({ project, backendUrl, token, onActivated }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [activeBroadcastId, setActiveBroadcastId] = useState(project.activeBroadcastId ?? null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const requestHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token,
    'X-Project-Id': project.key,
  }), [project.key, token]);

  useEffect(() => {
    setActiveBroadcastId(project.activeBroadcastId ?? null);
  }, [project.activeBroadcastId]);

  const load = useCallback(async () => {
    if (!backendUrl || !token || !project.key) {
      setBroadcasts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
     const [listRes, activeRes] = await Promise.all([
       fetch(`${backendUrl}/broadcasts`, { headers: requestHeaders }),
       fetch(`${backendUrl}/broadcasts/active`, { headers: requestHeaders }),
     ]);
      const listData = await listRes.json().catch(() => ({}));
      const activeData = await activeRes.json().catch(() => ({}));
      if (!listRes.ok) throw new Error(listData.error || `HTTP ${listRes.status}`);
      if (!activeRes.ok) throw new Error(activeData.error || `HTTP ${activeRes.status}`);
      setBroadcasts(Array.isArray(listData.broadcasts) ? listData.broadcasts : []);
      setActiveBroadcastId(activeData.activeBroadcastId ?? null);
    } catch (err) {
      setError(err.message || 'Failed to load broadcasts');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, project.key, requestHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleBroadcast(broadcast) {
    const isActive = String(activeBroadcastId) === String(broadcast.id);
    const url = isActive ? `${backendUrl}/broadcasts/active` : `${backendUrl}/broadcasts/${encodeURIComponent(broadcast.id)}/activate`;
    setBusyId(broadcast.id);
    try {
     const res = await fetch(url, {
       method: isActive ? 'DELETE' : 'POST',
       headers: requestHeaders,
     });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const nextActiveId = isActive ? null : (data.activeBroadcastId ?? broadcast.id);
      setActiveBroadcastId(nextActiveId);
      setBroadcasts(prev => prev.map(item => ({ ...item, active: String(item.id) === String(nextActiveId) })));
      onActivated?.(data);
    } catch (err) {
      setError(err.message || 'Failed to update active broadcast');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Broadcasts</div>
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>Refresh</button>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--color-danger, #c62828)' }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : broadcasts.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No broadcasts yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {broadcasts.map(broadcast => {
            const isActive = String(activeBroadcastId) === String(broadcast.id);
            return (
              <div key={broadcast.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{broadcast.title || `Broadcast ${broadcast.id}`}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{broadcast.status || 'draft'}</div>
                </div>
                <button className={`btn btn--sm ${isActive ? 'btn--primary' : 'btn--ghost'}`} disabled={busyId === broadcast.id} onClick={() => toggleBroadcast(broadcast)}>
                  {busyId === broadcast.id ? '…' : isActive ? 'Active' : 'Activate'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
