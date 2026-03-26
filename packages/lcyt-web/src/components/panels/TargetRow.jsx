import { useState } from 'react';
import { useLang } from '../../contexts/LangContext.jsx';

/**
 * TargetRow — single caption target editor (full-featured).
 *
 * Data shape: { id, enabled, type, streamKey?, viewerKey?, url?, headers?, format?, iconId?, noBatch? }
 *
 * Props:
 *   entry: object
 *   onChange: (entry) => void
 *   onRemove: () => void
 *   backendUrl: string
 *   icons: { id, filename }[]
 */
export function TargetRow({ entry, onChange, onRemove, backendUrl = '', icons = [] }) {
  const { t } = useLang();
  const [urlError, setUrlError] = useState('');
  const [headersError, setHeadersError] = useState('');
  const [viewerKeyError, setViewerKeyError] = useState('');
  const [qrOpen, setQrOpen] = useState(false);

  function validateUrl(val) {
    if (!val) return t('settings.targets.errorUrlRequired');
    try {
      const u = new URL(val);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return t('settings.targets.errorUrlProtocol');
      return '';
    } catch {
      return t('settings.targets.errorUrlInvalid');
    }
  }

  function validateHeaders(val) {
    if (!val) return '';
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        return t('settings.targets.errorHeadersObject');
      }
      return '';
    } catch {
      return t('settings.targets.errorHeadersInvalid');
    }
  }

  function validateViewerKey(val) {
    if (!val) return t('settings.targets.viewerKeyError');
    if (!/^[a-zA-Z0-9_-]{3,}$/.test(val)) return t('settings.targets.viewerKeyError');
    return '';
  }

  const isValidViewerKey = entry.type === 'viewer' && entry.viewerKey && /^[a-zA-Z0-9_-]{3,}$/.test(entry.viewerKey);
  const viewerPageUrl = (isValidViewerKey && backendUrl)
    ? `${window.location.origin}/view/${encodeURIComponent(entry.viewerKey)}?server=${encodeURIComponent(backendUrl)}${entry.iconId ? `&icon=${entry.iconId}` : ''}`
    : null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={!!entry.enabled}
            onChange={e => onChange({ ...entry, enabled: e.target.checked })}
          />
        </label>
        <select
          className="settings-field__input"
          value={entry.type}
          onChange={e => {
            const next = { ...entry, type: e.target.value };
            delete next.url; delete next.headers; delete next.streamKey; delete next.viewerKey;
            onChange(next);
            setUrlError(''); setHeadersError(''); setViewerKeyError('');
          }}
          style={{ width: 'auto' }}
        >
          <option value="youtube">{t('settings.targets.typeYouTube')}</option>
          <option value="generic">{t('settings.targets.typeGeneric')}</option>
          <option value="viewer">{t('settings.targets.typeViewer')}</option>
        </select>
        {entry.type !== 'viewer' && (
          <select
            className="settings-field__input"
            value={entry.format || 'youtube'}
            onChange={e => onChange({ ...entry, format: e.target.value })}
            style={{ width: 'auto' }}
          >
            <option value="youtube">{t('settings.targets.formatYouTube')}</option>
            <option value="json">{t('settings.targets.formatJson')}</option>
          </select>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title={t('settings.targets.removeTarget')}
          style={{ flexShrink: 0, marginLeft: 'auto' }}
        >✕</button>
      </div>

      {entry.type === 'youtube' && (
        <div>
          <label className="settings-field__label">{t('settings.targets.streamKey')}</label>
          <input
            className="settings-field__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('settings.targets.streamKeyPlaceholder')}
            value={entry.streamKey || ''}
            onChange={e => onChange({ ...entry, streamKey: e.target.value })}
          />
          <span className="settings-field__hint">{t('settings.targets.streamKeyHint')}</span>
        </div>
      )}

      {entry.type === 'generic' && (
        <>
          <div>
            <label className="settings-field__label">{t('settings.targets.endpointUrl')}</label>
            <input
              className="settings-field__input"
              type="url"
              autoComplete="off"
              placeholder="https://example.com/captions"
              value={entry.url || ''}
              onChange={e => { onChange({ ...entry, url: e.target.value }); setUrlError(validateUrl(e.target.value)); }}
              onBlur={e => setUrlError(validateUrl(e.target.value))}
            />
            {urlError && <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{urlError}</span>}
            <span className="settings-field__hint">{t('settings.targets.endpointUrlHint')}</span>
          </div>
          <div>
            <label className="settings-field__label">{t('settings.targets.headers')}</label>
            <textarea
              className="settings-field__input"
              rows={3}
              placeholder={'{"Authorization": "Bearer token"}'}
              value={entry.headers || ''}
              onChange={e => { onChange({ ...entry, headers: e.target.value }); setHeadersError(validateHeaders(e.target.value)); }}
              onBlur={e => setHeadersError(validateHeaders(e.target.value))}
              style={{ fontFamily: 'monospace', fontSize: '0.85em', resize: 'vertical' }}
            />
            {headersError && <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{headersError}</span>}
            <span className="settings-field__hint">{t('settings.targets.headersHint')}</span>
          </div>
        </>
      )}

      {entry.type === 'viewer' && (
        <div>
          <label className="settings-field__label">{t('settings.targets.viewerKey')}</label>
          <input
            className="settings-field__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('settings.targets.viewerKeyPlaceholder')}
            value={entry.viewerKey || ''}
            onChange={e => { onChange({ ...entry, viewerKey: e.target.value }); setViewerKeyError(validateViewerKey(e.target.value)); }}
            onBlur={e => setViewerKeyError(validateViewerKey(e.target.value))}
          />
          {viewerKeyError && <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{viewerKeyError}</span>}
          <span className="settings-field__hint">{t('settings.targets.viewerKeyHint')}</span>

          <label className="settings-field__label" style={{ marginTop: 8 }}>{t('settings.targets.viewerIcon')}</label>
          <select
            className="settings-field__input"
            style={{ width: 'auto' }}
            value={entry.iconId || ''}
            onChange={e => onChange({ ...entry, iconId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{t('settings.targets.viewerIconNone')}</option>
            {icons.map(icon => <option key={icon.id} value={icon.id}>{icon.filename}</option>)}
          </select>
          <span className="settings-field__hint">{t('settings.targets.viewerIconHint')}</span>

          {viewerPageUrl && (
            <div style={{ marginTop: 6 }}>
              <span className="settings-field__label">{t('settings.targets.viewerUrl')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                <a href={viewerPageUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all', fontSize: '0.85em', flex: 1, minWidth: 0 }}>{viewerPageUrl}</a>
                <button type="button" className="btn btn--secondary btn--sm" style={{ flexShrink: 0 }} onClick={() => setQrOpen(v => !v)} title={t('settings.targets.viewerQrTitle')}>
                  {t('settings.targets.viewerQr')}
                </button>
              </div>
              {qrOpen && (
                <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--color-bg, #1a1a1a)', border: '1px solid var(--border)', borderRadius: 6, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(viewerPageUrl)}`} alt="QR code" width={180} height={180} style={{ display: 'block', borderRadius: 4 }} />
                  <span style={{ fontSize: '0.72em', opacity: 0.6, textAlign: 'center' }}>{t('settings.targets.viewerQrHint')}</span>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => setQrOpen(false)}>✕</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={!!entry.noBatch}
            onChange={e => onChange({ ...entry, noBatch: e.target.checked })}
          />
          {t('settings.targets.noBatch')}
        </label>
        <span className="settings-field__hint" style={{ display: 'block', marginTop: 4 }}>{t('settings.targets.noBatchHint')}</span>
      </div>
    </div>
  );
}
