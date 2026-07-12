import { useState, useEffect, useCallback, useContext, forwardRef, useImperativeHandle } from 'react';
import { SessionContext } from '../contexts/SessionContext';
import { Dialog } from './Dialog.jsx';
import { SetupItemRow } from './setup-hub/SetupCard.jsx';
import { TargetRow } from './panels/TargetRow.jsx';

const EMPTY_NEW = { enabled: true, type: 'youtube', streamKey: '', url: '', viewerKey: '', noBatch: false };

function targetLabel(t) {
  if (t.type === 'youtube') return 'YouTube';
  if (t.type === 'viewer') return 'Viewer';
  try { return new URL(t.url).hostname; } catch { return 'Generic'; }
}

function targetMeta(t) {
  if (t.type === 'youtube') return t.streamKey ? `••••${t.streamKey.slice(-4)}` : 'No stream key set';
  if (t.type === 'viewer') return t.viewerKey ? `/view/${t.viewerKey}` : 'No viewer key set';
  return t.url || 'No URL set';
}

function isValidTarget(t) {
  if (t.type === 'youtube') return !!(t.streamKey || '').trim();
  if (t.type === 'generic') return !!(t.url || '').trim();
  if (t.type === 'viewer') return /^[a-zA-Z0-9_-]{3,}$/.test(t.viewerKey || '');
  return false;
}

/**
 * CaptionTargetsManager — full add/edit/delete for caption delivery targets,
 * wired to the real `GET/POST/PUT/DELETE /targets` routes (PR #239,
 * `docs/plans/plan_selfservice_config_backend.md` §1). Reuses `TargetRow.jsx`
 * (the same editor `TargetsPanel`/`CCModal` use for the localStorage-only
 * config) as Dialog content — `typeLocked`/`hideRemove`/`hideFormat` opt the
 * row into server-backed semantics (type immutable after creation, no
 * inline remove, no `format` field — that column doesn't exist server-side
 * yet) without changing `TargetsPanel`'s own default behavior.
 *
 * Session Bearer auth (`getSessionToken()`), matching `/stt/config`'s
 * convention — *not* the `X-Admin-Key`/apiKey-in-URL pattern the device
 * managers (Cameras/Mixers/...) use, since `/targets` is session-scoped.
 */
export const CaptionTargetsManager = forwardRef(function CaptionTargetsManager({ embedded = false }, ref) {
  const session = useContext(SessionContext);
  const backendUrl = session?.backendUrl || '';

  const [targets, setTargets] = useState([]);
  const [icons, setIcons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | target object
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const authedFetch = useCallback((path, opts = {}) => {
    const token = session?.getSessionToken?.();
    return fetch(`${backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session, backendUrl]);

  const load = useCallback(async () => {
    if (!session?.connected) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch('/targets');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setTargets(data.targets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.connected) return;
    session.listIcons?.().then(data => setIcons(data.icons || [])).catch(() => setIcons([]));
  }, [session?.connected, session]);

  useImperativeHandle(ref, () => ({ openAdd: () => { setEditing('new'); setDraft(EMPTY_NEW); } }));

  function openEdit(target) {
    setEditing(target);
    // TargetRow's textarea models `headers` as a raw JSON string; the server
    // gives us it back already parsed as an object (see caption-targets.js's
    // formatRow()) — stringify for display, parsed again on save below.
    setDraft({ ...target, headers: target.headers ? JSON.stringify(target.headers, null, 2) : '' });
  }

  async function handleSave() {
    if (!draft || !isValidTarget(draft)) return;
    setError(null);
    let headers;
    if (draft.type === 'generic' && draft.headers) {
      try { headers = JSON.parse(draft.headers); } catch { setError('Headers must be valid JSON'); return; }
    }
    const isNew = editing === 'new';
    const body = isNew
      ? { type: draft.type, streamKey: draft.streamKey, url: draft.url, headers, viewerKey: draft.viewerKey, iconId: draft.iconId, iconEnabled: draft.iconEnabled, noBatch: draft.noBatch }
      : { enabled: draft.enabled, streamKey: draft.streamKey, url: draft.url, headers, viewerKey: draft.viewerKey, iconId: draft.iconId, iconEnabled: draft.iconEnabled, noBatch: draft.noBatch };
    try {
      const r = await authedFetch(isNew ? '/targets' : `/targets/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setEditing(null);
      setDraft(null);
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

  return (
    <div style={embedded ? undefined : { padding: 20, maxWidth: 700, margin: '0 auto' }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Caption targets</h2>
          <button className="btn btn--primary btn--sm" onClick={() => { setEditing('new'); setDraft(EMPTY_NEW); }} disabled={!!editing}>
            + Add target
          </button>
        </div>
      )}
      {error && <div style={{ color: 'var(--color-error)', margin: embedded ? '0 18px 12px' : '0 0 12px', fontSize: 13 }}>{error}</div>}

      {editing && draft && (
        <Dialog title={editing === 'new' ? 'Add caption target' : targetLabel(editing)} onClose={() => { setEditing(null); setDraft(null); }} width={600}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TargetRow
              entry={draft}
              onChange={setDraft}
              backendUrl={backendUrl}
              icons={icons}
              typeLocked={editing !== 'new'}
              hideRemove
              hideFormat
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={!isValidTarget(draft)}>
                {editing === 'new' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', padding: embedded ? '0 18px 14px' : 0 }}>Loading…</p>
      ) : !session?.connected ? (
        <p className={embedded ? 'setup-card__empty' : undefined} style={embedded ? undefined : { color: 'var(--color-text-muted)' }}>Connect to a project to configure caption targets.</p>
      ) : targets.length === 0 ? (
        <p className={embedded ? 'setup-card__empty' : undefined} style={embedded ? undefined : { color: 'var(--color-text-muted)' }}>No caption targets configured</p>
      ) : (
        <div className={embedded ? undefined : 'setup-card'}>
          {targets.map(t => (
            <SetupItemRow
              key={t.id}
              name={targetLabel(t)}
              meta={targetMeta(t)}
              faded={!t.enabled}
              onSettings={() => openEdit(t)}
              onDelete={() => setConfirmDelete(t)}
            />
          ))}
        </div>
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
    </div>
  );
});

/** TargetCaptionsPage — standalone route wrapper around CaptionTargetsManager. */
export function TargetCaptionsPage() {
  return <CaptionTargetsManager />;
}
