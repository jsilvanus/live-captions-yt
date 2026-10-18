// SHARED-COMPONENT NOTICE: this panel exists in more than one place (SaarnaVideo `src/components/jobs-panel/`, LCYT
// `packages/lcyt-web/src/components/jobs-panel/`). It is copied, not a shared package: there is no single source of truth,
// so when you change one copy, look at the others. Everything app-specific comes in through props (see README.md).

import { useCallback, useEffect, useRef, useState } from 'react';
import { fleetStripParts } from './fleet-strip.js';
import { canCancelJob, formatJobAge, isActiveJob, jobDetail, jobPercent, modeSymbol, nextConfirm, pollInterval } from './job-panel.js';
import styles from './JobsPanel.module.css';

/**
 * Badge and drop-down of the jobs (queued, running, recently finished) with an optional cancel button and fleet strip.
 *
 * Props:
 *  - `t(key, params?)`  translate function.
 *  - `loadJobs()`       resolves `{ jobs: PanelJob[], counts: { running, queued } }`; throw to show "could not load".
 *  - `loadStrip?()`     resolves `{ enabled: true, ...FleetStripData }`, `{ enabled: false }` or null; leave out for no strip.
 *  - `cancelJob?(job)`  cancels a queued or running job; leave out for no cancel button. Throw on failure. The button is
 *                       offered when `cancelJob` is given, the job is active and `job.cancellable !== false` (the backend
 *                       decides; LCYT sends `cancellable: false` for live/relay rows). Clicking asks "Cancel this job? Yes / No" first.
 *  - `typeLabel?(type)` label of a job type ("Render", ...); default: the raw type.
 */
export default function JobsPanel({ t, loadJobs, loadStrip, cancelJob, typeLabel = (type) => type }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [strip, setStrip] = useState(null);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState(() => new Set());
  const [confirming, setConfirming] = useState(null); // id of the job whose cancel is being confirmed
  const [cancelError, setCancelError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrap = useRef(null);

  const refresh = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const [jobs, nextStrip] = await Promise.all([loadJobs(), loadStrip ? loadStrip().catch(() => null) : Promise.resolve(null)]);
      setData(jobs);
      setFailed(false);
      if (nextStrip) setStrip(nextStrip);
      setNow(Date.now());
    } catch {
      setFailed(true);
    }
  }, [loadJobs, loadStrip]);

  const active = data ? data.counts.running + data.counts.queued : 0;
  useEffect(() => {
    let timer;
    let stopped = false;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, pollInterval(open, active));
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, active, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    const onDown = (event) => { if (wrap.current && !wrap.current.contains(event.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  async function cancel(job) {
    if (!cancelJob) return;
    setCancelError(false);
    setConfirming((current) => nextConfirm(current, 'yes', job.id));
    setCancelling((prev) => new Set(prev).add(job.id));
    try {
      await cancelJob(job);
    } catch {
      setCancelError(true);
    } finally {
      setCancelling((prev) => { const next = new Set(prev); next.delete(job.id); return next; });
      void refresh();
    }
  }

  const stripText = strip && strip.enabled ? fleetStripParts(strip, t).join(' · ') : '';
  const activeJobs = data?.jobs.filter(isActiveJob) ?? [];
  const recentJobs = data?.jobs.filter((job) => !isActiveJob(job)) ?? [];

  const renderJob = (job) => {
    const percent = jobPercent(job);
    const detail = jobDetail(job);
    const mode = modeSymbol(job.mode);
    const statusLabel = job.cancelRequested && isActiveJob(job) ? t('jobs.cancelRequested') : t(`jobStatus.${job.status}`);
    return (
      <li key={job.id} className={styles.row}>
        <div className={styles.top}>
          <span className={styles.title}>{mode ? <span className={styles.mode} role="img" aria-label={t(mode.key)} title={t(mode.key)}>{mode.symbol}</span> : null}{typeLabel(job.type)} · {job.projectTitle}</span>
          <span className={styles.meta}>{formatJobAge(job.startedAt ?? job.createdAt, now, t)}</span>
        </div>
        <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className={`${styles.barFill} ${job.status === 'COMPLETED' ? styles.barDone : ''} ${job.status === 'FAILED' ? styles.barFailed : ''}`} style={{ width: `${percent}%` }} />
        </div>
        {detail ? <div className={`${styles.detail} ${job.status === 'FAILED' ? styles.error : ''}`}>{detail}</div> : null}
        <div className={styles.foot}>
          <span className={styles.status}>{statusLabel}{job.status === 'RUNNING' ? ` · ${percent} %` : ''}{job.workerId ? ` · ${job.workerId.slice(0, 12)}` : ''}</span>
          {canCancelJob(job, Boolean(cancelJob)) ? (
            confirming === job.id && !cancelling.has(job.id) ? (
              <span className={styles.confirm} role="group" aria-label={t('jobs.cancelConfirm')}>
                <span>{t('jobs.cancelConfirm')}</span>
                <button type="button" className={styles.cancel} onClick={() => void cancel(job)}>{t('jobs.cancelYes')}</button>
                <button type="button" className={styles.keep} onClick={() => setConfirming((current) => nextConfirm(current, 'no', job.id))}>{t('jobs.cancelNo')}</button>
              </span>
            ) : (
              <button type="button" className={styles.cancel} disabled={cancelling.has(job.id)} onClick={() => setConfirming((current) => nextConfirm(current, 'ask', job.id))}>
                {cancelling.has(job.id) ? t('jobs.cancelling') : t('jobs.cancel')}
              </button>
            )
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <button type="button" className={styles.button} aria-expanded={open} aria-label={open ? t('jobs.close') : t('jobs.open')} onClick={() => setOpen((value) => !value)}>
        <span>{t('jobs.title')}</span>
        <span className={`${styles.badge} ${active === 0 ? styles.badgeIdle : ''}`} title={t('jobs.badge', { count: active })}>{active}</span>
        {stripText ? <span className={styles.inlineStrip}>{stripText}</span> : null}
      </button>
      {open ? (
        <div className={styles.panel} role="region" aria-label={t('jobs.title')}>
          {stripText ? <p className={styles.strip}>{stripText}</p> : null}
          {failed ? <p className={styles.notice}>{t('jobs.loadFailed')}</p> : null}
          {cancelError ? <p className={`${styles.notice} ${styles.error}`}>{t('jobs.cancelFailed')}</p> : null}
          {data && data.jobs.length === 0 ? <p className={styles.empty}>{t('jobs.empty')}</p> : null}
          {activeJobs.length ? (<><h3 className={styles.heading}>{t('jobs.section.active')}</h3><ul className={styles.list}>{activeJobs.map(renderJob)}</ul></>) : null}
          {recentJobs.length ? (<><h3 className={styles.heading}>{t('jobs.section.recent')}</h3><ul className={styles.list}>{recentJobs.map(renderJob)}</ul></>) : null}
        </div>
      ) : null}
    </div>
  );
}
