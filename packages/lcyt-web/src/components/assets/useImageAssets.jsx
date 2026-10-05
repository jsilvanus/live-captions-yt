import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../Dialog.jsx';
import { ConfirmDialog } from '../ConfirmDialog.jsx';
import { useGuidedActionTargets } from '../../hooks/useGuidedAction.jsx';

/**
 * Image assets of a project (the DSK overlay images behind `GET /images`): list, edit settings, delete.
 *
 * Owns the dialogs the Asset Control Assistant's `asset.update` / `asset.delete` tools open
 * (plan_ai_roles_framework.md): a confirm-mode tool call lands here pre-filled and the human
 * submits it themselves. Must run inside a GuidedActionProvider.
 *
 * @returns {{ images, loading, error, openEdit, openDelete, dialogs }}
 */
export function useImageAssets({ backendUrl, headers, connected }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);   // { id, text, error, saving }
  const [del, setDel] = useState(null);     // { id, saving, error }

  const headerKey = JSON.stringify(headers || {});
  const load = useCallback(async () => {
    if (!connected || !backendUrl) { setImages([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/images`, { headers });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText || 'Request failed');
      const data = await res.json();
      setImages(Array.isArray(data?.images) ? data.images : []);
      setError('');
    } catch (err) {
      setImages([]);
      setError(err.message || 'Could not load images');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, backendUrl, headerKey]);

  useEffect(() => { load(); }, [load]);

  const find = (id) => images.find(i => i.id === Number(id)) || null;
  const label = (id) => find(id)?.shorthand || `#${id}`;

  const openEdit = useCallback((id, settings) => {
    const current = images.find(i => i.id === Number(id));
    const value = settings && typeof settings === 'object' ? settings : (current?.settingsJson ?? {});
    setEdit({ id: Number(id), text: JSON.stringify(value, null, 2), error: '', saving: false });
  }, [images]);
  const openDelete = useCallback((id) => setDel({ id: Number(id), saving: false, error: '' }), []);

  useGuidedActionTargets({
    'asset.update': ({ id, settings }) => openEdit(id, settings),
    'asset.delete': ({ id }) => openDelete(id),
  });

  async function saveEdit() {
    let parsed;
    try { parsed = JSON.parse(edit.text); } catch { setEdit(e => ({ ...e, error: 'Settings must be valid JSON.' })); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setEdit(e => ({ ...e, error: 'Settings must be a JSON object.' })); return; }
    setEdit(e => ({ ...e, saving: true, error: '' }));
    try {
      const res = await fetch(`${backendUrl}/images/${edit.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settingsJson: parsed }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setImages(list => list.map(i => (i.id === edit.id ? { ...i, settingsJson: parsed } : i)));
      setEdit(null);
    } catch (err) {
      setEdit(e => ({ ...e, saving: false, error: err.message || 'Save failed' }));
    }
  }

  async function confirmDelete() {
    setDel(d => ({ ...d, saving: true, error: '' }));
    try {
      const res = await fetch(`${backendUrl}/images/${del.id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Delete failed');
      setImages(list => list.filter(i => i.id !== del.id));
      setDel(null);
    } catch (err) {
      setDel(d => ({ ...d, saving: false, error: err.message || 'Delete failed' }));
    }
  }

  const dialogs = (
    <>
      {edit && (
        <Dialog
          title={`Image settings: ${label(edit.id)}`}
          onClose={() => setEdit(null)}
          footer={(
            <>
              <button className="btn btn--ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={saveEdit} disabled={edit.saving}>{edit.saving ? 'Saving…' : 'Save'}</button>
            </>
          )}
        >
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Per-viewport placement and display settings for this image, as JSON. Saving replaces the stored settings.
          </p>
          <textarea
            aria-label="Image settings JSON"
            value={edit.text}
            onChange={e => setEdit(s => ({ ...s, text: e.target.value }))}
            rows={12}
            spellCheck={false}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          />
          {edit.error && <div className="settings-error" role="alert">{edit.error}</div>}
        </Dialog>
      )}
      <ConfirmDialog
        open={!!del}
        title="Delete image?"
        message={del ? `Delete image "${label(del.id)}"? Graphics that use it will lose the image.${del.error ? ` ${del.error}` : ''}` : ''}
        confirmLabel="Delete"
        danger
        loading={!!del?.saving}
        onConfirm={confirmDelete}
        onCancel={() => setDel(null)}
      />
    </>
  );

  return { images, loading, error, openEdit, openDelete, dialogs, reload: load };
}
