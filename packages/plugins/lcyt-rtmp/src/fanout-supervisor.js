/**
 * FanoutSupervisor: runs the relay fan-outs that copy a MediaMTX path to its relay targets
 * (`ffmpeg -re -i rtsp://…/<path> -c copy -f tee "[f=flv]rtmp://…|…"`).
 *
 * Two modes (`mediamtx.fanout_mode`):
 *  - `hook`   (default, legacy): the command is registered as MediaMTX `runOnPublish` on the path,
 *             so ffmpeg runs inside the MediaMTX container. Needs an image that has ffmpeg.
 *  - `runner`: this class starts the same command through the ffmpeg runner factory
 *             (`FFMPEG_RUNNER=spawn` on this host, or `fleet` on an fffleet worker). MediaMTX only
 *             reports when a path becomes ready (`runOnReady`/`runOnNotReady` call
 *             POST /internal/mediamtx/path, see routes/mediamtx-hook.js); a reconcile poll of the
 *             MediaMTX API covers missed hooks and restarts. The fan-out runs while the path is
 *             ready and is restarted with a backoff if ffmpeg dies while the path is still ready.
 *
 * Plan: reports/mediamtx-ffmpeg-fleet-plan-2026-10-13.md (project files), docs/plans/plan_mediamtx_fanout_fleet.md.
 */

import { createHash } from 'node:crypto';
import logger from 'lcyt/logger';
import { createFfmpegRunner } from 'lcyt-compute/ffmpeg';

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 15000;
const HEALTHY_AFTER_MS = 30000;
const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 30000;

const sha = (s, n = 12) => createHash('sha1').update(s).digest('hex').slice(0, n);

/**
 * @typedef {object} FanoutSpec
 * @property {string} sourcePath  MediaMTX path as it appears in the RTSP URL (already URL-encoded)
 * @property {string} [audioPath] MediaMTX path (RTSP-encoded) whose audio replaces the source's own audio (video of
 *                                `sourcePath`, audio of `audioPath`, both stream-copied). Runner mode only: a hook-mode
 *                                registration is bound to one path, so there the audio override is ignored.
 * @property {string} [path]      the MediaMTX path name behind `sourcePath` (decoded) when the registration key (the
 *                                `pathName` argument of `set`) is not the path itself; hook mode registers on this path
 * @property {string} [tee]       `-f tee` target string, e.g. "[f=flv]rtmp://a/b|[f=flv]rtmp://c/d"
 * @property {string} [flvUrl]    single `-f flv` target (used instead of `tee`)
 * @property {string} [apiKey]
 * @property {string} [label]
 * @property {boolean} [kick]     hook mode only: kick the current publisher so the hook fires now
 */

export class FanoutSupervisor {
  /**
   * @param {{
   *   mediamtx: object,
   *   settings?: { get: (key: string) => any }|null,
   *   runnerFactory?: (opts: object) => any,
   *   pollMs?: number,
   * }} opts
   */
  constructor({ mediamtx, settings = null, runnerFactory = createFfmpegRunner, pollMs = null } = {}) {
    this._mtx = mediamtx;
    this._settings = settings;
    this._runnerFactory = runnerFactory;
    this._pollOverride = pollMs;
    /** @type {Map<string, any>} */
    this._paths = new Map();
    this._timer = null;
  }

  _get(key, envName, fallback) {
    const v = this._settings ? this._settings.get(key) : process.env[envName];
    return v === undefined || v === null || v === '' ? fallback : v;
  }

  /** `hook` or `runner`. */
  get mode() {
    return this._get('mediamtx.fanout_mode', 'MEDIAMTX_FANOUT_MODE', 'hook') === 'runner' ? 'runner' : 'hook';
  }

  _rtspBase(forRunner) {
    const local = String(this._get('mediamtx.rtsp_base_url', 'MEDIAMTX_RTSP_BASE_URL', 'rtsp://127.0.0.1:8554'));
    const fleet = forRunner && this._get('mediamtx.rtsp_fleet_base_url', 'MEDIAMTX_RTSP_FLEET_BASE_URL', '');
    return String(fleet || local).replace(/\/$/, '');
  }

  _runnerName() {
    return this._get('compute.ffmpeg_runner', 'FFMPEG_RUNNER', 'spawn');
  }

