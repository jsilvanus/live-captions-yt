import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { CaptionTargetsIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';

const TYPES = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'generic', label: 'Generic' },
  { value: 'viewer', label: 'Viewer' },
];

const EMPTY_NEW = { type: 'youtube', streamKey: '', url: '', viewerKey: '', noBatch: false };

function targetLabel(t) {
  if (t.type === 'youtube') return 'YouTube';
  if (t.type === 'viewer') return 'Viewer';
  try { return new URL(t.url).hostname; } catch { return 'Generic'; }
}

function targetSubtitle(t) {
  if (t.type === 'youtube') return t.streamKey ? `••••${t.streamKey.slice(-4)}` : 'No stream key set';
  if (t.type === 'viewer') return t.viewerKey ? `/view/${t.viewerKey}` : 'No viewer key set';
  return t.url || 'No URL set';
}

/**
 * CaptionTargetsSection — YouTube/generic/viewer caption delivery targets,
 * per the mockup's `CaptionTargetsCard.dc.html` (item rows are delete-only —
 * no edit/toggle in that design; add-and-remove is the whole interaction).
 * Wired against the real `GET/POST/PUT/DELETE /targets` routes from PR #239
 * (`docs/plans/plan_selfservice_config_backend.md` §1) — these are now the
 * server-persisted source of truth `POST/PATCH /live` falls back to when its
 * `targets` field is omitted, decoupled from the pre-existing localStorage-
 * only `lib/targetConfig.js` the `/captions` CC → Targets panel still reads.
 */
export function CaptionTargetsSection() {
  const session = useSessionContext();
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newTarget, setNewTarget] = useState(EMPTY_NEW);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const authedFetch = useCallback((path, opts = {}) => {
    const token = session.getSessionToken?.();
    return fetch(`${session.backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session]);

  const load = useCallback(async () => {
    if (!session?.connected) return;
    setLoading(true);
    try {
      const r = await authedFetch('/targets');
      if (r.ok) setTargets((await r.json()).targets || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    setError(null);
    const body = { type: newTarget.type };
    if (newTarget.type === 'youtube') body.streamKey = newTarget.streamKey.trim();
    if (newTarget.type === 'generic') body.url = newTarget.url.trim();
    if (newTarget.type === 'viewer') body.viewerKey = newTarget.viewerKey.trim();
    body.noBatch = newTarget.noBatch;
    try {
      const r = await authedFetch('/targets', { method: 'POST', body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setAddOpen(false);
      setNewTarget(EMPTY_NEW);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(target) {
    try {
      const r = await authedFetch(`/targets/${target.id}`, { method: 'DELETE' });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const canCreate = newTarget.type === 'youtube' ? !!newTarget.streamKey.trim()
    : newTarget.type === 'generic' ? !!newTarget.url.trim()
    : !!newTarget.viewerKey.trim();

  return (
    <SetupCard
      id="caption-targets"
      icon={CaptionTargetsIcon}
      color="accent"
      title="Caption targets"
      description="Where captions are delivered (YouTube, generic RTMP/HTTP, viewer)."
      status="ready"
      headerAction={{ label: 'Add', onClick: () => setAddOpen(true) }}
    >
      {!session?.connected ? (
        <p className="setup-card__empty">Connect to a project to configure caption targets.</p>
      ) : loading ? (
        <p className="setup-card__empty">Loading…</p>
      ) : targets.length === 0 ? (
        <p className="setup-card__empty">No caption targets configured</p>
      ) : (
        targets.map(t => (
          <SetupItemRow
            key={t.id}
            name={targetLabel(t)}
            meta={targetSubtitle(t)}
            faded={!t.enabled}
            onDelete={() => setConfirmDelete(t)}
          />
        ))
      )}

      {addOpen && (
        <Dialog title="Add caption target" onClose={() => setAddOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="settings-field">
              <label className="settings-field__label">Type</label>
              <select className="settings-field__input" value={newTarget.type}
                onChange={e => setNewTarget(t => ({ ...EMPTY_NEW, type: e.target.value }))}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {newTarget.type === 'youtube' && (
              <div className="settings-field">
                <label className="settings-field__label">Stream key *</label>
                <input className="settings-field__input" type="password" autoComplete="off"
                  value={newTarget.streamKey} onChange={e => setNewTarget(t => ({ ...t, streamKey: e.target.value }))}
                  placeholder="xxxx-xxxx-xxxx-xxxx-xxxx" autoFocus />
              </div>
            )}
            {newTarget.type === 'generic' && (
              <div className="settings-field">
                <label className="settings-field__label">URL *</label>
                <input className="settings-field__input" value={newTarget.url}
                  onChange={e => setNewTarget(t => ({ ...t, url: e.target.value }))}
                  placeholder="https://example.com/captions" autoFocus />
              </div>
            )}
            {newTarget.type === 'viewer' && (
              <div className="settings-field">
                <label className="settings-field__label">Viewer key *</label>
                <input className="settings-field__input" value={newTarget.viewerKey}
                  onChange={e => setNewTarget(t => ({ ...t, viewerKey: e.target.value }))}
                  placeholder="my-event-viewer" autoFocus />
                <span className="settings-field__hint">At least 3 characters — letters, digits, hyphens, underscores.</span>
              </div>
            )}
            <label className="settings-checkbox">
              <input type="checkbox" checked={newTarget.noBatch}
                onChange={e => setNewTarget(t => ({ ...t, noBatch: e.target.checked }))} />
              Send captions individually (no batching)
            </label>
            {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleCreate} disabled={!canCreate}>Create</button>
            </div>
          </div>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog title="Delete target?" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            Delete the <strong>{targetLabel(confirmDelete)}</strong> caption target?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
