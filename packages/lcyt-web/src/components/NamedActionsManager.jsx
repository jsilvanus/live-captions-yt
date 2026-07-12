/**
 * Named Actions manager — CRUD for `@name` composite action macros
 * (docs/plans/plan_named_actions.md). Rendered on the Assets page.
 *
 * A definition is the raw composite expression: a `|`-separated ORDERED sequence
 * of atoms (`metacode:value`) and `@name` references, e.g.
 *   audio:start | graphics:+banner | section:Intro | @lower-thirds
 * Backend is pure storage (`/actions`); parsing/execution are client-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';

const EMPTY = { name: '', slug: '', definition: '', description: '' };

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function NamedActionsManager() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;

  const [actions, setActions] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingSlug, setEditingSlug] = useState(null);
  const [error, setError] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const authHeaders = useCallback(() => {
    const token = session?.getSessionToken?.();
    return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : null;
  }, [session]);

  const load = useCallback(async () => {
    const headers = authHeaders();
    if (!connected || !backendUrl || !headers) { setActions([]); return; }
    try {
      const r = await fetch(`${backendUrl}/actions`, { headers });
      const data = r.ok ? await r.json() : null;
      setActions(data?.actions || []);
    } catch { /* leave as-is */ }
  }, [connected, backendUrl, authHeaders]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm(EMPTY); setEditingSlug(null); setSlugTouched(false); setError(''); };

  const save = async () => {
    setError('');
    const headers = authHeaders();
    if (!headers) return;
    const slug = form.slug || slugify(form.name);
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!slug) { setError('A valid slug (lowercase, hyphens) is required.'); return; }
    const body = JSON.stringify({ name: form.name.trim(), slug, definition: form.definition, description: form.description || null });
    const url = editingSlug ? `${backendUrl}/actions/${encodeURIComponent(editingSlug)}` : `${backendUrl}/actions`;
    const method = editingSlug ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, headers, body });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || `Save failed (${r.status})`); return; }
      resetForm();
      load();
    } catch (e) { setError(e.message); }
  };

  const edit = (a) => {
    setForm({ name: a.name, slug: a.slug, definition: a.definition || '', description: a.description || '' });
    setEditingSlug(a.slug);
    setSlugTouched(true);
    setError('');
  };

  const remove = async (slug) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      await fetch(`${backendUrl}/actions/${encodeURIComponent(slug)}`, { method: 'DELETE', headers });
      if (editingSlug === slug) resetForm();
      load();
    } catch { /* ignore */ }
  };

  if (!connected) {
    return (
      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Named Actions</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>Connect to a project to manage named actions.</p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Named Actions</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Composite action macros invoked from a caption file with <code>{'<!-- action: @name -->'}</code>.
        A definition is a <code>|</code>-separated ordered sequence of atoms
        (<code>metacode:value</code>) and <code>@name</code> references — e.g.{' '}
        <code>audio:start | graphics:+banner | section:Intro | @lower-thirds</code>. They run on send.
      </p>

      {actions.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
              <th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>@slug</th>
              <th style={{ padding: '6px 8px' }}>Definition</th>
              <th style={{ padding: '6px 8px', width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.slug} style={{ borderTop: '1px solid var(--color-border, #333)' }}>
                <td style={{ padding: '6px 8px' }}>{a.name}</td>
                <td style={{ padding: '6px 8px' }}><code>@{a.slug}</code></td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{a.definition}</td>
                <td style={{ padding: '6px 8px' }}>
                  <button type="button" onClick={() => edit(a)}>Edit</button>{' '}
                  <button type="button" onClick={() => remove(a.slug)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <strong style={{ fontSize: 14 }}>{editingSlug ? `Edit @${editingSlug}` : 'New named action'}</strong>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 12 }}>Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) }))}
            placeholder="Lower thirds on"
          />
        </label>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 12 }}>Slug (@-addressable)</span>
          <input
            value={form.slug}
            disabled={!!editingSlug}
            onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: slugify(e.target.value) })); }}
            placeholder="lower-thirds"
          />
        </label>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 12 }}>Definition (composite)</span>
          <textarea
            value={form.definition}
            onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))}
            rows={2}
            style={{ fontFamily: 'monospace' }}
            placeholder="audio:start | graphics:+banner | section:Intro | @other"
          />
        </label>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 12 }}>Description (optional)</span>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </label>
        {error && <p style={{ color: 'var(--color-danger, #e55)', fontSize: 13, margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={save}>{editingSlug ? 'Save changes' : 'Create'}</button>
          {editingSlug && <button type="button" onClick={resetForm}>Cancel</button>}
        </div>
      </div>
    </section>
  );
}

export default NamedActionsManager;
