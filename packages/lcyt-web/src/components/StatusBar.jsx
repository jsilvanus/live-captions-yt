import { useLang } from '../contexts/LangContext';

export function StatusBar({ onGeneralOpen, onStatusOpen, onActionsOpen, onCaptionOpen, onTranslationOpen, onPrivacyOpen }) {
  const { t } = useLang();

  return (
    <header id="header" className="status-bar">
      <span className="status-bar__brand">lcyt-web</span>
      <span className="status-bar__spacer" />
      <div className="status-bar__actions">
        <button className="status-bar__btn" onClick={onGeneralOpen} title="General settings">{t('statusBar.general')}</button>
        <button className="status-bar__btn" onClick={onStatusOpen} title="Status">{t('statusBar.status')}</button>
        <button className="status-bar__btn" onClick={onActionsOpen} title="Actions">{t('statusBar.actions')}</button>
        <button className="status-bar__btn" onClick={onCaptionOpen} title="Caption settings">{t('statusBar.caption')}</button>
        <button className="status-bar__btn" onClick={onTranslationOpen} title="Translation settings">{t('statusBar.translation')}</button>
        <button className="status-bar__btn" onClick={onPrivacyOpen} title="Privacy">{t('statusBar.privacy')}</button>
      </div>
    </header>
  );
}
