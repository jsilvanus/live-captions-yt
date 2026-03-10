import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { useEscapeKey } from '../hooks/useEscapeKey';

export function FilesModal({ isOpen, onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !session.connected) return;
    loadFiles();
  }, [isOpen, session.connected]);

  async function loadFiles() {
    setLoading(true);
    try {
      const data = await session.listFiles();
      setFiles(data.files || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(fileId) {
    try {
      await session.deleteFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      showToast(t('settings.files.deleted'), 'success', 2000);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function handleDownload(file) {
    const url = session.getFileDownloadUrl(file.id);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('settings.files.title')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-modal__body">
          <div className="settings-panel settings-panel--active">
            {!session.connected && (
              <span className="settings-field__hint">{t('settings.actions.notConnected')}</span>
            )}
            {session.connected && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="settings-field__hint">{t('settings.files.hint')}</span>
                  <button className="btn btn--secondary btn--sm" onClick={loadFiles} disabled={loading}>
                    {loading ? '…' : '↺'}
                  </button>
                </div>
                {files.length === 0 && !loading && (
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
                          <td style={{ padding: '4px 6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.filename}>
                            {file.filename}
                          </td>
                          <td style={{ padding: '4px 6px' }}>{file.lang || '—'}</td>
                          <td style={{ padding: '4px 6px' }}>{file.format}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{formatSize(file.sizeBytes)}</td>
                          <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn--secondary btn--sm"
                              onClick={() => handleDownload(file)}
                              title={t('settings.files.download')}
                              style={{ marginRight: 4 }}
                            >⬇</button>
                            <button
                              className="btn btn--secondary btn--sm"
                              onClick={() => handleDelete(file.id)}
                              title={t('settings.files.delete')}
                            >✕</button>
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
    </div>
  );
}
