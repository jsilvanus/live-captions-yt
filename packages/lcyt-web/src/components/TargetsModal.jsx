import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { getTargets, setTargets } from '../lib/targetConfig';

function TargetRow({ entry, onChange, onRemove, t }) {
  const [urlError, setUrlError] = useState('');
  const [headersError, setHeadersError] = useState('');

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

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={e => onChange({ ...entry, enabled: e.target.checked })}
          />
        </label>
        <select
          className="settings-field__input"
          value={entry.type}
          onChange={e => {
            const next = { ...entry, type: e.target.value };
            if (e.target.value === 'youtube') {
              delete next.url;
              delete next.headers;
            } else {
              delete next.streamKey;
            }
            onChange(next);
            setUrlError('');
            setHeadersError('');
          }}
          style={{ width: 'auto' }}
        >
          <option value="youtube">{t('settings.targets.typeYouTube')}</option>
          <option value="generic">{t('settings.targets.typeGeneric')}</option>
        </select>
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
              onChange={e => {
                onChange({ ...entry, url: e.target.value });
                setUrlError(validateUrl(e.target.value));
              }}
              onBlur={e => setUrlError(validateUrl(e.target.value))}
            />
            {urlError && (
              <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{urlError}</span>
            )}
            <span className="settings-field__hint">{t('settings.targets.endpointUrlHint')}</span>
          </div>
          <div>
            <label className="settings-field__label">{t('settings.targets.headers')}</label>
            <textarea
              className="settings-field__input"
              rows={3}
              placeholder={'{"Authorization": "Bearer token"}'}
              value={entry.headers || ''}
              onChange={e => {
                onChange({ ...entry, headers: e.target.value });
                setHeadersError(validateHeaders(e.target.value));
              }}
              onBlur={e => setHeadersError(validateHeaders(e.target.value))}
              style={{ fontFamily: 'monospace', fontSize: '0.85em', resize: 'vertical' }}
            />
            {headersError && (
              <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{headersError}</span>
            )}
            <span className="settings-field__hint">{t('settings.targets.headersHint')}</span>
          </div>
        </>
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
        <span className="settings-field__hint" style={{ display: 'block', marginTop: 4 }}>
          {t('settings.targets.noBatchHint')}
        </span>
      </div>
    </div>
  );
}

export function TargetsModal({ isOpen, onClose }) {
  const { t } = useLang();
  const [targets, setTargetsState] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setTargetsState(getTargets());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function updateRow(id, updatedEntry) {
    const next = targets.map(r => r.id === id ? updatedEntry : r);
    setTargetsState(next);
    setTargets(next);
  }

  function removeRow(id) {
    const next = targets.filter(r => r.id !== id);
    setTargetsState(next);
    setTargets(next);
  }

  function addRow() {
    const newRow = {
      id: crypto.randomUUID(),
      enabled: true,
      type: 'youtube',
      streamKey: '',
    };
    const next = [...targets, newRow];
    setTargetsState(next);
    setTargets(next);
  }

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.targets')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-modal__body">
          <div className="settings-panel settings-panel--active">

            <div className="settings-field">
              <label className="settings-field__label">{t('settings.targets.targetList')}</label>
              <span className="settings-field__hint" style={{ display: 'block', marginBottom: 8 }}>
                {t('settings.targets.listHint')}
              </span>
              {targets.length === 0 && (
                <span className="settings-field__hint">{t('settings.targets.noTargets')}</span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {targets.map(entry => (
                  <TargetRow
                    key={entry.id}
                    entry={entry}
                    onChange={updated => updateRow(entry.id, updated)}
                    onRemove={() => removeRow(entry.id)}
                    t={t}
                  />
                ))}
              </div>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={addRow}
                style={{ marginTop: 8 }}
              >
                + {t('settings.targets.addTarget')}
              </button>
            </div>

            <div className="settings-field">
              <span className="settings-field__hint">{t('settings.targets.reconnectHint')}</span>
            </div>

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
