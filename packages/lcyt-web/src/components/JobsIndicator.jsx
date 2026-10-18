import { useCallback, useMemo } from 'react';
import JobsPanel from './jobs-panel/JobsPanel.jsx';
import { useSessionContext } from '../contexts/SessionContext';
import { useLangOptional } from '../contexts/LangContext';
import { getMessages, translate } from '../lib/i18n';

const TYPE_KEYS = new Set(['FFMPEG', 'AUDITOR_LIVE']);

/** `t(key, params)` for the shared panel on top of lcyt-web's `translate`: fills `{name}` placeholders. */
export function makePanelT(messages) {
  return (key, params) => {
    const text = translate(messages, key);
    if (text === key) return key.startsWith('jobStatus.') ? key.slice('jobStatus.'.length) : key;
    return params ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole)) : text;
  };
}

/**
 * LCYT's wiring of the jobs panel (`components/jobs-panel/`, a component that is copied between apps, see its
 * README): where the jobs and the fleet strip come from (lcyt-backend `GET /jobs` and `/jobs/strip`, session token),
 * and what the types are called. `cancelJob` posts `/jobs/:id/cancel`; the backend marks rows `cancellable` (an allow-list that is empty today), so no button shows for live/relay rows.
 */
export default function JobsIndicator() {
  const session = useSessionContext();
  const lang = useLangOptional()?.lang ?? 'en';
  const t = useMemo(() => makePanelT(getMessages(lang)), [lang]);
  const backendUrl = (session.backendUrl || '').replace(/\/$/, '');
  const getToken = session.getSessionToken;

  const get = useCallback(async (path) => {
    const token = getToken?.();
    if (!backendUrl || !token) throw new Error('not connected');
    const res = await fetch(`${backendUrl}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [backendUrl, getToken]);

  const cancelJob = useCallback(async (job) => {
    const token = getToken?.();
    if (!backendUrl || !token) throw new Error('not connected');
    const res = await fetch(`${backendUrl}/api/v1/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, [backendUrl, getToken]);

  const loadJobs = useCallback(() => get('/jobs'), [get]);
  const loadStrip = useCallback(() => get('/jobs/strip').catch(() => null), [get]);
  const typeLabel = useCallback((type) => (TYPE_KEYS.has(type) ? t(`jobs.type.${type}`) : type), [t]);

  if (!session.connected) return null;
  return <JobsPanel t={t} loadJobs={loadJobs} loadStrip={loadStrip} typeLabel={typeLabel} cancelJob={cancelJob} />;
}
