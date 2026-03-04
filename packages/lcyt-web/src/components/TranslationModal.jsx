import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import {
  TRANSLATION_VENDORS, TRANSLATION_TARGETS, CAPTION_FORMATS,
  getTranslations, setTranslations,
  getTranslationVendor, setTranslationVendor,
  getTranslationApiKey, setTranslationApiKey,
  getTranslationLibreUrl, setTranslationLibreUrl,
  getTranslationLibreKey, setTranslationLibreKey,
  getTranslationShowOriginal, setTranslationShowOriginal,
} from '../lib/translationConfig';
import { LanguagePicker } from './LanguagePicker';

function TranslationRow({ entry, onChange, onRemove, hasExistingCaptionTarget, t }) {
  const lang = COMMON_LANGUAGES.find(l => l.code === entry.lang);

  // Only one 'captions' target is allowed; disable that option for others already having one
  const disableCaptions = entry.target !== 'captions' && hasExistingCaptionTarget;

  return (
    <div className="translation-row">
      <label className="settings-checkbox" style={{ marginBottom: 0 }}>
        <input
          type="checkbox"
          checked={entry.enabled}
          onChange={e => onChange({ ...entry, enabled: e.target.checked })}
        />
      </label>

      <div style={{ flex: 1, minWidth: 0 }}>
        <LanguagePicker
          value={entry.lang}
          onChange={code => onChange({ ...entry, lang: code })}
          placeholder={t('settings.translation.targetLangPlaceholder')}
        />
        {lang && <span className="settings-field__hint" style={{ marginTop: 2 }}>{entry.lang}</span>}
      </div>

      <div>
        <select
          className="settings-field__input"
          value={entry.target}
          onChange={e => {
            const next = { ...entry, target: e.target.value };
            if (e.target.value === 'captions') delete next.format;
            if (!next.format && (e.target.value === 'file' || e.target.value === 'backend-file'))
              next.format = 'youtube';
            onChange(next);
          }}
          style={{ width: 'auto' }}
        >
          {TRANSLATION_TARGETS.map(tgt => (
            <option
              key={tgt.value}
              value={tgt.value}
              disabled={tgt.value === 'captions' && disableCaptions}
            >
              {t(tgt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {(entry.target === 'file' || entry.target === 'backend-file') && (
        <div>
          <select
            className="settings-field__input"
            value={entry.format || 'youtube'}
            onChange={e => onChange({ ...entry, format: e.target.value })}
            style={{ width: 'auto' }}
          >
            {CAPTION_FORMATS.map(fmt => (
              <option key={fmt.value} value={fmt.value}>{t(fmt.labelKey)}</option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={onRemove}
        title={t('settings.translation.removeTranslation')}
        style={{ flexShrink: 0 }}
      >✕</button>
    </div>
  );
}

export function TranslationModal({ isOpen, onClose }) {
  const { t } = useLang();

  const [translations, setTranslationsState] = useState([]);
  const [translationVendor, setTranslationVendorState] = useState(getTranslationVendor);
  const [translationApiKey, setTranslationApiKeyState] = useState(getTranslationApiKey);
  const [translationLibreUrl, setTranslationLibreUrlState] = useState(getTranslationLibreUrl);
  const [translationLibreKey, setTranslationLibreKeyState] = useState(getTranslationLibreKey);
  const [translationShowOriginal, setTranslationShowOriginalState] = useState(getTranslationShowOriginal);

  useEffect(() => {
    if (!isOpen) return;
    setTranslationsState(getTranslations());
    setTranslationVendorState(getTranslationVendor());
    setTranslationApiKeyState(getTranslationApiKey());
    setTranslationLibreUrlState(getTranslationLibreUrl());
    setTranslationLibreKeyState(getTranslationLibreKey());
    setTranslationShowOriginalState(getTranslationShowOriginal());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function updateRow(id, updatedEntry) {
    const next = translations.map(r => r.id === id ? updatedEntry : r);
    setTranslationsState(next);
    setTranslations(next);
  }

  function removeRow(id) {
    const next = translations.filter(r => r.id !== id);
    setTranslationsState(next);
    setTranslations(next);
  }

  function addRow() {
    const hasCaptionTarget = translations.some(r => r.target === 'captions');
    const newRow = {
      id: crypto.randomUUID(),
      enabled: true,
      lang: 'en-US',
      target: hasCaptionTarget ? 'file' : 'captions',
      format: hasCaptionTarget ? 'youtube' : undefined,
    };
    const next = [...translations, newRow];
    setTranslationsState(next);
    setTranslations(next);
  }

  const hasCaptionTarget = translations.some(r => r.target === 'captions');

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.translation')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-modal__body">
          <div className="settings-panel settings-panel--active">

            {/* Translation list */}
            <div className="settings-field">
              <label className="settings-field__label">{t('settings.translation.translationList')}</label>
              <span className="settings-field__hint" style={{ display: 'block', marginBottom: 8 }}>
                {t('settings.translation.enableHint')}
              </span>
              {translations.length === 0 && (
                <span className="settings-field__hint">{t('settings.translation.noTranslations')}</span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {translations.map(entry => (
                  <TranslationRow
                    key={entry.id}
                    entry={entry}
                    onChange={updated => updateRow(entry.id, updated)}
                    onRemove={() => removeRow(entry.id)}
                    hasExistingCaptionTarget={hasCaptionTarget}
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
                + {t('settings.translation.addTranslation')}
              </button>
            </div>

            {/* Show original */}
            {hasCaptionTarget && (
              <div className="settings-field">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={translationShowOriginal}
                    onChange={e => {
                      setTranslationShowOriginalState(e.target.checked);
                      setTranslationShowOriginal(e.target.checked);
                    }}
                  />
                  {t('settings.translation.showOriginal')}
                </label>
                <span className="settings-field__hint">{t('settings.translation.showOriginalHint')}</span>
              </div>
            )}

            {/* Vendor */}
            <div className="settings-field">
              <label className="settings-field__label">{t('settings.translation.vendor')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {TRANSLATION_VENDORS.map(v => (
                  <button
                    key={v.value}
                    type="button"
                    className={`lang-btn${translationVendor === v.value ? ' lang-btn--active' : ''}`}
                    onClick={() => {
                      setTranslationVendorState(v.value);
                      setTranslationVendor(v.value);
                    }}
                  >
                    {t(v.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {(translationVendor === 'google' || translationVendor === 'deepl') && (
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.translation.vendorKey')}</label>
                <input
                  className="settings-field__input"
                  type="password"
                  autoComplete="off"
                  value={translationApiKey}
                  onChange={e => {
                    setTranslationApiKeyState(e.target.value);
                    setTranslationApiKey(e.target.value);
                  }}
                />
                <span className="settings-field__hint">{t('settings.translation.vendorKeyHint')}</span>
              </div>
            )}

            {translationVendor === 'libretranslate' && (
              <>
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.translation.libreUrl')}</label>
                  <input
                    className="settings-field__input"
                    type="url"
                    placeholder={t('settings.translation.libreUrlPlaceholder')}
                    autoComplete="off"
                    value={translationLibreUrl}
                    onChange={e => {
                      setTranslationLibreUrlState(e.target.value);
                      setTranslationLibreUrl(e.target.value);
                    }}
                  />
                  <span className="settings-field__hint">{t('settings.translation.libreUrlHint')}</span>
                </div>
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.translation.libreKey')}</label>
                  <input
                    className="settings-field__input"
                    type="password"
                    autoComplete="off"
                    value={translationLibreKey}
                    onChange={e => {
                      setTranslationLibreKeyState(e.target.value);
                      setTranslationLibreKey(e.target.value);
                    }}
                  />
                  <span className="settings-field__hint">{t('settings.translation.libreKeyHint')}</span>
                </div>
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
