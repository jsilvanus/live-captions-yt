/**
 * Broadcast lifecycle service (plan_broadcast_lifecycle.md, section 2).
 *
 * A broadcast has its own state machine, independent of any caption session:
 *
 *   draft <-> scheduled -> staging -> live -> stopping -> stopped -> completed
 *                  \-> cancelled          \_ (stage again from stopped)
 *
 * `transition()` is the only writer of the running states. What a transition
 * does to the outside world (arming, recording, platform go-live, relay on/off,
 * caption clock sync, closing sessions) is a set of injected steps, so the state
 * machine is testable without MediaMTX or YouTube and the composition root
 * (`steps.js`) decides what each step really calls.
 *
 * Steps are idempotent. Each result is kept in `broadcasts.stage_report_json`
 * so a retry of a failed staging resumes instead of repeating finished work.
 */

import { RUNNING_STATUSES, getBroadcast } from '../db/broadcasts.js';
import { sqlNow } from '../db/helpers.js';

/** action -> allowed source states and the state it leads to ("stop" passes through `stopping`). */
export const TRANSITIONS = {
  stage:      { from: ['draft', 'scheduled', 'stopped', 'staging'], to: 'staging' },
  'go-live':  { from: ['staging'], to: 'live' },
  stop:       { from: ['staging', 'live', 'stopping'], to: 'stopped' },
  complete:   { from: ['stopped'], to: 'completed' },
  cancel:     { from: ['draft', 'scheduled'], to: 'cancelled' },
  restore:    { from: ['cancelled'], to: 'draft' },
};

/** Safety valve for a stage that was never finished: a step has a result or it is rerun. */
const STAGE_STEPS = ['preflight', 'outputsOn', 'platformStage', 'captionSync'];
const GO_LIVE_STEPS = ['platformGoLive', 'startRecording', 'arm', 'startCaptionSync'];
const STOP_STEPS = ['stopCaptionSync', 'disarm', 'stopRecording', 'outputsOff', 'platformStop'];
const COMPLETE_STEPS = ['platformComplete', 'closeSessions'];

