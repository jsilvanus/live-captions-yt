/**
 * SHARED-COMPONENT NOTICE: the jobs panel (this folder) exists in more than one place: SaarnaVideo
 * (`src/components/jobs-panel/`) and LCYT (`packages/lcyt-web/src/components/jobs-panel/`). It is copied, not a shared
 * package, and there is no single source of truth: when you change one, look at the others and port what fits.
 * See README.md in this folder.
 */

/**
 * @typedef {(key: string, params?: Record<string, string | number>) => string} Translate
 *   Translate function the panel needs (keys are listed in README.md).
 *
 * @typedef {object} PanelJob
 * @property {string} id
 * @property {string} projectId
 * @property {string} projectTitle
 * @property {string} type
 * @property {string} status
 * @property {string | null} phase
 * @property {number} progress
 * @property {string | null} message
 * @property {string | null} error
 * @property {string | null} workerId
 * @property {boolean} cancelRequested
 * @property {string} createdAt
 * @property {string | null} startedAt
 * @property {string | null} completedAt
 */

export const isActiveJob = (job) => job.status === 'QUEUED' || job.status === 'RUNNING';

export const POLL_ACTIVE_MS = 3000;
export const POLL_IDLE_MS = 15000;

/** The panel polls every 3 s while it is open or something is active, every 15 s otherwise. */
export const pollInterval = (open, activeCount) => (open || activeCount > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS);

/** "5 min ago" style age of an ISO time. */
export function formatJobAge(iso, now, t) {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t('jobs.ago.s', { n: seconds });
  if (seconds < 3600) return t('jobs.ago.m', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('jobs.ago.h', { n: Math.floor(seconds / 3600) });
  return t('jobs.ago.d', { n: Math.floor(seconds / 86400) });
}

/** Progress bar value 0-100: finished jobs are full or empty, a queued job has none. */
export function jobPercent(job) {
  if (job.status === 'COMPLETED') return 100;
  if (job.status === 'QUEUED') return 0;
  return Math.min(100, Math.max(0, Math.round(job.progress || 0)));
}

/** The line under the title: the worker's message, else the phase, else (failed) the error. */
export function jobDetail(job) {
  if (job.status === 'FAILED' && job.error) return job.error;
  return job.message || job.phase || '';
}
