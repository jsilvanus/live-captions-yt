/**
 * Processing steps of egress outputs (plan_egress_outputs.md PR 3): the DSK step.
 *
 * An output whose `dsk` list has viewports (composite-mode ones aside, see `effectiveDskViewports`) gets one ffmpeg that
 * reads the output's source path, composites each viewport's own stream (`dsk/<apiKey>__<viewport>`, chroma-keyed when the
 * viewport says so, scaled to the source size) and publishes `out-<id>-dsk` to MediaMTX. Crops and relay slots built on that
 * output read this path (`outputSourcePath`).
 *
 * `OutputStepManager` supervises these ffmpeg runs the way FanoutSupervisor does for fan-outs: through the ffmpeg runner
 * factory (`FFMPEG_RUNNER=spawn|fleet`), restart with backoff, a reconcile poll against the MediaMTX API. A step runs only
 * while its source path is ready, with the viewports that are ready at that moment; when the set of ready viewports changes
 * it is restarted, so a viewport going away never takes the output down.
 *
 * Not yet: multi-instance ownership (every instance would try to run a step; MediaMTX refuses the second publisher), relay
 * slots reading `out-<id>-dsk` (PR 4).
 */

import { createHash } from 'node:crypto';
import logger from 'lcyt/logger';
import { createFfmpegRunner } from 'lcyt-compute/ffmpeg';
import { outputDskPath, outputSourcePath, effectiveDskViewports } from './output-paths.js';
import { buildGroupArgs, groupRequires } from './output-group-plan.js';

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 15000;
const HEALTHY_AFTER_MS = 30000;
const DEFAULT_POLL_MS = 3000;
export const DEFAULT_MAX_OUTPUT_STEPS = 4;
export const DEFAULT_MAX_GROUP_MEMBERS = 4;

const sha = (s, n = 12) => createHash('sha1').update(s).digest('hex').slice(0, n);

/**
 * ffmpeg arguments of a DSK step. Inputs: 0 = the source, 1..n = the viewport streams (later = on top). The video is
 * re-encoded; audio is copied from the source. A one-member case of `buildGroupArgs`.
 * @param {{ sourceUrl: string, viewports: Array<{ url: string, chromaKey?: object|null }>, outputUrl: string, videoBitrate?: string }} p
 * @returns {string[]}
 */
export function buildDskStepArgs({ sourceUrl, viewports, outputUrl, videoBitrate = null }) {
  return buildGroupArgs({ sourceUrl, members: [{ viewports, outputUrl, videoBitrate }] });
}

export class OutputStepManager {
  /**
   * @param {{
   *   db: object, mediamtx: object|null, settings?: { get: (key: string) => any }|null,
   *   runnerFactory?: (opts: object) => any, pollMs?: number|null,
   * }} opts
   */
  constructor({ db, mediamtx, settings = null, runnerFactory = createFfmpegRunner, pollMs = null } = {}) {
    this._db = db;
    this._mtx = mediamtx;
    this._settings = settings;
    this._runnerFactory = runnerFactory;
    this._pollOverride = pollMs;
    /** @type {Map<string, any>} step path -> state */
    this._steps = new Map();
    this._timer = null;
    this._busy = null;
    this._skipped = [];
  }

  _get(key, envName, fallback) {
    const v = this._settings ? this._settings.get(key) : process.env[envName];
    return v === undefined || v === null || v === '' ? fallback : v;
  }

  /** `outputs.steps_active` (env OUTPUT_STEPS_ACTIVE): the whole step layer can be switched off. Default on. */
  get active() {
    const v = this._get('outputs.steps_active', 'OUTPUT_STEPS_ACTIVE', '1');
    return !(v === false || v === 0 || v === '0' || v === 'false');
  }

  get maxSteps() {
    const n = Number(this._get('outputs.max_steps', 'MAX_OUTPUT_STEPS', DEFAULT_MAX_OUTPUT_STEPS));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_OUTPUT_STEPS;
  }

  _rtspBase() {
    const local = String(this._get('mediamtx.rtsp_base_url', 'MEDIAMTX_RTSP_BASE_URL', 'rtsp://127.0.0.1:8554'));
    const fleet = this._get('mediamtx.rtsp_fleet_base_url', 'MEDIAMTX_RTSP_FLEET_BASE_URL', '');
    return String(fleet || local).replace(/\/$/, '');
  }

  _rtmpBase() {
    // On a fleet worker the app host's 127.0.0.1 is not MediaMTX: MEDIAMTX_RTMP_FLEET_BASE_URL (like the RTSP one) names it.
    const fleet = this._get('mediamtx.rtmp_fleet_base_url', 'MEDIAMTX_RTMP_FLEET_BASE_URL', '');
    const local = this._get('mediamtx.rtmp_base_url', 'MEDIAMTX_RTMP_BASE_URL', 'rtmp://127.0.0.1:1935');
    return String(fleet || local).replace(/\/$/, '');
  }