export class LifecycleError extends Error {
  /** @param {string} message @param {number} status @param {object} [extra] */
  constructor(message, status = 409, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/**
 * @param {object} opts
 * @param {import('../db/connection.js').Db} opts.db
 * @param {{ publish: Function }|null} [opts.eventBus]
 * @param {Record<string, Function>} [opts.steps]  named step functions `(ctx) => Promise<any>`; a missing step is skipped
 * @param {(apiKey: string, broadcast: object) => Promise<{ captions: boolean, video: boolean, audio: boolean }>} [opts.deliverables]
 * @param {{ withLease: Function }|null} [opts.leases]  cluster leases; absent = no cross-instance lock
 * @param {{ warn: Function }} [opts.logger]
 */
export function createBroadcastLifecycle({
  db, eventBus = null, steps = {}, deliverables = null, leases = null, logger = console,
}) {
  async function loadOwned(apiKey, id) {
    const b = await getBroadcast(db, apiKey, id);
    if (!b) throw new LifecycleError('Broadcast not found', 404);
    return b;
  }

  function publish(apiKey, topic, data) {
    try { eventBus?.publish(apiKey, topic, data); } catch (err) { logger.warn(`[broadcast] publish ${topic} failed: ${err?.message}`); }
  }

  /** The project's broadcast that is in `staging|live|stopping|stopped`, if any. */
  async function current(apiKey) {
    const rows = await db.broadcasts.findMany({
      where: { api_key: apiKey, status: { in: [...RUNNING_STATUSES] } },
      orderBy: [{ updated_at: 'desc' }],
      select: { id: true },
    });
    if (!rows.length) return null;
    return getBroadcast(db, apiKey, rows[0].id);
  }

  async function otherRunning(apiKey, id) {
    return db.broadcasts.findFirst({
      where: { api_key: apiKey, id: { not: id }, status: { in: [...RUNNING_STATUSES] } },
      select: { id: true, title: true, status: true },
    });
  }

  async function computeDeliverables(apiKey, broadcast) {
    if (deliverables) return deliverables(apiKey, broadcast);
    const targets = await db.caption_targets.count({ where: { api_key: apiKey, enabled: 1 } });
    return { captions: targets > 0, video: false, audio: false };
  }

  /**
   * Findings only, no side effects. `error` findings block staging; `warn` ones
   * block it too unless `force` is set.
   * @returns {Promise<{ ok: boolean, findings: Array<{ code: string, severity: 'error'|'warn', message: string }> }>}
   */
  async function preflight(apiKey, id, { force = false } = {}) {
    const broadcast = await loadOwned(apiKey, id);
    const findings = [];
    const other = await otherRunning(apiKey, id);
    if (other) {
      findings.push({
        code: 'another_broadcast_running', severity: 'error',
        message: `Broadcast "${other.title || other.id}" is ${other.status}; complete or cancel it first`,
        broadcastId: other.id,
      });
    }
    const d = await computeDeliverables(apiKey, broadcast);
    if (!d.captions && !d.video && !d.audio) {
      findings.push({
        code: 'no_deliverables', severity: 'error',
        message: 'Nothing to broadcast: enable a caption target, a video feed out (DSK is enough) or an audio feed out',
      });
    }
    if (steps.preflight) {
      try {
        const extra = await steps.preflight({ db, apiKey, broadcast, deliverables: d });
        for (const f of extra || []) findings.push(f);
      } catch (err) {
        findings.push({ code: 'preflight_failed', severity: 'warn', message: `Pre-flight check could not run: ${err?.message}` });
      }
    }
    const blocking = findings.filter((f) => f.severity === 'error' || (!force && f.severity === 'warn'));
    return { ok: blocking.length === 0, findings, deliverables: d };
  }

  /** Compare-and-set on the status so two callers cannot both win a transition. */
  async function setStatus(apiKey, id, fromList, to, extra = {}) {
    const res = await db.broadcasts.updateMany({
      where: { api_key: apiKey, id, status: { in: fromList } },
      data: { status: to, updated_at: sqlNow(), ...extra },
    });
    return res.count > 0;
  }

  async function runSteps(names, ctx, report, { fatal = [] } = {}) {
    for (const name of names) {
      const fn = steps[name];
      if (!fn) continue;
      if (report.steps[name]?.status === 'ok') continue; // finished in an earlier attempt
      const entry = { status: 'running', startedAt: new Date().toISOString() };
      report.steps[name] = entry;
      try {
        const out = await fn({ ...ctx, report });
        entry.status = 'ok';
        if (out && typeof out === 'object' && out.note) entry.note = out.note;
        entry.finishedAt = new Date().toISOString();
        if (out && typeof out === 'object') ctx.results[name] = out;
      } catch (err) {
        entry.status = 'failed';
        entry.error = err?.message || String(err);
        entry.finishedAt = new Date().toISOString();
        publish(ctx.apiKey, 'broadcast.step_failed', { broadcastId: ctx.broadcast.id, step: name, error: entry.error, fatal: fatal.includes(name) });
        if (fatal.includes(name)) throw new LifecycleError(`Step "${name}" failed: ${entry.error}`, 502, { step: name });
        report.warnings.push({ step: name, error: entry.error });
      }
    }
  }

  async function saveReport(apiKey, id, report) {
    await db.broadcasts.updateMany({
      where: { api_key: apiKey, id },
      data: { stage_report_json: JSON.stringify(report), updated_at: sqlNow() },
    });
  }

  async function transitionLocked(apiKey, id, action, { force = false, reason = null, by = null } = {}) {
    const def = TRANSITIONS[action];
    if (!def) throw new LifecycleError(`Unknown action: ${action}`, 400);
    const broadcast = await loadOwned(apiKey, id);
    if (!def.from.includes(broadcast.status)) {
      throw new LifecycleError(`Cannot ${action} a broadcast that is ${broadcast.status}`, 409, { currentStatus: broadcast.status });
    }
    const from = broadcast.status;
    const ctx = { db, apiKey, broadcast, reason, by, results: {}, force };
    // One report per run up: a retry (stage or go-live again, stop after a failed stop)
    // keeps the finished steps; a fresh staging starts a new one.
    const fresh = action === 'stage' && from !== 'staging';
    const report = (!fresh && broadcast.stageReport?.steps)
      ? broadcast.stageReport
      : { startedAt: new Date().toISOString(), steps: {}, warnings: [] };

    if (action === 'cancel' || action === 'restore') {
      if (!(await setStatus(apiKey, id, def.from, def.to))) throw new LifecycleError('Broadcast changed state, try again', 409);
      publish(apiKey, 'broadcast.state_changed', { broadcastId: id, from, to: def.to, reason });
      return { broadcast: await getBroadcast(db, apiKey, id), report: null };
    }

    if (action === 'stage') {
      const pf = await preflight(apiKey, id, { force });
      if (!pf.ok) throw new LifecycleError('Pre-flight failed', 409, { code: 'preflight_failed', findings: pf.findings });
      if (from !== 'staging') {
        // First staging of this broadcast starts the caption sequence at 0 (2.5b);
        // going up again after a stop keeps counting.
        const data = { stage_report_json: JSON.stringify(report) };
        if (from !== 'stopped') { data.caption_sequence = 0; data.sync_failures = 0; data.sync_offset_ms = null; data.last_synced_at = null; }
        if (!(await setStatus(apiKey, id, def.from, 'staging', data))) throw new LifecycleError('Broadcast changed state, try again', 409);
        publish(apiKey, 'broadcast.state_changed', { broadcastId: id, from, to: 'staging', reason });
      }
      try {
        await runSteps(STAGE_STEPS, ctx, report, { fatal: ['outputsOn', 'platformStage'] });
        if (ctx.results.platformStage?.newPlatformBroadcast) {
          // A new YouTube broadcast is a new stream: its sequence starts again.
          await db.broadcasts.updateMany({ where: { api_key: apiKey, id }, data: { caption_sequence: 0, updated_at: sqlNow() } });
        }
      } catch (err) {
        await saveReport(apiKey, id, report);
        err.report = report;
        throw err; // stays in staging with the error; the operator retries or stops
      }
      await saveReport(apiKey, id, report);
      return { broadcast: await getBroadcast(db, apiKey, id), report };
    }

    if (action === 'go-live') {
      try {
        await runSteps(GO_LIVE_STEPS, ctx, report, { fatal: ['platformGoLive'] });
      } catch (err) {
        await saveReport(apiKey, id, report);
        err.report = report;
        throw err; // still staging
      }
      const extra = { stage_report_json: JSON.stringify(report) };
      if (!broadcast.actualStart) extra.actual_start = new Date().toISOString();
      if (!(await setStatus(apiKey, id, ['staging'], 'live', extra))) throw new LifecycleError('Broadcast changed state, try again', 409);
      publish(apiKey, 'broadcast.state_changed', { broadcastId: id, from, to: 'live', reason });
      return { broadcast: await getBroadcast(db, apiKey, id), report };
    }

    if (action === 'stop') {
      if (from !== 'stopping') {
        if (!(await setStatus(apiKey, id, def.from, 'stopping', { stage_report_json: JSON.stringify(report) }))) {
          throw new LifecycleError('Broadcast changed state, try again', 409);
        }
        publish(apiKey, 'broadcast.state_changed', { broadcastId: id, from, to: 'stopping', reason });
      }
      // A failing step never blocks the rest of a stop.
      await runSteps(STOP_STEPS, ctx, report);
      await setStatus(apiKey, id, ['stopping'], 'stopped', { stage_report_json: JSON.stringify(report) });
      publish(apiKey, 'broadcast.state_changed', { broadcastId: id, from: 'stopping', to: 'stopped', reason });
      return { broadcast: await getBroadcast(db, apiKey, id), report };
    }

    // complete
    await runSteps(COMPLETE_STEPS, ctx, report);
    const extra = { stage_report_json: JSON.stringify(report), armed: 0, actual_end: new Date().toISOString() };
    if (!(await setStatus(apiKey, id, ['stopped'], 'completed', extra))) throw new LifecycleError('Broadcast changed state, try again', 409);
    publish(apiKey, 'broadcast.state_changed', { broadcastId: id, from, to: 'completed', reason });
    return { broadcast: await getBroadcast(db, apiKey, id), report };
  }

  /**
   * Run one transition. Serialised per broadcast through the cluster lease when one is given.
   * @param {string} apiKey
   * @param {string} id
   * @param {'stage'|'go-live'|'stop'|'complete'|'cancel'|'restore'} action
   * @param {{ force?: boolean, reason?: string, by?: string }} [opts]
   * @returns {Promise<{ broadcast: object, report: object|null }>}
   */
  async function transition(apiKey, id, action, opts = {}) {
    if (!leases) return transitionLocked(apiKey, id, action, opts);
    const run = await leases.withLease(`broadcast:${id}`, 120_000, () => transitionLocked(apiKey, id, action, opts));
    if (!run.ran) throw new LifecycleError('Another instance is changing this broadcast', 409);
    return run.value;
  }

  return { transition, preflight, current, deliverables: computeDeliverables };
}
