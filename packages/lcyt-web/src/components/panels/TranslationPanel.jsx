import { useLang } from '../../contexts/LangContext.jsx';
import { LanguagePicker } from '../LanguagePicker.jsx';
import {
  TRANSLATION_VENDORS, TRANSLATION_TARGETS, CAPTION_FORMATS,
} from '../../lib/translationConfig.js';

/**
 * TranslationRow — single translation entry editor.
 * Data shape: { id, enabled, lang, target: 'captions'|'file'|'backend-file', format? }
 */
function TranslationRow({ entry, onChange, onRemove, hasExistingCaptionTarget, t }) {
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
      </div>

      <div>
        <select
          className="settings-field__input"
          value={entry.target}
          onChange={e => {
            const next = { ...entry, target: e.target.value };
            if (e.target.value === 'captions') delete next.format;
            if (!next.format && (e.target.value === 'file' || e.target.value === 'backend-file')) next.format = 'youtube';
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
            {CAPTION_FORMATS.map(fmt => <option key={fmt.value} value={fmt.value}>{t(fmt.labelKey)}</option>)}
          </select>
        </div>
      )}

      <button type="button" className="btn btn--secondary btn--sm" onClick={onRemove} title={t('settings.translation.removeTranslation')} style={{ flexShrink: 0 }}>✕</button>
    </div>
  );
}

/**
 * TranslationPanel — translation entry list + vendor settings.
 *
 * Props:
 *   translations: { id, enabled, lang, target, format? }[]
 *   onTranslationsChange: (translations) => void
 *   vendor: string
 *   onVendorChange: (vendor) => void
 *   vendorKey: string
 *   onVendorKeyChange: (key) => void
 *   libreUrl: string
 *   onLibreUrlChange: (url) => void
 *   libreKey: string
 *   onLibreKeyChange: (key) => void
 *   showOriginal: boolean
 *   onShowOriginalChange: (val) => void
 */
export function TranslationPanel({
  translations = [],
  onTranslationsChange,
  vendor = 'mymemory',
  onVendorChange,
  vendorKey = '',
  onVendorKeyChange,
  libreUrl = '',
  onLibreUrlChange,
  libreKey = '',
  onLibreKeyChange,
  showOriginal = false,
  onShowOriginalChange,
}) {
  const { t } = useLang();
  const hasCaptionTarget = translations.some(r => r.target === 'captions');

  function updateRow(id, updated) {
    onTranslationsChange(translations.map(r => r.id === id ? updated : r));
  }

  function removeRow(id) {
    onTranslationsChange(translations.filter(r => r.id !== id));
  }

  function addRow() {
    const newRow = {
      id: crypto.randomUUID(),
      enabled: true,
      lang: 'en-US',
      target: hasCaptionTarget ? 'file' : 'captions',
      ...(hasCaptionTarget ? { format: 'youtube' } : {}),
    };
    onTranslationsChange([...translations, newRow]);
  }

  return (
    <>
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
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRow} style={{ marginTop: 8 }}>
          + {t('settings.translation.addTranslation')}
        </button>
      </div>

      {hasCaptionTarget && (
        <div className="settings-field">
          <label className="settings-checkbox">
            <input type="checkbox" checked={showOriginal} onChange={e => onShowOriginalChange(e.target.checked)} />
            {t('settings.translation.showOriginal')}
          </label>
          <span className="settings-field__hint">{t('settings.translation.showOriginalHint')}</span>
        </div>
      )}

      <div className="settings-field">
        <label className="settings-field__label">{t('settings.translation.vendor')}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {TRANSLATION_VENDORS.map(v => (
            <button
              key={v.value}
              type="button"
              className={`lang-btn${vendor === v.value ? ' lang-btn--active' : ''}`}
              onClick={() => onVendorChange(v.value)}
            >
              {t(v.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {(vendor === 'google' || vendor === 'deepl') && (
        <div className="settings-field">
          <label className="settings-field__label">{t('settings.translation.vendorKey')}</label>
          <input
            className="settings-field__input"
            type="password"
            autoComplete="off"
            value={vendorKey}
            onChange={e => onVendorKeyChange(e.target.value)}
          />
          <span className="settings-field__hint">{t('settings.translation.vendorKeyHint')}</span>
        </div>
      )}

      {vendor === 'libretranslate' && (
        <>
          <div className="settings-field">
            <label className="settings-field__label">{t('settings.translation.libreUrl')}</label>
            <input
              className="settings-field__input"
              type="url"
              placeholder={t('settings.translation.libreUrlPlaceholder')}
              autoComplete="off"
              value={libreUrl}
              onChange={e => onLibreUrlChange(e.target.value)}
            />
            <span className="settings-field__hint">{t('settings.translation.libreUrlHint')}</span>
          </div>
          <div className="settings-field">
            <label className="settings-field__label">{t('settings.translation.libreKey')}</label>
            <input
              className="settings-field__input"
              type="password"
              autoComplete="off"
              value={libreKey}
              onChange={e => onLibreKeyChange(e.target.value)}
            />
            <span className="settings-field__hint">{t('settings.translation.libreKeyHint')}</span>
          </div>
        </>
      )}
    </>
  );
}