  _requires() {
    const raw = String(this._get('mediamtx.fleet_requires', 'MEDIAMTX_FLEET_REQUIRES', ''));
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  /** Poll interval: fast while no hook secret is configured (nothing else tells us), slow with hooks. */
  _pollMs() {
    if (this._pollOverride) return this._pollOverride;
    const configured = Number(this._get('mediamtx.fanout_poll_ms', 'MEDIAMTX_FANOUT_POLL_MS', 0));
    if (configured > 0) return configured;
    return this._get('mediamtx.hook_secret', 'MEDIAMTX_HOOK_SECRET', '') ? POLL_SLOW_MS : POLL_FAST_MS;
  }

  /** @param {FanoutSpec} spec */
  _hookCommand(spec) {
    const out = spec.flvUrl ? `-f flv ${spec.flvUrl}` : `-f tee "${spec.tee}"`;
    return `ffmpeg -re -i ${this._rtspBase(false)}/${spec.sourcePath} -c copy ${out}`;
  }

  /** @param {FanoutSpec} spec */
  _runnerArgs(spec) {
    const out = spec.flvUrl ? ['-f', 'flv', spec.flvUrl] : ['-f', 'tee', spec.tee];
    // TCP: the worker may be on another host, and UDP does not survive NAT or a VPN.
    const base = this._rtspBase(true);
    if (spec.audioPath) {
      return ['-rtsp_transport', 'tcp', '-re', '-i', `${base}/${spec.sourcePath}`, '-rtsp_transport', 'tcp', '-re', '-i', `${base}/${spec.audioPath}`,
        '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', ...out];
    }
    return ['-rtsp_transport', 'tcp', '-re', '-i', `${base}/${spec.sourcePath}`, '-c', 'copy', ...out];
  }

  async _upsert(name, config) {
    try {
      await this._mtx.addPath(name, config);
    } catch (err) {
      if (typeof this._mtx.patchPath !== 'function') throw err;
      await this._mtx.patchPath(name, config);
    }
  }

  /**
   * Register (or replace) the fan-out for a path.
   * @param {string} pathName  MediaMTX path name (decoded)
   * @param {FanoutSpec} spec
   */
  async set(pathName, spec) {
    if (this.mode === 'hook') {
      const hookPath = spec.path ?? pathName;
      await this._upsert(hookPath, { runOnPublish: this._hookCommand(spec), runOnPublishRestart: true });
      if (spec.kick) this._mtx.kickPath(hookPath).catch(() => {});
      return;
    }
    const specHash = sha(JSON.stringify([spec.sourcePath, spec.audioPath ?? null, spec.tee ?? null, spec.flvUrl ?? null]));
    let st = this._paths.get(pathName);
    if (st && st.specHash !== specHash) {
      // Targets changed: stop first, a second connection to the same ingest URL would be refused.
      await this._stopRunner(st);
    }
    if (!st) {
      st = { pathName, runner: null, restarts: 0, backoff: BACKOFF_START_MS, timer: null, chain: Promise.resolve(), startedAt: 0 };
      this._paths.set(pathName, st);
    }
    st.spec = spec;
    st.specHash = specHash;
    st.restarts = st.specHash === specHash && st.runner ? st.restarts : 0;
    this._ensurePolling();
    await this._evaluate(st);
  }

  /** Remove the fan-out for a path (hook mode: delete the path config). */
  async clear(pathName) {
    if (this.mode === 'hook') {
      try { await this._mtx.deletePath(pathName.split('|a|')[0]); } catch { /* path may not exist */ }
      return;
    }
    const st = this._paths.get(pathName);
    if (!st) return;
    this._paths.delete(pathName);
    clearTimeout(st.timer);
    await this._stopRunner(st);
    if (this._paths.size === 0) this._stopPolling();
  }

  /** A path became ready or not ready (MediaMTX hook). Unknown paths are ignored. */
  async onPathEvent(pathName, ready) {
    const hit = [...this._paths.values()].filter(st => st.pathName === pathName || st.spec?.path === pathName || st.spec?.audioPath === pathName);
    if (!hit.length) return false;
    // A hook about a registration's own path says whether that path is ready; for its audio path it only means "look again".
    await Promise.all(hit.map(st => this._evaluate(st, st.pathName === pathName || st.spec?.path === pathName ? (ready === undefined ? undefined : !!ready) : undefined)));
    return true;
  }

  /** Check every desired fan-out against MediaMTX (poll tick, startup). */
  async reconcile() {
    await Promise.all([...this._paths.values()].map(st => this._evaluate(st)));
  }

  /** Snapshot for status routes and tests. */
  status() {
    return [...this._paths.values()].map(st => ({
      path: st.pathName,
      running: !!st.runner,
      where: st.runner?.where ?? null,
      jobId: st.runner?.jobId ?? null,
      restarts: st.restarts,
    }));
  }

  async stopAll() {
    this._stopPolling();
    const all = [...this._paths.values()];
    this._paths.clear();
    await Promise.all(all.map(st => { clearTimeout(st.timer); return this._stopRunner(st); }));
  }

  // --- internals -------------------------------------------------------------

  _ensurePolling() {
    if (this._timer) return;
    this._timer = setInterval(() => { this.reconcile().catch(() => {}); }, this._pollMs());
    this._timer.unref?.();
  }

  _stopPolling() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /** Serialise evaluations per path so a hook and a poll tick never start two runners. */
  _evaluate(st, knownReady) {
    st.chain = st.chain.then(() => this._evaluateNow(st, knownReady)).catch((err) => {
      logger.warn(`[fanout] ${st.pathName}: ${err.message}`);
    });
    return st.chain;
  }

  async _readiness(st, knownReady) {
    if (knownReady === false) return { ready: false };
    try {
      const info = await this._mtx.getPath(st.spec?.path ?? st.pathName);
      if (info?.ready !== true) return { ready: false };
      // An audio override needs its audio path up too, or ffmpeg would fail at once and spin on backoff.
      if (st.spec?.audioPath) {
        try {
          const audio = await this._mtx.getPath(decodeURIComponent(st.spec.audioPath));
          if (audio?.ready !== true) return { ready: false };
        } catch (err) {
          if (err?.statusCode === 404) return { ready: false };
          throw err;
        }
      }
      return { ready: true, readyTime: info?.readyTime ?? '' };
    } catch (err) {
      if (err?.statusCode === 404) return { ready: false };
      // MediaMTX unreachable: trust a hook that said ready, otherwise leave things as they are.
      return knownReady === true ? { ready: true, readyTime: '' } : null;
    }
  }

  async _evaluateNow(st, knownReady) {
    if (this._paths.get(st.pathName) !== st) return;
    const r = await this._readiness(st, knownReady);
    if (!r) return;
    if (!r.ready) {
      clearTimeout(st.timer);
      st.timer = null;
      st.backoff = BACKOFF_START_MS;
      if (st.runner) await this._stopRunner(st);
      return;
    }
    if (st.runner || st.timer) return;
    await this._start(st, r.readyTime);
  }

  async _start(st, readyTime) {
    const spec = st.spec;
    const tag = `[fanout:${(spec.label || st.pathName).slice(0, 24)}]`;
    // Same path, targets and publish episode give the same id, so a second instance taking over
    // adopts the running fleet job instead of starting a duplicate push.
    const jobId = `fanout-${sha(`${st.pathName}|${st.specHash}|${readyTime}`, 16)}-${st.restarts}`;
    let runner;
    try {
      runner = this._runnerFactory({
        runner: this._runnerName(),
        cmd: 'ffmpeg',
        args: this._runnerArgs(spec),
        name: tag,
        stdin: 'ignore',
        purpose: 'relay',
        apiKey: spec.apiKey || '',
        jobId,
        class: 'stream',
        priority: 500,
        requires: this._requires(),
        redact: spec.redact ?? [],
      });
      st.runner = runner;
      st.startedAt = Date.now();
      runner.on('error', (err) => logger.error(`${tag} ffmpeg error: ${err.message}`));
      runner.on('close', (info) => this._onClose(st, runner, info));
      await runner.start();
      logger.info(`${tag} fan-out started for '${st.pathName}'${runner.where ? ` on ${runner.where}` : ''}`);
    } catch (err) {
      logger.warn(`${tag} could not start fan-out for '${st.pathName}': ${err.message}`);
      if (st.runner === runner) st.runner = null;
      this._scheduleRestart(st);
    }
  }

  _onClose(st, runner, info) {
    if (st.runner !== runner) return; // replaced or stopped on purpose
    st.runner = null;
    if (Date.now() - st.startedAt > HEALTHY_AFTER_MS) st.backoff = BACKOFF_START_MS;
    if (this._paths.get(st.pathName) !== st) return;
    logger.warn(`[fanout] '${st.pathName}' ffmpeg ended (code ${info?.code ?? '?'}); checking whether to restart`);
    this._scheduleRestart(st);
  }

  /** Restart only if the path is still ready when the backoff is over (the evaluation checks that). */
  _scheduleRestart(st) {
    if (st.timer || this._paths.get(st.pathName) !== st) return;
    const delay = st.backoff;
    st.backoff = Math.min(st.backoff * 2, BACKOFF_MAX_MS);
    st.restarts += 1;
    st.timer = setTimeout(() => {
      st.timer = null;
      this._evaluate(st);
    }, delay);
    st.timer.unref?.();
  }

  async _stopRunner(st) {
    const runner = st.runner;
    st.runner = null;
    if (!runner) return;
    try { await runner.stop?.(); } catch { /* already gone */ }
  }
}
