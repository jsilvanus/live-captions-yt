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

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 15000;
const HEALTHY_AFTER_MS = 30000;
const DEFAULT_POLL_MS = 3000;
export const DEFAULT_MAX_OUTPUT_STEPS = 4;

const sha = (s, n = 12) => createHash('sha1').update(s).digest('hex').slice(0, n);

/** `colorkey` filter body for a viewport's chromaKey, same rules as buildDskCompositeFilter (0xRRGGBB, similarity, blend). */
function colorkeyFilter(chromaKey) {
  const raw = typeof chromaKey.color === 'string' ? chromaKey.color.trim() : '#00B140';
  const color = /^#[0-9a-fA-F]{6}$/.test(raw) ? `0x${raw.slice(1)}` : raw.replace(/[^0-9a-zA-Z]/g, '') || '0x00B140';
  const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
  return `colorkey=${color}:${clamp01(chromaKey.similarity, 0.3)}:${clamp01(chromaKey.blend, 0.1)}`;
}

/**
 * ffmpeg arguments of a DSK step. Inputs: 0 = the source, 1..n = the viewport streams (later = on top). The video is
 * re-encoded; audio is copied from the source.
 * @param {{ sourceUrl: string, viewports: Array<{ url: string, chromaKey?: object|null }>, outputUrl: string, videoBitrate?: string }} p
 * @returns {string[]}
 */
export function buildDskStepArgs({ sourceUrl, viewports, outputUrl, videoBitrate = null }) {
  const args = ['-rtsp_transport', 'tcp', '-i', sourceUrl];
  for (const v of viewports) args.push('-rtsp_transport', 'tcp', '-i', v.url);
  const parts = [];
  let base = '[0:v]';
  viewports.forEach((v, i) => {
    const idx = i + 1;
    let ov = `[${idx}:v]`;
    if (v.chromaKey?.enabled) {
      parts.push(`${ov}${colorkeyFilter(v.chromaKey)}[k${idx}]`);
      ov = `[k${idx}]`;
    }
    // the viewport renders at its own size; fit it to the picture under it
    parts.push(`${ov}${base}scale2ref=w=main_w:h=main_h[s${idx}][b${idx}]`);
    parts.push(`[b${idx}][s${idx}]overlay=0:0:eof_action=pass[o${idx}]`);
    base = `[o${idx}]`;
  });
  const last = viewports.length ? base : '[0:v]';
  args.push('-filter_complex', parts.length ? parts.join(';') : '[0:v]null[o0]');
  args.push('-map', viewports.length ? last : '[o0]', '-map', '0:a?');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency');
  if (videoBitrate) args.push('-b:v', videoBitrate);
  args.push('-c:a', 'copy', '-f', 'flv', outputUrl);
  return args;
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
    return String(this._get('mediamtx.rtmp_base_url', 'MEDIAMTX_RTMP_BASE_URL', 'rtmp://127.0.0.1:1935')).replace(/\/$/, '');
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

  /**
   * Every DSK step the database asks for right now: enabled outputs with at least one effective viewport, at most `maxSteps`
   * steps per project (crops count towards the limit too; the first outputs in sort order win).
   * @returns {Promise<Array<{ apiKey: string, outputId: string, name: string, path: string, sourcePath: string, viewports: Array<{ name: string, path: string, chromaKey: object|null }> }>>}
   */
  async desiredSteps() {
    const rows = await this._db.outputs.findMany({
      where: { enabled: 1 },
      orderBy: [{ owner_api_key: 'asc' }, { sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    });
    const perProject = new Map();
    const wanted = [];
    this._skipped = [];
    for (const row of rows) {
      const used = perProject.get(row.owner_api_key) ?? 0;
      const cropCost = row.crop_enabled === 1 ? 1 : 0;
      let names = [];
      try { names = JSON.parse(row.dsk_json || '[]'); } catch { /* bad json = no DSK */ }
      const viewports = await effectiveDskViewports(this._db, row.owner_api_key, names, this._settings);
      let cost = cropCost;
      if (viewports.length) {
        if (used + cost + 1 > this.maxSteps) {
          this._skipped.push({ outputId: row.id, reason: `more than ${this.maxSteps} steps in this project` });
          perProject.set(row.owner_api_key, used + cost);
          continue;
        }
        const sourcePath = await outputSourcePath(this._db, row.owner_api_key, row.id, null, this._settings);
        cost += 1;
        if (sourcePath) {
          wanted.push({ apiKey: row.owner_api_key, outputId: row.id, name: row.name, path: outputDskPath(row.id), sourcePath, viewports });
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
    await this._stopMissing(new Set(wanted.map(w => w.path)));
    for (const w of wanted) {
      const srcReady = await this._ready(w.sourcePath);
      if (srcReady === null) continue;
      let st = this._steps.get(w.path);
      if (!srcReady) {
        if (st?.runner) await this._stopRunner(st);
        if (st) { clearTimeout(st.timer); st.timer = null; st.backoff = BACKOFF_START_MS; }
        continue;
      }
      const ready = [];
      for (const v of w.viewports) {
        const r = await this._ready(v.path);
        if (r) ready.push(v);
      }
      const specHash = sha(JSON.stringify([w.sourcePath, ready.map(v => [v.path, v.chromaKey ?? null])]));
      if (!st) {
        st = { path: w.path, outputId: w.outputId, apiKey: w.apiKey, name: w.name, runner: null, restarts: 0, backoff: BACKOFF_START_MS, timer: null, startedAt: 0, specHash: null };
        this._steps.set(w.path, st);
      }
      st.spec = { sourcePath: w.sourcePath, viewports: ready };
      if (st.runner && st.specHash !== specHash) await this._stopRunner(st);
      st.specHash = specHash;
      if (!st.runner && !st.timer) await this._start(st);
    }
    if (this._steps.size) this._ensurePolling(); else this._stopPolling();
  }

  async _start(st) {
    const tag = `[output-step:${st.name.slice(0, 20)}]`;
    const base = this._rtspBase();
    const args = buildDskStepArgs({
      sourceUrl: `${base}/${st.spec.sourcePath}`,
      viewports: st.spec.viewports.map(v => ({ url: `${base}/${v.path}`, chromaKey: v.chromaKey })),
      outputUrl: `${this._rtmpBase()}/${st.path}`,
    });
    const jobId = `ostep-${sha(`${st.path}|${st.specHash}`, 16)}-${st.restarts}`;
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
        requires: ['encoder:libx264', ...(st.spec.viewports.some(v => v.chromaKey?.enabled) ? ['filter:colorkey'] : []), ...this._requires()],
      });
      st.runner = runner;
      st.startedAt = Date.now();
      runner.on('error', (err) => logger.error(`${tag} ffmpeg error: ${err.message}`));
      runner.on('close', (info) => this._onClose(st, runner, info));
      await runner.start();
      logger.info(`${tag} DSK step started for '${st.path}' (${st.spec.viewports.length} viewport(s))${runner.where ? ` on ${runner.where}` : ''}`);
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
    if (this._steps.get(st.path) !== st) return;
    logger.warn(`[output-steps] '${st.path}' ffmpeg ended (code ${info?.code ?? '?'}); checking whether to restart`);
    this._scheduleRestart(st);
  }

  _scheduleRestart(st) {
    if (st.timer || this._steps.get(st.path) !== st) return;
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
        outputId: st.outputId, path: st.path, running: !!st.runner, where: st.runner?.where ?? null,
        viewports: st.spec?.viewports.map(v => v.name) ?? [], restarts: st.restarts,
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
