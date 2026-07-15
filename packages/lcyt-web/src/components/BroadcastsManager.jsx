/**
 * BroadcastsManager — Broadcasts scheduler & manager for the setup hub.
 * Displays a list of broadcasts with create/edit/delete operations.
 * Supports title, description, schedule, and thumbnail URL fields.
 */
import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { Dialog } from './Dialog';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  const colors = {
    draft: '#999',
    scheduled: '#0066cc',
    live: '#cc0000',
    completed: '#008000',
    archived: '#999',
  };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      backgroundColor: colors[status] || '#ccc',
      color: 'white',
    }}>
      {status || 'draft'}
    </span>
  );
}

export function BroadcastsManager() {
  useProjectRequired();
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const token = session?.getSessionToken?.() ?? null;

  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingBroadcast, setEditingBroadcast] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    if (!connected || !backendUrl || !token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      params.append('includeArchived', '1');

      const response = await fetch(
        `${backendUrl}/broadcasts?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend error (${response.status}): ${text.slice(0, 100)}`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to load broadcasts');
      setBroadcasts(Array.isArray(data.broadcasts) ? data.broadcasts : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [connected, backendUrl, token, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(payload) {
    if (!token || !backendUrl) return;
    try {
      const response = await fetch(
        `${backendUrl}/broadcasts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }
      );
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend error (${response.status}): ${text.slice(0, 100)}`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to create broadcast');
      setIsCreating(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(id, payload) {
    if (!token || !backendUrl) return;
    try {
      const response = await fetch(
        `${backendUrl}/broadcasts/${id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }
      );
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend error (${response.status}): ${text.slice(0, 100)}`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to update broadcast');
      setEditingBroadcast(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!token || !backendUrl || !confirm('Delete this broadcast?')) return;
    try {
      const response = await fetch(
        `${backendUrl}/broadcasts/${id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend error (${response.status}): ${text.slice(0, 100)}`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to delete broadcast');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!connected) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
        Connect to a project to manage broadcasts.
      </div>
    );
  }

  const filteredBroadcasts = broadcasts.filter(b => {
    if (statusFilter === 'all') return true;
    return b.status === statusFilter;
  });

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'hidden' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Broadcasts Scheduler</h2>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => setIsCreating(true)}
          >
            + New Broadcast
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['all', 'draft', 'scheduled', 'live', 'completed'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: 4,
                backgroundColor: statusFilter === status ? '#0066cc' : '#eee',
                color: statusFilter === status ? 'white' : '#333',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: statusFilter === status ? 600 : 400,
              }}
            >
              {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12,
          backgroundColor: '#fee',
          border: '1px solid #f88',
          borderRadius: 4,
          color: '#c33',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#999' }}>Loading…</p>
        ) : filteredBroadcasts.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999' }}>No broadcasts yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {filteredBroadcasts.map(broadcast => (
              <div
                key={broadcast.id}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  padding: 12,
                  backgroundColor: '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = '#f0f0f0';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = '#fafafa';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 600 }}>
                      {broadcast.title || `Broadcast ${broadcast.id.slice(0, 6)}`}
                    </h3>
                    {broadcast.description && (
                      <p style={{ margin: '0 0 4px 0', fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {broadcast.description}
                      </p>
                    )}
                  </div>
                  <div style={{ marginLeft: 8 }}>
                    {statusBadge(broadcast.status)}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                  {broadcast.scheduledStart ? (
                    <div>📅 {formatDate(broadcast.scheduledStart)}</div>
                  ) : broadcast.actualStart ? (
                    <div>▶ {formatDate(broadcast.actualStart)}</div>
                  ) : (
                    <div>Created {formatDate(broadcast.createdAt)}</div>
                  )}
                </div>

                {broadcast.youtubeVideoIds && Array.isArray(broadcast.youtubeVideoIds) && broadcast.youtubeVideoIds.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {broadcast.youtubeVideoIds.map(id => {
                      const url = id.startsWith('http') ? id : `https://www.youtube.com/watch?v=${id}`;
                      return (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: '#0066cc', textDecoration: 'none', display: 'block' }}
                        >
                          ▶ Watch on YouTube
                        </a>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn--sm"
                    onClick={() => setEditingBroadcast(broadcast)}
                    style={{ flex: 1 }}
                  >
                    Edit
                  </button>
                  {broadcast.status !== 'live' && (
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => handleDelete(broadcast.id)}
                      style={{ flex: 1 }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isCreating && (
        <BroadcastDialog
          title="New Broadcast"
          onClose={() => setIsCreating(false)}
          onSave={payload => handleCreate(payload)}
        />
      )}

      {editingBroadcast && (
        <BroadcastDialog
          title="Edit Broadcast"
          broadcast={editingBroadcast}
          onClose={() => setEditingBroadcast(null)}
          onSave={payload => handleUpdate(editingBroadcast.id, payload)}
        />
      )}
    </div>
  );
}

function BroadcastDialog({ title, broadcast, onClose, onSave }) {
  const [formData, setFormData] = useState({
    title: broadcast?.title || '',
    description: broadcast?.description || '',
    scheduledStart: broadcast?.scheduledStart || '',
    scheduledEnd: broadcast?.scheduledEnd || '',
    thumbnailUrl: broadcast?.thumbnailUrl || '',
    recordEnabled: broadcast?.recordEnabled ?? false,
  });
  const [saving, setSaving] = useState(false);

  function handleChange(field, value) {
    setFormData(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        title: formData.title || `Broadcast ${new Date().toLocaleDateString()}`,
        description: formData.description,
        scheduledStart: formData.scheduledStart || undefined,
        scheduledEnd: formData.scheduledEnd || undefined,
        recordEnabled: formData.recordEnabled ? 1 : 0,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 400 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Title</label>
          <input
            type="text"
            value={formData.title}
            onChange={e => handleChange('title', e.target.value)}
            placeholder="Broadcast title"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 14 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Description</label>
          <textarea
            value={formData.description}
            onChange={e => handleChange('description', e.target.value)}
            placeholder="Broadcast description (optional)"
            rows={3}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 14 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Scheduled Start (ISO)</label>
          <input
            type="text"
            value={formData.scheduledStart}
            onChange={e => handleChange('scheduledStart', e.target.value)}
            placeholder="2026-07-15T18:00:00"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 14 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Scheduled End (ISO)</label>
          <input
            type="text"
            value={formData.scheduledEnd}
            onChange={e => handleChange('scheduledEnd', e.target.value)}
            placeholder="2026-07-15T19:00:00"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 14 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Thumbnail URL</label>
          <input
            type="url"
            value={formData.thumbnailUrl}
            onChange={e => handleChange('thumbnailUrl', e.target.value)}
            placeholder="https://example.com/thumbnail.jpg"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid #ddd', fontSize: 14 }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={formData.recordEnabled}
            onChange={e => handleChange('recordEnabled', e.target.checked)}
          />
          Enable recording
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={handleSave}
            disabled={saving || !formData.title.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
