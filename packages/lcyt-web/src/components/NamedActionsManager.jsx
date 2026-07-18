/**
 * Named Actions manager — CRUD for `@name` composite action macros
 * (docs/plans/plan_named_actions.md). A definition is the raw composite
 * expression: a `|`-separated ORDERED sequence of atoms (`metacode:value`)
 * and `@name` references, e.g.
 *   audio:start | graphics:+banner | section:Intro | @lower-thirds
 * Backend is pure storage (`/actions`); parsing/execution are client-side.
 *
 * Two homes: the standalone `/actions` page (`NamedActionsPage.jsx`, reached
 * from the Assets page's "Global actions" card) and, embedded (`embedded`
 * prop, same convention as `CuesManager`/`LanguagesManager`), the Planner's
 * right-column `PlannerAssistPanel` Actions tab.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { Dialog } from './Dialog.jsx';
import { SetupItemRow } from './setup-hub/SetupCard.jsx';

const EMPTY_DRAFT = { name: '', slug: '', definition: '', description: '' };

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function actionMeta(action) {
  const def = action.definition || '';
  return def.length > 60 ? `${def.slice(0, 60)}…` : def || '(empty definition)';
}

export function NamedActionsManager({ embedded = false }) {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;

  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);

  const [editing, setEditing] = useState(null); // null | 'new' | action object
  const [draft, setDraft] = useState(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const authHeaders = useCallback(() => {
    const token = session?.getSessionToken?.();
    return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : null;
  }, [session]);

  const load = useCallback(async () => {
    const headers = authHeaders();
    if (!connected || !backendUrl || !headers) { setActions([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/actions`, { headers });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setActions(Array.isArray(data.actions) ? data.actions : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [connected, backendUrl, authHeaders]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setFormError(null);
    setEditing('new');
    setSlugTouched(false);
    setDraft({ ...EMPTY_DRAFT });
  }

  function openEdit(action) {
    setFormError(null);
    setEditing(action);
    setSlugTouched(true);
    setDraft({
      name: action.name || '',
      slug: action.slug || '',
      definition: action.definition || '',
      description: action.description || '',
    });
  }

  function closeDialog() {
    setEditing(null);
    setDraft(null);
    setFormError(null);
  }

  async function handleSave() {
    if (!draft || !draft.name.trim()) { setFormError('Name is required.'); return; }
    const slug = draft.slug || slugify(draft.name);
    if (!slug) { setFormError('A valid slug (lowercase, hyphens) is required.'); return; }
    setFormError(null);

    const headers = authHeaders();
    if (!headers) return;
    const isNew = editing === 'new';
    const body = JSON.stringify({ name: draft.name.trim(), slug, definition: draft.definition, description: draft.description || null });
    const url = isNew ? `${backendUrl}/actions` : `${backendUrl}/actions/${encodeURIComponent(editing.slug)}`;

    try {
      const r = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers, body });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      closeDialog();
      load();
    } catch (e) {
      setFormError(e.message);
    }
  }

  async function handleDelete(action) {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const r = await fetch(`${backendUrl}/actions/${encodeURIComponent(action.slug)}`, { method: 'DELETE', headers });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={embedded ? { padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } : { padding: 20, maxWidth: 720, margin: '0 auto' }}>
      {embedded ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn--primary btn--sm" onClick={openNew} disabled={!!editing}>
            + Add action
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Named Actions</h1>
            <button className="btn btn--primary btn--sm" onClick={openNew} disabled={!!editing}>
              + Add action
            </button>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Composite action macros invoked from a caption file with <code>{'<!-- action: @name -->'}</code>.
            A definition is a <code>|</code>-separated ordered sequence of atoms (<code>metacode:value</code>) and{' '}
            <code>@name</code> references — e.g. <code>audio:start | graphics:+banner | section:Intro</code>. They run on send.
          </p>
        </>
      )}

      {error && <div style={{ color: 'var(--color-error)', margin: '0 0 12px', fontSize: 13 }}>{error}</div>}

      {editing && draft && (
        <Dialog title={editing === 'new' ? 'Add named action' : `Edit @${editing.slug}`} onClose={closeDialog} width={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {formError && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{formError}</div>}

            <div className="settings-field">
              <label className="settings-field__label">Name</label>
              <input
                className="settings-field__input"
                type="text"
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) }))}
                placeholder="Lower thirds on"
              />
            </div>

            <div className="settings-field">
              <label className="settings-field__label">Slug (@-addressable)</label>
              <input
                className="settings-field__input"
                type="text"
                value={draft.slug}
                disabled={editing !== 'new'}
                onChange={e => { setSlugTouched(true); setDraft(d => ({ ...d, slug: slugify(e.target.value) })); }}
                placeholder="lower-thirds"
              />
              <span className="settings-field__hint">Lowercase letters, digits, and hyphens. Can't be changed after creation.</span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label">Definition</label>
              <textarea
                className="settings-field__input"
                rows={3}
                style={{ fontFamily: 'monospace' }}
                value={draft.definition}
                onChange={e => setDraft(d => ({ ...d, definition: e.target.value }))}
                placeholder="audio:start | graphics:+banner | section:Intro | @other"
              />
              <span className="settings-field__hint">Ordered atoms separated by | — runs once, in order, when the caption is sent.</span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label">Description (optional)</label>
              <input
                className="settings-field__input"
                type="text"
                value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={closeDialog}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={!draft.name.trim()}>
                {editing === 'new' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : !connected ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Connect to a project to manage named actions.</p>
      ) : actions.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No named actions yet — add one to get started.</p>
      ) : (
        <div className="setup-card">
          {actions.map(action => (
            <SetupItemRow
              key={action.slug}
              name={action.name || action.slug}
              meta={actionMeta(action)}
              badge={`@${action.slug}`}
              onSettings={() => openEdit(action)}
              onDelete={() => setConfirmDelete(action)}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <Dialog title="Delete named action?" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            Delete <strong>@{confirmDelete.slug}</strong>?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export default NamedActionsManager;