  _requires() {
    const raw = String(this._get('mediamtx.fleet_requires', 'MEDIAMTX_FLEET_REQUIRES', ''));
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  _pollMs() {
    if (this._pollOverride) return this._pollOverride;
    const n = Number(this._get('outputs.step_poll_ms', 'OUTPUT_STEP_POLL_MS', 0));
    return n > 0 ? n : DEFAULT_POLL_MS;
  }

  /** `outputs.max_group_members` (env MAX_GROUP_MEMBERS): most outputs one lock group may render in one ffmpeg. */
  get maxGroupMembers() {
    const n = Number(this._get('outputs.max_group_members', 'MAX_GROUP_MEMBERS', DEFAULT_MAX_GROUP_MEMBERS));
    return Number.isFinite(n) && n > 1 ? Math.floor(n) : DEFAULT_MAX_GROUP_MEMBERS;
  }

  /**
   * Every ffmpeg run the database asks for right now, one entry per process ("unit"): an enabled output with at least one
   * effective viewport runs alone, outputs of one lock group that read the same input run together in one process. At most
   * `maxSteps` processes per project (crops count towards the limit too; the first outputs in sort order win).
   * @returns {Promise<Array<{ key: string, outputId: string, name: string, path: string, groupId: string|null, apiKey: string, sourcePath: string, members: Array<{ outputId: string, name: string, path: string, viewports: Array<{ name: string, path: string, chromaKey: object|null }> }> }>>}
   */
  async desiredSteps() {
    const rows = await this._db.outputs.findMany({
      where: { enabled: 1 },
      orderBy: [{ owner_api_key: 'asc' }, { sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    });
    const perProject = new Map();
    const wanted = [];
    const groupUnits = new Map(); // `${groupId}|${sourcePath}` -> unit
    this._skipped = [];
    for (const row of rows) {
      const used = perProject.get(row.owner_api_key) ?? 0;
      const cropCost = row.crop_enabled === 1 ? 1 : 0;
      let names = [];
      try { names = JSON.parse(row.dsk_json || '[]'); } catch { /* bad json = no DSK */ }
      const viewports = await effectiveDskViewports(this._db, row.owner_api_key, names, this._settings);
      let cost = cropCost;
      if (viewports.length) {
        const sourcePath = await outputSourcePath(this._db, row.owner_api_key, row.id, null, this._settings);
        const member = { outputId: row.id, name: row.name, path: outputDskPath(row.id), viewports };
        const groupKey = row.group_id && row.crop_enabled !== 1 && sourcePath ? `${row.group_id}|${sourcePath}` : null;
        const unit = groupKey ? groupUnits.get(groupKey) : null;
        if (unit) {
          // joins the process of its group: no extra process, only one more rendition
          if (unit.members.length >= this.maxGroupMembers) {
            this._skipped.push({ outputId: row.id, reason: `more than ${this.maxGroupMembers} outputs in one lock group` });
          } else {
            unit.members.push(member);
          }
        } else if (used + cost + 1 > this.maxSteps) {
          this._skipped.push({ outputId: row.id, reason: `more than ${this.maxSteps} steps in this project` });
        } else {
          cost += 1;
          if (sourcePath) {
            const u = { key: groupKey ? `group:${groupKey}` : outputDskPath(row.id), outputId: row.id, name: row.name, path: member.path, groupId: groupKey ? row.group_id : null, apiKey: row.owner_api_key, sourcePath, members: [member] };
            wanted.push(u);
            if (groupKey) groupUnits.set(groupKey, u);
          }
        }
      }
      perProject.set(row.owner_api_key, used + cost);
    }
    return wanted;
  }

  async _ready(path) {
    if (!this._mtx) return false;
    try {
      return (await this._mtx.getPath(path))?.ready === true;
    } catch (err) {
      if (err?.statusCode === 404) return false;
      return null; // unreachable: leave things as they are
    }
  }

  /** Start / stop / restart steps so they match the database and MediaMTX. Serialised: one pass at a time. */
  reconcile() {
    this._busy = (this._busy ?? Promise.resolve())
      .then(() => this._reconcileNow())
      .catch((err) => logger.warn(`[output-steps] reconcile failed: ${err.message}`));
    return this._busy;
  }

  async _reconcileNow() {
    if (!this.active || !this._mtx) {
      await this._stopMissing(new Set());
      return;
    }
    const wanted = await this.desiredSteps();
    await this._stopMissing(new Set(wanted.map(w => w.key)));
    for (const w of wanted) {
      const srcReady = await this._ready(w.sourcePath);
      if (srcReady === null) continue;
      let st = this._steps.get(w.key);
      if (!srcReady) {
        if (st?.runner) await this._stopRunner(st);
        if (st) { clearTimeout(st.timer); st.timer = null; st.backoff = BACKOFF_START_MS; }
        continue;
      }
      // each member runs with the viewports that are ready at this moment
      const members = [];
      for (const m of w.members) {
        const ready = [];
        for (const v of m.viewports) {
          const r = await this._ready(v.path);
          if (r) ready.push(v);
        }
        members.push({ ...m, viewports: ready });
      }
      const specHash = sha(JSON.stringify([w.sourcePath, members.map(m => [m.path, m.viewports.map(v => [v.path, v.chromaKey ?? null])])]));
      if (!st) {
        st = { key: w.key, path: members[0].path, groupId: w.groupId, apiKey: w.apiKey, runner: null, restarts: 0, backoff: BACKOFF_START_MS, timer: null, startedAt: 0, specHash: null };
        this._steps.set(w.key, st);
      }
      st.path = members[0].path;
      st.name = members.map(m => m.name).join('+');
      st.outputIds = members.map(m => m.outputId);
      st.spec = { sourcePath: w.sourcePath, members };
      if (st.runner && st.specHash !== specHash) await this._stopRunner(st);
      st.specHash = specHash;
      if (!st.runner && !st.timer) await this._start(st);
    }
    if (this._steps.size) this._ensurePolling(); else this._stopPolling();
  }

  async _start(st) {
    const tag = `[output-step:${st.name.slice(0, 40)}]`;
    const base = this._rtspBase();
    const rtmp = this._rtmpBase();
    const members = st.spec.members.map(m => ({
      viewports: m.viewports.map(v => ({ url: `${base}/${v.path}`, chromaKey: v.chromaKey })),
      outputUrl: `${rtmp}/${m.path}`,
    }));
    const args = buildGroupArgs({ sourceUrl: `${base}/${st.spec.sourcePath}`, members });
    const jobId = `ostep-${sha(`${st.key}|${st.specHash}`, 16)}-${st.restarts}`;
    let runner;
    try {
      runner = this._runnerFactory({
        runner: this._get('compute.ffmpeg_runner', 'FFMPEG_RUNNER', 'spawn'),
        cmd: 'ffmpeg',
        args,
        name: tag,
        stdin: 'ignore',
        purpose: 'output-step',
        apiKey: st.apiKey,
        jobId,
        class: 'stream',
        priority: 500,
        requires: [...groupRequires(members), ...this._requires()],
      });
      st.runner = runner;
      st.startedAt = Date.now();
      runner.on('error', (err) => logger.error(`${tag} ffmpeg error: ${err.message}`));
      runner.on('close', (info) => this._onClose(st, runner, info));
      await runner.start();
      const n = st.spec.members.length;
      logger.info(`${tag} DSK step started for '${st.path}' (${st.spec.members.reduce((a, m) => a + m.viewports.length, 0)} viewport(s)${n > 1 ? `, ${n} locked outputs in one ffmpeg` : ''})${runner.where ? ` on ${runner.where}` : ''}`);
    } catch (err) {
      logger.warn(`${tag} could not start DSK step '${st.path}': ${err.message}`);
      if (st.runner === runner) st.runner = null;
      this._scheduleRestart(st);
    }
  }

  _onClose(st, runner, info) {
    if (st.runner !== runner) return; // replaced or stopped on purpose
    st.runner = null;
    if (Date.now() - st.startedAt > HEALTHY_AFTER_MS) st.backoff = BACKOFF_START_MS;
    if (this._steps.get(st.key) !== st) return;
    logger.warn(`[output-steps] '${st.path}' ffmpeg ended (code ${info?.code ?? '?'}); checking whether to restart`);
    this._scheduleRestart(st);
  }

  _scheduleRestart(st) {
    if (st.timer || this._steps.get(st.key) !== st) return;
    const delay = st.backoff;
    st.backoff = Math.min(st.backoff * 2, BACKOFF_MAX_MS);
    st.restarts += 1;
    st.timer = setTimeout(() => { st.timer = null; this.reconcile(); }, delay);
    st.timer.unref?.();
  }

  async _stopMissing(keep) {
    for (const [path, st] of [...this._steps]) {
      if (keep.has(path)) continue;
      this._steps.delete(path);
      clearTimeout(st.timer);
      await this._stopRunner(st);
    }
    if (!this._steps.size) this._stopPolling();
  }

  async _stopRunner(st) {
    const runner = st.runner;
    st.runner = null;
    if (!runner) return;
    try { await runner.stop?.(); } catch { /* already gone */ }
  }

  _ensurePolling() {
    if (this._timer) return;
    this._timer = setInterval(() => { this.reconcile(); }, this._pollMs());
    this._timer.unref?.();
  }

  _stopPolling() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /** Start the periodic pass (called once at startup); the poll also runs while steps exist. */
  start() {
    this._ensurePolling();
    return this.reconcile();
  }

  /** Snapshot for status routes and tests. */
  status() {
    return {
      active: this.active,
      steps: [...this._steps.values()].map(st => ({
        outputId: st.outputIds?.[0] ?? null, outputIds: st.outputIds ?? [], groupId: st.groupId ?? null,
        path: st.path, paths: st.spec?.members.map(m => m.path) ?? [], running: !!st.runner, where: st.runner?.where ?? null,
        viewports: [...new Set(st.spec?.members.flatMap(m => m.viewports.map(v => v.name)) ?? [])], restarts: st.restarts,
      })),
      skipped: this._skipped,
    };
  }

  async stopAll() {
    this._stopPolling();
    const all = [...this._steps.values()];
    this._steps.clear();
    await Promise.all(all.map(st => { clearTimeout(st.timer); return this._stopRunner(st); }));
  }
}
