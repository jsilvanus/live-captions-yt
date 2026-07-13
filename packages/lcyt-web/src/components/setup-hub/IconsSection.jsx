import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { useToast } from '../../hooks/useToast.js';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { IconsIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';

const ALLOWED_TYPES = ['image/png', 'image/svg+xml'];
const MAX_BYTES = 200 * 1024;

/**
 * IconsSection — viewer-branding icon management (PNG/SVG), wrapping the same
 * `GET/POST/DELETE /icons` endpoints as the Settings → Icons tab. Icons uploaded
 * here are chosen per viewer target in CC → Targets → Viewer (see `TargetRow`).
 * Upload/list/delete open in a Dialog off the card's summary row.
 */
export function IconsSection() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const { showToast } = useToast();

  const [icons, setIcons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const data = await session.listIcons();
      setIcons(data.icons || []);
    } catch {
      setIcons([]);
    } finally {
      setLoading(false);
    }
  }, [connected, session]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast('Only PNG and SVG icons are allowed', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast('Icon must be 200 KB or smaller', 'error');
      return;
    }
    try {
      const arrayBuf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
      const result = await session.uploadIcon({ filename: file.name, mimeType: file.type, data: base64 });
      setIcons(prev => [{ id: result.id, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes }, ...prev]);
      showToast(`${result.filename} uploaded`, 'success');
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this icon?')) return;
    try {
      await session.deleteIcon(id);
      setIcons(prev => prev.filter(ic => ic.id !== id));
    } catch (err) {
      showToast(err.message || 'Failed to delete icon', 'error');
    }
  }

  const count = icons.length;

  return (
    <SetupCard
      id="icons"
      icon={IconsIcon}
      color="teal"
      title="Icons"
      description="PNG/SVG logos for branding the public viewer page. Pick one per viewer target in CC → Targets → Viewer."
      status="ready"
      statusLabel={connected ? `${count} icon${count === 1 ? '' : 's'}` : undefined}
      headerAction={{ label: 'Manage', onClick: () => setOpen(true) }}
    >
      {!connected ? (
        <p className="setup-card__empty">Connect to a project to manage icons.</p>
      ) : loading ? (
        <p className="setup-card__empty">Loading…</p>
      ) : count === 0 ? (
        <p className="setup-card__empty">No icons uploaded yet.</p>
      ) : (
        <SetupItemRow
          name={count === 1 ? icons[0].filename : `${count} icons`}
          meta={count === 1 ? 'Uploaded' : 'Uploaded'}
          onSettings={() => setOpen(true)}
        />
      )}

      {open && (
        <Dialog title="Icons" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!connected ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Connect to a project to manage icons.</p>
            ) : (
              <>
                <div className="settings-field">
                  <label className="settings-field__label">Upload icon (PNG or SVG, ≤ 200 KB)</label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/svg+xml"
                    onChange={handleUpload}
                  />
                </div>

                {icons.length === 0 ? (
                  <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>No icons uploaded yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {icons.map(icon => (
                      <div key={icon.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img
                          src={`${backendUrl}/icons/${icon.id}`}
                          alt=""
                          style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4, background: 'var(--color-surface-alt)', flexShrink: 0 }}
                        />
                        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: '0.9em' }}>{icon.filename}</span>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDelete(icon.id)}>Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
