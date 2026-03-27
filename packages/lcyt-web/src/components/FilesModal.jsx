import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { useEscapeKey } from '../hooks/useEscapeKey';

const ACCEPTED_MIME = 'image/png,image/webp,image/svg+xml';

export function FilesModal({ isOpen, onClose, initialTab }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const hasImages = session.graphicsEnabled;
  const [tab, setTab] = useState(initialTab || 'captions');

  // ── Caption files ───────────────────────────────────────
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ── Images ──────────────────────────────────────────────
  const [images, setImages] = useState([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef(null);
  const pendingFileRef = useRef(null);
  const [shorthandPrompt, setShorthandPrompt] = useState(null); // { file } | null

  // ── Storage config ──────────────────────────────────────
  const [storageConfig, setStorageConfigState] = useState(null); // { storageMode, config }
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [storageForm, setStorageForm] = useState({ bucket: '', region: 'auto', endpoint: '', prefix: 'captions', access_key_id: '', secret_access_key: '' });
  const [savingStorage, setSavingStorage] = useState(false);

  // Reset tab if initialTab changes while open
  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || !session.connected) return;
    if (tab === 'captions') loadFiles();
    if (tab === 'images') loadImages();
    if (tab === 'storage') loadStorageConfig();
  }, [isOpen, session.connected, tab]);

  async function loadFiles() {
    setLoadingFiles(true);
    try { setFiles((await session.listFiles()).files || []); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setLoadingFiles(false); }
  }

  async function loadImages() {
    setLoadingImages(true);
    try { setImages((await session.listImages()).images || []); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setLoadingImages(false); }
  }

  async function loadStorageConfig() {
    setLoadingStorage(true);
    try {
      const data = await session.getStorageConfig();
      setStorageConfigState(data);
      if (data.config) {
        setStorageForm({
          bucket:            data.config.bucket            || '',
          region:            data.config.region            || 'auto',
          endpoint:          data.config.endpoint          || '',
          prefix:            data.config.prefix            || 'captions',
          access_key_id:     data.config.access_key_id     || '',
          secret_access_key: '',  // never pre-fill secret
        });
      }
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoadingStorage(false); }
  }

  async function handleSaveStorageConfig(e) {
    e.preventDefault();
    if (!storageForm.bucket.trim()) { showToast('Bucket name is required', 'error'); return; }
    setSavingStorage(true);
    try {
      await session.setStorageConfig({
        bucket:            storageForm.bucket.trim(),
        region:            storageForm.region            || 'auto',
        endpoint:          storageForm.endpoint.trim()   || null,
        prefix:            storageForm.prefix.trim()     || 'captions',
        access_key_id:     storageForm.access_key_id.trim()     || null,
        secret_access_key: storageForm.secret_access_key.trim() || null,
      });
      showToast('Storage config saved', 'success', 2500);
      loadStorageConfig();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSavingStorage(false); }
  }

  async function handleDeleteStorageConfig() {
    setSavingStorage(true);
    try {
      await session.deleteStorageConfig();
      showToast('Custom storage config removed — reverted to default', 'success', 2500);
      setStorageForm({ bucket: '', region: 'auto', endpoint: '', prefix: 'captions', access_key_id: '', secret_access_key: '' });
      loadStorageConfig();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSavingStorage(false); }
  }

  // ── Caption file actions ────────────────────────────────
  async function handleDeleteFile(id) {
    try {
      await session.deleteFile(id);
      setFiles(prev => prev.filter(f => f.id !== id));
      showToast(t('settings.files.deleted'), 'success', 2000);
    } catch (err) { showToast(err.message, 'error'); }
  }

  function handleDownload(file) {
    const url = session.getFileDownloadUrl(file.id);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = file.filename; a.click();
  }

  // ── Image actions ────────────────────────────────────────
  function handleImagePickerChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    pendingFileRef.current = file;
    setShorthandPrompt({ file });
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  async function handleUploadConfirm(shorthand) {
    const file = pendingFileRef.current;
    setShorthandPrompt(null);
    pendingFileRef.current = null;
    if (!file || !shorthand) return;
    setUploading(true);
    try {
      await session.uploadImage(file, shorthand);
      showToast(`Image '${shorthand}' uploaded`, 'success', 2500);
      loadImages();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteImage(id, shorthand) {
    try {
      await session.deleteImage(id);
      setImages(prev => prev.filter(i => i.id !== id));
      showToast(`Image '${shorthand}' deleted`, 'success', 2000);
    } catch (err) { showToast(err.message, 'error'); }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  useEscapeKey(() => { if (!shorthandPrompt) onClose(); }, isOpen);

  if (!isOpen) return null;

  const tabs = ['captions', ...(hasImages ? ['images'] : []), 'storage'];

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={!shorthandPrompt ? onClose : undefined} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('settings.files.title')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        {/* Tabs */}
        {tabs.length > 1 && (
          <div className="settings-modal__tabs">
            {tabs.map(tkey => (
              <button
                key={tkey}
                className={`settings-tab${tab === tkey ? ' settings-tab--active' : ''}`}
                onClick={() => setTab(tkey)}
              >
                {tkey === 'captions' ? t('settings.files.tabCaptions') : tkey === 'images' ? t('settings.files.tabImages') : 'Storage'}
              </button>
            ))}
          </div>
        )}

        <div className="settings-modal__body">
          <div className="settings-panel settings-panel--active">
            {!session.connected && (
              <span className="settings-field__hint">{t('settings.actions.notConnected')}</span>
            )}

            {/* ── Captions tab ── */}
            {session.connected && tab === 'captions' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="settings-field__hint">{t('settings.files.hint')}</span>
                  <button className="btn btn--secondary btn--sm" onClick={loadFiles} disabled={loadingFiles}>
                    {loadingFiles ? '…' : '↺'}
                  </button>
                </div>
                {files.length === 0 && !loadingFiles && (
                  <span className="settings-field__hint">{t('settings.files.empty')}</span>
                )}
                {files.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--color-text-dim)' }}>{t('settings.files.colName')}</th>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--color-text-dim)' }}>{t('settings.files.colLang')}</th>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--color-text-dim)' }}>{t('settings.files.colFormat')}</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--color-text-dim)' }}>{t('settings.files.colSize')}</th>
                        <th style={{ padding: '4px 6px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map(file => (
                        <tr key={file.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '4px 6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.filename}>{file.filename}</td>
                          <td style={{ padding: '4px 6px' }}>{file.lang || '—'}</td>
                          <td style={{ padding: '4px 6px' }}>{file.format}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{formatSize(file.sizeBytes)}</td>
                          <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                            <button className="btn btn--secondary btn--sm" onClick={() => handleDownload(file)} title={t('settings.files.download')} style={{ marginRight: 4 }}>⬇</button>
                            <button className="btn btn--secondary btn--sm" onClick={() => handleDeleteFile(file.id)} title={t('settings.files.delete')}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {/* ── Storage tab ── */}
            {session.connected && tab === 'storage' && (
              <>
                {loadingStorage ? (
                  <span className="settings-field__hint">Loading…</span>
                ) : (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <span className="settings-field__label">Current mode: </span>
                      <strong>{storageConfig?.storageMode === 'custom-s3' ? 'Custom S3 bucket' : 'Default (server-configured)'}</strong>
                      {storageConfig?.config?.updated_at && (
                        <span className="settings-field__hint" style={{ marginLeft: 8 }}>Updated {storageConfig.config.updated_at.slice(0, 10)}</span>
                      )}
                    </div>
                    <form onSubmit={handleSaveStorageConfig} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        Set a custom S3-compatible bucket for this project key. Requires the <em>Custom S3 bucket</em> feature to be enabled.
                      </div>
                      <div className="settings-field">
                        <label className="settings-field__label">Bucket *</label>
                        <input className="settings-field__input" value={storageForm.bucket} onChange={e => setStorageForm(p => ({ ...p, bucket: e.target.value }))} placeholder="my-bucket" required />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="settings-field">
                          <label className="settings-field__label">Region</label>
                          <input className="settings-field__input" value={storageForm.region} onChange={e => setStorageForm(p => ({ ...p, region: e.target.value }))} placeholder="auto" />
                        </div>
                        <div className="settings-field">
                          <label className="settings-field__label">Prefix</label>
                          <input className="settings-field__input" value={storageForm.prefix} onChange={e => setStorageForm(p => ({ ...p, prefix: e.target.value }))} placeholder="captions" />
                        </div>
                      </div>
                      <div className="settings-field">
                        <label className="settings-field__label">Endpoint URL</label>
                        <input className="settings-field__input" value={storageForm.endpoint} onChange={e => setStorageForm(p => ({ ...p, endpoint: e.target.value }))} placeholder="https://… (leave empty for AWS)" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="settings-field">
                          <label className="settings-field__label">Access Key ID</label>
                          <input className="settings-field__input" value={storageForm.access_key_id} onChange={e => setStorageForm(p => ({ ...p, access_key_id: e.target.value }))} placeholder="optional" autoComplete="off" />
                        </div>
                        <div className="settings-field">
                          <label className="settings-field__label">Secret Access Key</label>
                          <input className="settings-field__input" type="password" value={storageForm.secret_access_key} onChange={e => setStorageForm(p => ({ ...p, secret_access_key: e.target.value }))} placeholder={storageConfig?.config?.secret_access_key ? '••••••••' : 'optional'} autoComplete="new-password" />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button type="submit" className="btn btn--primary btn--sm" disabled={savingStorage}>
                          {savingStorage ? 'Saving…' : 'Save config'}
                        </button>
                        {storageConfig?.storageMode === 'custom-s3' && (
                          <button type="button" className="btn btn--secondary btn--sm" onClick={handleDeleteStorageConfig} disabled={savingStorage}>
                            Remove / revert to default
                          </button>
                        )}
                      </div>
                    </form>
                  </>
                )}
              </>
            )}

            {/* ── Images tab ── */}
            {session.connected && tab === 'images' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="settings-field__hint">
                    Trigger with <code style={{ fontSize: 11 }}>{`<!-- graphics:shorthand -->`}</code>
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn--secondary btn--sm" onClick={loadImages} disabled={loadingImages}>{loadingImages ? '…' : '↺'}</button>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? 'Uploading…' : '+ Upload'}
                    </button>
                  </div>
                </div>
                <input ref={imageInputRef} type="file" accept={ACCEPTED_MIME} style={{ display: 'none' }} onChange={handleImagePickerChange} />

                {images.length === 0 && !loadingImages && (
                  <span className="settings-field__hint">No images uploaded yet. PNG, WebP and SVG are supported.</span>
                )}
                {images.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--color-text-dim)', width: 40 }}></th>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--color-text-dim)' }}>Shorthand</th>
                        <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--color-text-dim)' }}>Type</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--color-text-dim)' }}>Size</th>
                        <th style={{ padding: '4px 6px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {images.map(img => (
                        <tr key={img.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '4px 6px' }}>
                            <img
                              src={session.getImageViewUrl(img.id)}
                              alt={img.shorthand}
                              style={{ width: 32, height: 32, objectFit: 'contain', background: '#333', borderRadius: 3 }}
                            />
                          </td>
                          <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{img.shorthand}</td>
                          <td style={{ padding: '4px 6px', color: 'var(--color-text-dim)' }}>{img.mimeType?.split('/')[1] || '?'}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{formatSize(img.sizeBytes)}</td>
                          <td style={{ padding: '4px 6px' }}>
                            <button className="btn btn--secondary btn--sm" onClick={() => handleDeleteImage(img.id, img.shorthand)} title="Delete">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>
              {t('settings.footer.close')}
            </button>
          </div>
        </div>
      </div>

      {/* Shorthand prompt overlay */}
      {shorthandPrompt && (
        <ShorthandDialog
          filename={shorthandPrompt.file.name}
          onConfirm={handleUploadConfirm}
          onCancel={() => { setShorthandPrompt(null); pendingFileRef.current = null; }}
        />
      )}
    </div>
  );
}

