import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { useToastContext } from '../../contexts/ToastContext';
import { Dialog } from '../Dialog.jsx';

/**
 * ScheduleTab — Broadcast schedule management at /broadcast > Schedule tab.
 * Lists recorded/scheduled broadcasts, allows creating new ones, editing
 * metadata (title, description, schedule), and linking videos.
 */
export function ScheduleTab() {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const backendUrl = session?.backendUrl;
  const token = session?.getSessionToken?.();

  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', scheduledStart: '' });

  const fetchBroadcasts = useCallback(async () => {
    if (!backendUrl || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/broadcasts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBroadcasts(Array.isArray(data.broadcasts) ? data.broadcasts : []);
    } catch (err) {
      setError(err.message);
      showToast(`Failed to load broadcasts: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token, showToast]);

  useEffect(() => { fetchBroadcasts(); }, [fetchBroadcasts]);

  const handleCreate = async () => {
    if (!backendUrl || !token) return;
    try {
      const res = await fetch(`${backendUrl}/broadcasts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: 'New Broadcast', status: 'draft' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Broadcast created', 'success');
      fetchBroadcasts();
    } catch (err) {
      showToast(`Failed to create broadcast: ${err.message}`, 'error');
    }
  };

  const handleEdit = (broadcast) => {
    setEditingId(broadcast.id);
    setEditForm({
      title: broadcast.title || '',
      description: broadcast.description || '',
      scheduledStart: broadcast.scheduledStart || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!backendUrl || !token || !editingId) return;
    try {
      const res = await fetch(`${backendUrl}/broadcasts/${editingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Broadcast updated', 'success');
      setEditingId(null);
      fetchBroadcasts();
    } catch (err) {
      showToast(`Failed to update broadcast: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!backendUrl || !token || !confirm('Delete this broadcast?')) return;
    try {
      const res = await fetch(`${backendUrl}/broadcasts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Broadcast deleted', 'success');
      fetchBroadcasts();
    } catch (err) {
      showToast(`Failed to delete broadcast: ${err.message}`, 'error');
    }
  };

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '—';
    }
  }

  return (
    <div className="schedule-tab settings-panel settings-panel--active">
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Broadcasts</h3>
          <button className="btn btn--primary btn--sm" onClick={handleCreate} disabled={loading}>
            + New Broadcast
          </button>
        </div>

        {error && <div style={{ color: 'var(--color-error)', marginBottom: 12, fontSize: 13 }}>{error}</div>}

        {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading broadcasts…</p>}

        {!loading && broadcasts.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '40px 20px' }}>
            No broadcasts yet. Create one to get started.
          </p>
        )}

        {!loading && broadcasts.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {broadcasts.map((bc) => (
              <div
                key={bc.id}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  padding: 12,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  alignItems: 'start',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>{bc.title || 'Untitled'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                    {bc.description && <div>{bc.description}</div>}
                    <div>Scheduled: {formatDate(bc.scheduledStart || bc.actualStart || bc.createdAt)}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    Status: <strong>{bc.status || 'draft'}</strong>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => handleEdit(bc)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => handleDelete(bc.id)}
                    style={{ color: 'var(--color-error)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingId && (
        <Dialog title="Edit Broadcast" onClose={() => setEditingId(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Title</label>
              <input
                className="settings-field__input"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Broadcast title"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Description</label>
              <textarea
                className="settings-field__input"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Optional description"
                style={{ width: '100%', minHeight: 80, fontFamily: 'var(--font-ui)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Scheduled Start (ISO)</label>
              <input
                type="datetime-local"
                className="settings-field__input"
                value={editForm.scheduledStart.slice(0, 16) || ''}
                onChange={(e) => {
                  const isoStr = e.target.value ? new Date(e.target.value).toISOString() : '';
                  setEditForm({ ...editForm, scheduledStart: isoStr });
                }}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button className="btn btn--primary btn--sm" onClick={handleSaveEdit}>
                Save Changes
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
