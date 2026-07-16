import { useCallback, useEffect, useMemo, useState } from 'react';

export function PlannerBroadcastFilePanel({ backendUrl, token, projectKey, serverRundowns = [] }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [activeBroadcastId, setActiveBroadcastId] = useState(null);
  const [pinnedFileIds, setPinnedFileIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busyFileId, setBusyFileId] = useState(null);
  const [error, setError] = useState(null);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token,
    'X-Project-Id': projectKey,
  }), [projectKey, token]);

  const load = useCallback(async () => {
    if (!backendUrl || !token || !projectKey) {
      setBroadcasts([]);
      setActiveBroadcastId(null);
      setPinnedFileIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch(`${backendUrl}/broadcasts`, { headers }),
        fetch(`${backendUrl}/broadcasts/active`, { headers }),
      ]);
      const listData = await listRes.json().catch(() => ({}));
      const activeData = await activeRes.json().catch(() => ({}));
      if (!listRes.ok) throw new Error(listData.error || `HTTP ${listRes.status}`);
      if (!activeRes.ok) throw new Error(activeData.error || `HTTP ${activeRes.status}`);
      const nextBroadcasts = Array.isArray(listData.broadcasts) ? listData.broadcasts : [];
      setBroadcasts(nextBroadcasts);
      const nextActiveId = activeData.activeBroadcastId || null;
      setActiveBroadcastId(nextActiveId);
      if (!nextActiveId) {
        setPinnedFileIds(new Set());
      } else {
        const filesRes = await fetch(`${backendUrl}/broadcasts/${encodeURIComponent(nextActiveId)}/files`, { headers });
        const filesData = await filesRes.json().catch(() => ({}));
        if (!filesRes.ok) throw new Error(filesData.error || `HTTP ${filesRes.status}`);
        const ids = new Set((filesData.files || []).map(file => String(file.id)));
        setPinnedFileIds(ids);
      }
    } catch (err) {
      setError(err.message || 'Failed to load broadcast files');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers, projectKey, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleFile(file) {
    if (!activeBroadcastId) return;
    const fileId = String(file.id);
    const alreadyPinned = pinnedFileIds.has(fileId);
    const url = `${backendUrl}/broadcasts/${encodeURIComponent(activeBroadcastId)}/files${alreadyPinned ? `/${encodeURIComponent(fileId)}` : ''}`;
    setBusyFileId(fileId);
    try {
      const res = await fetch(url, {
        method: alreadyPinned ? 'DELETE' : 'POST',
        headers,
        ...(alreadyPinned ? {} : { body: JSON.stringify({ fileId }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPinnedFileIds(prev => {
        const next = new Set(prev);
        if (alreadyPinned) next.delete(fileId);
        else next.add(fileId);
        return next;
      });
    } catch (err) {
      setError(err.message || 'Failed to update broadcast file scope');
    } finally {
      setBusyFileId(null);
    }
  }

  const activeBroadcast = broadcasts.find(item => String(item.id) === String(activeBroadcastId)) || null;

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, background: 'var(--color-surface-elevated)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Broadcast file scope</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            Hard scope: all project rundowns. Soft scope: rundowns pinned to the active broadcast.
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>Refresh</button>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--color-danger, #c62828)' }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading broadcasts…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Active broadcast</div>
            {activeBroadcast ? (
              <div style={{ fontSize: 12, color: 'var(--color-text)' }}>{activeBroadcast.title || `Broadcast ${activeBroadcast.id}`}</div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No active broadcast selected from Summary. Choose one to pin files.</div>
            )}
          </div>
          {serverRundowns.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No project rundowns yet. Save one from the planner toolbar to start managing scope.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {serverRundowns.map(file => {
                const fileId = String(file.id);
                const pinned = pinnedFileIds.has(fileId);
                return (
                  <div key={file.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{file.displayName || file.filename || `Rundown ${file.id}`}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{pinned ? 'Pinned to active broadcast' : 'Available in project scope'}</div>
                    </div>
                    <button
                      className={`btn btn--sm ${pinned ? 'btn--ghost' : 'btn--primary'}`}
                      disabled={!activeBroadcastId || busyFileId === fileId}
                      onClick={() => toggleFile(file)}
                    >
                      {busyFileId === fileId ? '…' : pinned ? 'Unpin' : 'Pin'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
