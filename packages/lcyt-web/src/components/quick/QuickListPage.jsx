import { useState } from 'react';
import { Link } from 'wouter';
import { useLang } from '../../contexts/LangContext';
import { usePolling } from '../../hooks/usePolling.js';
import { findYoutubeTarget } from '../../lib/quickTargets.js';
import { QuickShell } from './QuickShell.jsx';
import { useQuickApi } from './useQuickApi.js';
import { QUICK_WORKFLOWS, openWorkflowWindow } from './workflows.js';
import s from './quick.module.css';

/** Quick start: the list of one-page workflows, each with a ready / needs-setup badge when it can be told. */
export function QuickListPage() {
  const { t } = useLang();
  const { connected, call } = useQuickApi();
  const [ready, setReady] = useState({});       // workflow id -> boolean (absent = unknown)
  const [blocked, setBlocked] = useState(false);

  usePolling(async () => {
    const next = {};
    try { next.captions = !!findYoutubeTarget((await call('/targets'))?.targets); } catch { /* unknown */ }
    try { next.restream = ((await call('/stream'))?.relays || []).length > 0; } catch { /* unknown */ }
    setReady(next);
  }, 15000, { enabled: connected });

  return (
    <QuickShell title={t('quick.title')} back={false}>
      <p className={s.hint}>{t('quick.intro')}</p>
      <div className={s.flows}>
        {QUICK_WORKFLOWS.map(w => (
          <div key={w.id} className={s.flowCard} data-testid={`workflow-${w.id}`}>
            <div className={s.flowText}>
              <div className={s.flowTitle}>{t(`quick.workflow.${w.id}.title`)}</div>
              <p className={s.hint}>{t(`quick.workflow.${w.id}.desc`)}</p>
              {w.id in ready && (
                <span className={`${s.badge} ${ready[w.id] ? s.badgeOk : ''}`}>
                  {ready[w.id] ? t('quick.ready') : t('quick.needsSetup')}
                </span>
              )}
            </div>
            <div className={s.row}>
              <Link href={w.path} className="btn btn--primary btn--sm">{t('quick.open')}</Link>
              <button type="button" className="btn btn--sm" onClick={() => setBlocked(!openWorkflowWindow(w))}>
                {t('quick.openWindow')}
              </button>
            </div>
          </div>
        ))}
      </div>
      {blocked && <p className={s.error} role="alert">{t('quick.popupBlocked')}</p>}
    </QuickShell>
  );
}
