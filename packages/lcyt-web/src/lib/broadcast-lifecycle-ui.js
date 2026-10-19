/**
 * Pure helpers for the broadcast lifecycle controls (plan_broadcast_lifecycle.md PR 4).
 * The backend (`/broadcasts/:id/<action>`) is the authority; this only decides which
 * buttons to offer and which broadcast to propose.
 */

export const STATUS_LABELS = {
  draft: 'Draft', scheduled: 'Scheduled', staging: 'Staging', live: 'Live', stopping: 'Stopping',
  stopped: 'Stopped', completed: 'Completed', archived: 'Archived', cancelled: 'Cancelled',
};

/** Statuses of the one broadcast a project may run at a time. */
export const RUNNING = ['staging', 'live', 'stopping', 'stopped'];

/**
 * Buttons per status, in the order they are shown. `kind` is a style hint
 * (`primary` the usual next step, `danger` ends something).
 * @param {string} status
 * @returns {Array<{ action: 'stage'|'go-live'|'stop'|'complete'|'cancel'|'restore', label: string, kind: 'primary'|'danger'|'plain' }>}
 */
export function actionsFor(status) {
  switch (status) {
    case 'draft':
    case 'scheduled': return [
      { action: 'stage', label: 'Stage', kind: 'primary' },
      { action: 'cancel', label: 'Cancel', kind: 'plain' },
    ];
    case 'staging': return [
      { action: 'go-live', label: 'Go live', kind: 'primary' },
      { action: 'stage', label: 'Retry staging', kind: 'plain' },
      { action: 'stop', label: 'Stop', kind: 'danger' },
    ];
    case 'live': return [{ action: 'stop', label: 'Stop', kind: 'danger' }];
    case 'stopping': return [{ action: 'stop', label: 'Finish stopping', kind: 'danger' }];
    case 'stopped': return [
      { action: 'stage', label: 'Go up again', kind: 'primary' },
      { action: 'complete', label: 'Complete', kind: 'plain' },
    ];
    case 'cancelled': return [{ action: 'restore', label: 'Restore', kind: 'plain' }];
    default: return [];
  }
}

/**
 * The broadcast to show when nothing is running: the draft or scheduled one whose
 * start is nearest to now (within `windowMs`), else the newest draft without a time.
 * @param {Array<{ id: string, status: string, scheduledStart?: string|null, createdAt?: string }>} list
 * @param {number} [now]
 * @param {number} [windowMs]
 */
export function pickUpcoming(list, now = Date.now(), windowMs = 12 * 3600_000) {
  const open = (list || []).filter((b) => b.status === 'draft' || b.status === 'scheduled');
  let best = null;
  let bestDist = Infinity;
  for (const b of open) {
    const t = b.scheduledStart ? Date.parse(b.scheduledStart) : NaN;
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - now);
    if (d <= windowMs && d < bestDist) { best = b; bestDist = d; }
  }
  if (best) return best;
  return open.find((b) => !b.scheduledStart) || null;
}

/** True when every blocking finding is only a warning (so "go anyway" with force is possible). */
export function canForce(findings) {
  return Array.isArray(findings) && findings.length > 0 && findings.every((f) => f.severity === 'warn');
}
