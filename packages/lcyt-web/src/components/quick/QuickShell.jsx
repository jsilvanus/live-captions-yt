import { Link } from 'wouter';
import { useSessionContext } from '../../contexts/SessionContext';
import { useLang } from '../../contexts/LangContext';
import s from './quick.module.css';

/**
 * Chrome of the quick pages: title, connection state with a reconnect button, a way back to the list and to the
 * full app. Small enough for a pop-out window.
 */
export function QuickShell({ title, back = true, children }) {
  const { t } = useLang();
  const session = useSessionContext();
  const connected = !!session?.connected;
  return (
    <div className={s.shell}>
      <header className={s.bar}>
        {back && <Link href="/" className={s.barLink}>← {t('quick.back')}</Link>}
        <span className={s.barTitle}>{title}</span>
        <span className={s.conn} role="status">
          <span className={`${s.dot} ${connected ? s.dotOn : s.dotWarn}`} />
          {connected ? t('quick.connection.online') : t('quick.connection.offline')}
          {!connected && session?.reconnectNow && (
            <button type="button" className="btn btn--sm" onClick={session.reconnectNow}>{t('quick.connection.reconnect')}</button>
          )}
        </span>
        <a className={s.barLink} href="/">{t('quick.fullApp')}</a>
      </header>
      <main className={s.page}>
        {!connected && <p className={s.hint} role="alert">{t('quick.notConnected')}</p>}
        {children}
      </main>
    </div>
  );
}