function ShorthandDialog({ filename, onConfirm, onCancel }) {
  const [value, setValue] = useState(() => {
    // Pre-fill from filename without extension
    return filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32).toLowerCase();
  });
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function validate(v) {
    if (!v) return 'Shorthand is required';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(v)) return 'Use letters, digits, _ or - (start with letter/digit, max 32 chars)';
    return '';
  }

  function submit() {
    const err = validate(value);
    if (err) { setError(err); return; }
    onConfirm(value.trim());
  }

  function onKey(e) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onCancel} />
      <div style={{ position: 'relative', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 24, minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <div style={{ marginBottom: 12, fontWeight: 600 }}>Set shorthand name</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 12 }}>
          File: <span style={{ fontFamily: 'monospace' }}>{filename}</span><br />
          Used in captions as: <code style={{ fontSize: 11 }}>{`<!-- graphics:${value || 'name'} -->`}</code>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="settings-field__input"
          value={value}
          onChange={e => { setValue(e.target.value); setError(''); }}
          onKeyDown={onKey}
          placeholder="e.g. logo, pastor, prayer"
          maxLength={32}
          style={{ marginBottom: 6 }}
        />
        {error && <div style={{ color: 'var(--color-error, #e55)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={submit}>Upload</button>
        </div>
      </div>
    </div>
  );
}
