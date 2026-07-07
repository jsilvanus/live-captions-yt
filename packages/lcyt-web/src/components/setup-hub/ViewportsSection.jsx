import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { ViewportsIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';

const EMPTY_NEW = { name: '', label: '', viewportType: 'vertical', width: 1080, height: 1920 };

/**
 * ViewportsSection — named DSK display regions, wired to the real
 * `GET/POST/PUT/DELETE /dsk/:apikey/viewports` endpoints (same API
 * `DskViewportsPage.jsx` uses). Covers the basic fields (label/type/
 * width/height) that fit an item-row + dialog; text-layer bindings and
 * "present to screen" are a full editor in their own right and stay on the
 * full `/graphics/viewports` page — the edit dialog links there instead of
 * reimplementing them.
 */
export function ViewportsSection() {
  const session = useSessionContext();
  const backendUrl = session?.backendUrl;
  const apiKey = session?.apiKey;

  const [viewports, setViewports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newVp, setNewVp] = useState(EMPTY_NEW);
  const [editingName, setEditingName] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const apiFetch = useCallback((path, opts = {}) => fetch(`${backendUrl}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, ...(opts.headers || {}) },
  }), [backendUrl, apiKey]);

  const load = useCallback(async () => {
    if (!backendUrl || !apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setViewports(data.viewports || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, apiKey, apiFetch]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newVp.name.trim()) return;
    setError(null);
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports`, { method: 'POST', body: JSON.stringify(newVp) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAddOpen(false);
      setNewVp(EMPTY_NEW);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function openEdit(vp) {
    setEditingName(vp.name);
    setEditDraft({ label: vp.label ?? '', viewportType: vp.viewportType, width: vp.width, height: vp.height });
  }

  async function handleSaveEdit() {
    if (!editingName || !editDraft) return;
    setError(null);
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports/${encodeURIComponent(editingName)}`, { method: 'PUT', body: JSON.stringify(editDraft) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEditingName(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete() {
    if (!editingName) return;
    setError(null);
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports/${encodeURIComponent(editingName)}`, { method: 'DELETE' });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `HTTP ${res.status}`); }
      setEditingName(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <SetupCard
      id="viewports"
      icon={ViewportsIcon}
      color="accent"
      title="Viewports"
      description="Named DSK display regions (e.g. vertical-left, landscape)."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => setAddOpen(true) }}
      footerLink={{ label: 'Manage in Graphics → Viewports', href: '/graphics/viewports' }}
    >
      {!apiKey ? (
        <p className="setup-card__empty">Connect to a project to configure viewports.</p>
      ) : loading ? (
        <p className="setup-card__empty">Loading…</p>
      ) : viewports.length === 0 ? (
        <p className="setup-card__empty">No viewports — click Add to configure one.</p>
      ) : (
        viewports.map(vp => (
          <SetupItemRow
            key={vp.name}
            name={vp.label || vp.name}
            meta={`${vp.width}×${vp.height} · ${vp.viewportType}`}
            onSettings={() => openEdit(vp)}
          />
        ))
      )}

      {addOpen && (
        <Dialog title="Add viewport" onClose={() => setAddOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="settings-field">
              <label className="settings-field__label">Name (slug) *</label>
              <input className="settings-field__input" value={newVp.name}
                onChange={e => setNewVp(v => ({ ...v, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))}
                placeholder="vertical-left" autoFocus />
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Label</label>
              <input className="settings-field__input" value={newVp.label}
                onChange={e => setNewVp(v => ({ ...v, label: e.target.value }))} placeholder="Vertical Screen 1" />
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Type</label>
              <select className="settings-field__input" value={newVp.viewportType} onChange={e => {
                const vt = e.target.value;
                setNewVp(v => ({ ...v, viewportType: vt, width: vt === 'vertical' ? 1080 : 1920, height: vt === 'vertical' ? 1920 : 1080 }));
              }}>
                <option value="landscape">Landscape</option>
                <option value="vertical">Vertical</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Width</label>
                <input className="settings-field__input" type="number" value={newVp.width}
                  onChange={e => setNewVp(v => ({ ...v, width: parseInt(e.target.value, 10) || v.width }))} />
              </div>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Height</label>
                <input className="settings-field__input" type="number" value={newVp.height}
                  onChange={e => setNewVp(v => ({ ...v, height: parseInt(e.target.value, 10) || v.height }))} />
              </div>
            </div>
            {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleCreate} disabled={!newVp.name.trim()}>Create</button>
            </div>
          </div>
        </Dialog>
      )}

      {editingName && editDraft && (
        <Dialog title={editingName} onClose={() => setEditingName(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="settings-field">
              <label className="settings-field__label">Label</label>
              <input className="settings-field__input" value={editDraft.label}
                onChange={e => setEditDraft(v => ({ ...v, label: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Type</label>
                <select className="settings-field__input" value={editDraft.viewportType}
                  onChange={e => setEditDraft(v => ({ ...v, viewportType: e.target.value }))}>
                  <option value="landscape">Landscape</option>
                  <option value="vertical">Vertical</option>
                </select>
              </div>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Width</label>
                <input className="settings-field__input" type="number" value={editDraft.width}
                  onChange={e => setEditDraft(v => ({ ...v, width: parseInt(e.target.value, 10) || v.width }))} />
              </div>
              <div className="settings-field" style={{ flex: 1 }}>
                <label className="settings-field__label">Height</label>
                <input className="settings-field__input" type="number" value={editDraft.height}
                  onChange={e => setEditDraft(v => ({ ...v, height: parseInt(e.target.value, 10) || v.height }))} />
              </div>
            </div>
            {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <a href="/graphics/viewports" style={{ fontSize: 12, color: 'var(--color-accent)' }}>
                Advanced settings (text layers, present to screen) →
              </a>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--danger" onClick={handleDelete}>Delete</button>
                <button className="btn btn--primary" onClick={handleSaveEdit}>Save</button>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
