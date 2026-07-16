import { useState } from 'react';
import { useActiveBroadcast } from '../hooks/useActiveBroadcast.js';

/**
 * Broadcast graphics browser for the DSK Control page (plan/broadcasts_next
 * Feature C) — mirror of the Planner's broadcast file panel, but for DSK
 * templates pinned to the active broadcast via `broadcast_assets`
 * (assetType 'graphic', assetRef = template id).
 *
 * Requires a Bearer JWT (the /broadcasts routes don't accept raw X-API-Key),
 * so the caller only renders this in sidebar mode where a session token exists.
 */
export function DskBroadcastAssetPanel({ serverUrl, token, templates = [] }) {
  const { broadcast, loading, error: loadError, reload } = useActiveBroadcast({
    backendUrl: serverUrl,
    token,
  });
  const [busyTemplateId, setBusyTemplateId] = useState(null);
  const [actionError, setActionError] = useState(null);

  // assetRef (template id, as string) → broadcast_assets row id, for unlink
  const pinnedRefToRowId = new Map(
    (broadcast?.assets || [])
      .filter(a => a.assetType === 'graphic')
      .map(a => [String(a.assetRef), a.id])
  );

  async function togglePin(template) {
    if (!broadcast) return;
    const ref = String(template.id);
    const rowId = pinnedRefToRowId.get(ref);
    setBusyTemplateId(template.id);
    setActionError(null);
    try {
      const url = rowId != null
        ? `${serverUrl}/broadcasts/${encodeURIComponent(broadcast.id)}/assets/${encodeURIComponent(rowId)}`
        : `${serverUrl}/broadcasts/${encodeURIComponent(broadcast.id)}/assets`;
      const res = await fetch(url, {
        method: rowId != null ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(rowId != null ? {} : { body: JSON.stringify({ assetType: 'graphic', assetRef: ref }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await reload();
    } catch (err) {
      setActionError(err.message || 'Failed to update broadcast graphics');
    } finally {
      setBusyTemplateId(null);
    }
  }

  const error = actionError || loadError;
  const pinnedTemplates = templates.filter(t => pinnedRefToRowId.has(String(t.id)));

  return (
    <div style={{ border: '1px solid #222', borderRadius: 8, padding: 12, marginBottom: 16, background: '#111' }}>
      <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Broadcast graphics</span>
        <span style={{ flex: 1 }} />
        <button onClick={reload} disabled={loading} style={{ background: '#1e1e1e', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
          Refresh
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: '#f88', marginBottom: 8 }}>{error}</div>}

      {loading && !broadcast ? (
        <div style={{ fontSize: 13, color: '#555' }}>Loading…</div>
      ) : !broadcast ? (
        <div style={{ fontSize: 13, color: '#555' }}>
          No active broadcast. Activate one on the project summary page to pin graphics to it.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#ddd', marginBottom: 8 }}>
            <span style={{ color: '#888' }}>Active: </span>
            {broadcast.title || `Broadcast ${broadcast.id}`}
            <span style={{ color: '#666', marginLeft: 8, fontSize: 11, textTransform: 'uppercase' }}>{broadcast.status}</span>
            <span style={{ color: '#888', marginLeft: 12, fontSize: 12 }}>
              {pinnedTemplates.length} pinned graphic{pinnedTemplates.length !== 1 ? 's' : ''}
            </span>
          </div>
          {templates.length === 0 ? (
            <div style={{ fontSize: 13, color: '#555' }}>No templates in this project yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {templates.map(t => {
                const pinned = pinnedRefToRowId.has(String(t.id));
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', border: '1px solid #222', borderRadius: 5, background: pinned ? '#14231a' : 'transparent' }}>
                    <span style={{ fontSize: 13, color: pinned ? '#cfffdc' : '#bbb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                    {pinned && <span style={{ fontSize: 10, color: '#44ff88', letterSpacing: 1 }}>PINNED</span>}
                    <button
                      onClick={() => togglePin(t)}
                      disabled={busyTemplateId === t.id}
                      style={{ background: pinned ? '#1e1e1e' : '#1a4a2e', border: `1px solid ${pinned ? '#444' : '#2d8a52'}`, color: pinned ? '#aaa' : '#cfffdc', borderRadius: 4, padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      {busyTemplateId === t.id ? '…' : pinned ? 'Unpin' : 'Pin'}
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
