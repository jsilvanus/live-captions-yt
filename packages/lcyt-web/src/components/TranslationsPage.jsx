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
            <option key={tgt.value} value={tgt.value} disabled={tgt.value === 'captions' && disableCaptions}>
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

export function TranslationsPage() {
  const { t } = useLang();

  const [translations, setTranslationsState] = useState(getTranslations);
  const [translationVendor, setTranslationVendorState] = useState(getTranslationVendor);
  const [translationApiKey, setTranslationApiKeyState] = useState(getTranslationApiKey);
  const [translationLibreUrl, setTranslationLibreUrlState] = useState(getTranslationLibreUrl);
  const [translationLibreKey, setTranslationLibreKeyState] = useState(getTranslationLibreKey);
  const [translationShowOriginal, setTranslationShowOriginalState] = useState(getTranslationShowOriginal);

  // Re-read on mount to catch any changes from other pages
  useEffect(() => {
    setTranslationsState(getTranslations());
    setTranslationVendorState(getTranslationVendor());
    setTranslationApiKeyState(getTranslationApiKey());
    setTranslationLibreUrlState(getTranslationLibreUrl());
    setTranslationLibreKeyState(getTranslationLibreKey());
    setTranslationShowOriginalState(getTranslationShowOriginal());
  }, []);

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
    <div className="translations-page">
      <div className="translations-page__inner">
        <h1 className="translations-page__title">Translations</h1>

        {/* Translation list */}
        <section className="translations-page__section">
          <h2 className="translations-page__section-title">{t('settings.translation.translationList')}</h2>
          <p className="translations-page__hint">{t('settings.translation.enableHint')}</p>
          {translations.length === 0 && (
            <p className="translations-page__hint">{t('settings.translation.noTranslations')}</p>
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
            style={{ marginTop: 10 }}
          >
            + {t('settings.translation.addTranslation')}
          </button>
        </section>

        {/* Show original */}
        {hasCaptionTarget && (
          <section className="translations-page__section">
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
            <p className="translations-page__hint">{t('settings.translation.showOriginalHint')}</p>
          </section>
        )}

        {/* Vendor */}
        <section className="translations-page__section">
          <h2 className="translations-page__section-title">{t('settings.translation.vendor')}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TRANSLATION_VENDORS.map(v => (
              <button
                key={v.value}
                type="button"
                className={`lang-btn${translationVendor === v.value ? ' lang-btn--active' : ''}`}
                onClick={() => { setTranslationVendorState(v.value); setTranslationVendor(v.value); }}
              >
                {t(v.labelKey)}
              </button>
            ))}
          </div>
        </section>

        {(translationVendor === 'google' || translationVendor === 'deepl') && (
          <section className="translations-page__section">
            <label className="settings-field__label">{t('settings.translation.vendorKey')}</label>
            <input
              className="settings-field__input"
              type="password"
              autoComplete="off"
              value={translationApiKey}
              onChange={e => { setTranslationApiKeyState(e.target.value); setTranslationApiKey(e.target.value); }}
            />
            <p className="translations-page__hint">{t('settings.translation.vendorKeyHint')}</p>
          </section>
        )}

        {translationVendor === 'libretranslate' && (
          <>
            <section className="translations-page__section">
              <label className="settings-field__label">{t('settings.translation.libreUrl')}</label>
              <input
                className="settings-field__input"
                type="url"
                placeholder={t('settings.translation.libreUrlPlaceholder')}
                autoComplete="off"
                value={translationLibreUrl}
                onChange={e => { setTranslationLibreUrlState(e.target.value); setTranslationLibreUrl(e.target.value); }}
              />
              <p className="translations-page__hint">{t('settings.translation.libreUrlHint')}</p>
            </section>
            <section className="translations-page__section">
              <label className="settings-field__label">{t('settings.translation.libreKey')}</label>
              <input
                className="settings-field__input"
                type="password"
                autoComplete="off"
                value={translationLibreKey}
                onChange={e => { setTranslationLibreKeyState(e.target.value); setTranslationLibreKey(e.target.value); }}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
