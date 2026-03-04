import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import {
  TRANSLATION_VENDORS,
  getTranslationEnabled, setTranslationEnabled,
  getTranslationTargetLang, setTranslationTargetLang,
  getTranslationVendor, setTranslationVendor,
  getTranslationApiKey, setTranslationApiKey,
  getTranslationLibreUrl, setTranslationLibreUrl,
  getTranslationLibreKey, setTranslationLibreKey,
  getTranslationShowOriginal, setTranslationShowOriginal,
} from '../lib/translationConfig';

export function TranslationModal({ isOpen, onClose }) {
  const { t } = useLang();

  const savedTargetLang = getTranslationTargetLang();
  const savedTargetEntry = COMMON_LANGUAGES.find(l => l.code === savedTargetLang);

  const [translationEnabled, setTranslationEnabledState] = useState(getTranslationEnabled);
  const [translationVendor, setTranslationVendorState] = useState(getTranslationVendor);
  const [translationApiKey, setTranslationApiKeyState] = useState(getTranslationApiKey);
  const [translationLibreUrl, setTranslationLibreUrlState] = useState(getTranslationLibreUrl);
  const [translationLibreKey, setTranslationLibreKeyState] = useState(getTranslationLibreKey);
  const [translationTargetLang, setTranslationTargetLangState] = useState(savedTargetLang);
  const [translationTargetQuery, setTranslationTargetQuery] = useState(
    savedTargetEntry ? savedTargetEntry.label : savedTargetLang
  );
  const [translationTargetDropdownOpen, setTranslationTargetDropdownOpen] = useState(false);
  const [translationShowOriginal, setTranslationShowOriginalState] = useState(getTranslationShowOriginal);

  useEffect(() => {
    if (!isOpen) return;
    setTranslationEnabledState(getTranslationEnabled());
    setTranslationVendorState(getTranslationVendor());
    setTranslationApiKeyState(getTranslationApiKey());
    setTranslationLibreUrlState(getTranslationLibreUrl());
    setTranslationLibreKeyState(getTranslationLibreKey());
    setTranslationShowOriginalState(getTranslationShowOriginal());
    const tgtLang = getTranslationTargetLang();
    setTranslationTargetLangState(tgtLang);
    const tgtEntry = COMMON_LANGUAGES.find(l => l.code === tgtLang);
    setTranslationTargetQuery(tgtEntry ? tgtEntry.label : tgtLang);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const translationTargetMatches = translationTargetDropdownOpen
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(translationTargetQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(translationTargetQuery.toLowerCase())
      )
    : [];

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
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={translationEnabled}
                onChange={e => {
                  setTranslationEnabledState(e.target.checked);
                  setTranslationEnabled(e.target.checked);
                }}
              />
              {t('settings.translation.enable')}
            </label>
            <span className="settings-field__hint" style={{ display: 'block', marginTop: 4, marginBottom: 12 }}>
              {t('settings.translation.enableHint')}
            </span>

            {translationEnabled && (
              <>
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.translation.targetLang')}</label>
                  <div className="audio-lang-wrap">
                    <input
                      className="settings-field__input"
                      type="text"
                      placeholder={t('settings.translation.targetLangPlaceholder')}
                      autoComplete="off"
                      spellCheck={false}
                      value={translationTargetQuery}
                      onChange={e => {
                        setTranslationTargetQuery(e.target.value);
                        setTranslationTargetDropdownOpen(e.target.value.trim().length > 0);
                      }}
                      onBlur={() => setTimeout(() => setTranslationTargetDropdownOpen(false), 150)}
                    />
                    {translationTargetDropdownOpen && translationTargetMatches.length > 0 && (
                      <div className="audio-lang-list">
                        {translationTargetMatches.map(l => (
                          <button
                            key={l.code}
                            className="audio-lang-option"
                            onMouseDown={() => {
                              setTranslationTargetQuery(l.label);
                              setTranslationTargetLangState(l.code);
                              setTranslationTargetDropdownOpen(false);
                              setTranslationTargetLang(l.code);
                            }}
                          >
                            {l.label} <span className="audio-lang-code">{l.code}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="settings-field__hint">
                    {translationTargetLang}
                    {' — '}
                    {t('settings.translation.sameLanguageNote')}
                  </span>
                </div>

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
