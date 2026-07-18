/**
 * CropManager — vertical crop rendition of the landscape ingest
 * (plan_vertical_crop.md §2).
 *
 * One long-running ffmpeg per api_key reads the raw ingest back from MediaMTX
 * over RTSP, cuts a fixed-size crop window (default 9:16) from the
 * full-resolution frames with a named `crop@vcrop` filter, optionally scales
 * to the delivery size, and publishes H.264/AAC back into MediaMTX on the
 * `{key}-crop` path. Downstream consumption (relay slots with
 * sourceView:'crop', the /stream-hls proxy, thumbnails) reads that path.
 *
 * Crop POSITION changes are applied without restarting the process when the
 * ffmpeg build has the `zmq` filter (ffmpegCaps.hasZmq) and the optional
 * `zeromq` npm package is importable: runtime filter commands
 * (`crop@vcrop x <px>`) land on the next frame — no black gap. Otherwise the
 * manager falls back to a restart per position change (`repositionMode:
 * 'restart'`), relying on MediaMTX to keep serving the path across the swap.
 *
 * Environment variables:
 *   MEDIAMTX_RTSP_BASE_URL — RTSP base for reading the raw ingest (default rtsp://127.0.0.1:8554)
 *   MEDIAMTX_RTMP_BASE_URL — RTMP base for publishing {key}-crop (default rtmp://127.0.0.1:1935)
 *   CROP_ZMQ_PORT_BASE     — first 127.0.0.1 port for per-process zmq binds (default 5560)
 *   CROP_OUTPUT_DEFAULT    — delivery size when config out_w/out_h are NULL (default 1080x1920)
 */
import { spawn } from 'node:child_process';
import { createFfmpegRunner } from 'lcyt-backend/ffmpeg';
import logger from 'lcyt/logger';

const DEFAULT_MEDIAMTX_RTSP = (process.env.MEDIAMTX_RTSP_BASE_URL || 'rtsp://127.0.0.1:8554').replace(/\/$/, '');
const DEFAULT_MEDIAMTX_RTMP = (process.env.MEDIAMTX_RTMP_BASE_URL || 'rtmp://127.0.0.1:1935').replace(/\/$/, '');
const ZMQ_PORT_BASE = Number(process.env.CROP_ZMQ_PORT_BASE ?? 5560);
const TRANSITION_TICK_MS = 33;

// ── pure geometry helpers (unit-tested) ─────────────────────────────────────

const roundEven = v => 2 * Math.round(v / 2);
export const clampNorm = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : 0);

/**
 * Derive the crop window and travel range from the input resolution and the
 * configured aspect. The window always uses the full available height (or
 * width, when the source is taller than the target aspect) so the crop is cut
 * at incoming quality.
 *
 * @returns {{ cropW: number, cropH: number, maxX: number, maxY: number }}
 */
export function computeCropGeometry({ inW, inH, aspectW = 9, aspectH = 16 }) {
  let cropH = inH;
  let cropW = roundEven(inH * aspectW / aspectH);
  if (cropW > inW) {
    // Source narrower than the target aspect — pin width, shrink height.
    cropW = roundEven(inW);
    cropH = roundEven(inW * aspectH / aspectW);
    if (cropH > inH) cropH = roundEven(inH);
  }
  return { cropW, cropH, maxX: Math.max(0, inW - cropW), maxY: Math.max(0, inH - cropH) };
}

/**
 * Convert a normalised position (0..1 of the travel range) to even pixel
 * offsets for the crop filter.
 */
export function normToPixels({ xNorm, yNorm }, { maxX, maxY }) {
  return {
    x: Math.min(maxX, Math.max(0, roundEven(clampNorm(xNorm) * maxX))),
    y: Math.min(maxY, Math.max(0, roundEven(clampNorm(yNorm) * maxY))),
  };
}

/**
 * Cubic ease-in-out interpolation steps between two normalised positions.
 * Returns the intermediate + final positions (never the starting point).
 * @returns {Array<{ xNorm: number, yNorm: number }>}
 */
export function buildEaseSteps(from, to, transitionMs, tickMs = TRANSITION_TICK_MS) {
  const n = Math.max(1, Math.round(transitionMs / tickMs));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const steps = [];
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    steps.push({
      xNorm: from.xNorm + (to.xNorm - from.xNorm) * t,
      yNorm: from.yNorm + (to.yNorm - from.yNorm) * t,
    });
  }
  return steps;
}

// ── ffprobe input-resolution probe ──────────────────────────────────────────

/**
 * Probe the input resolution of the raw ingest via ffprobe.
 * Resolves { inW, inH } or null when ffprobe is unavailable / fails.
 */
export function probeInputResolution(url, { timeoutMs = 8000 } = {}) {
  return new Promise(resolve => {
    let out = '';
    let proc;
    try {
      proc = spawn('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'json',
        '-rtsp_transport', 'tcp', url,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, timeoutMs);
    if (timer.unref) timer.unref();
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const s = JSON.parse(out)?.streams?.[0];
        if (s?.width > 0 && s?.height > 0) return resolve({ inW: s.width, inH: s.height });
      } catch {}
      resolve(null);
    });
  });
}

// ── manager ─────────────────────────────────────────────────────────────────

export class CropManager {
  /**
   * @param {{
   *   ffmpegCaps?: { available?: boolean, hasZmq?: boolean }|null,
   *   mediamtxClient?: import('./mediamtx-client.js').MediaMtxClient|null,
   *   probeResolution?: Function,   // test injection; defaults to probeInputResolution
   * }} [opts]
   */
  constructor({ ffmpegCaps = null, mediamtxClient = null, probeResolution } = {}) {
    this._ffmpegCaps = ffmpegCaps;
    this._mediamtx = mediamtxClient;
    this._probeResolution = probeResolution ?? probeInputResolution;

    /**
     * Per-key session state:
     * { handle, geometry: {inW,inH,cropW,cropH,maxX,maxY}, config, position:
     *   {xNorm,yNorm}, activePresetId, zmq: {socket,port}|null, startedAt,
     *   transitionTimer }
     * @type {Map<string, object>}
     */
    this._sessions = new Map();
    this._nextZmqOffset = 0;

    /** null = not checked yet; boolean once the lazy import has settled. */
    this._zmqModuleAvailable = null;
    this._zmqLoad = undefined;
  }

  /**
   * Lazily import the optional `zeromq` package (memoized). Resolves the
   * module or null when it is not installed.
   */
  _loadZmqModule() {
    if (this._zmqLoad === undefined) {
      this._zmqLoad = import('zeromq')
        .then(m => { this._zmqModuleAvailable = true; return m; })
        .catch(() => {
          this._zmqModuleAvailable = false;
          logger.warn('[crop] optional dependency "zeromq" not installed — position changes will restart the renderer');
          return null;
        });
    }
    return this._zmqLoad;
  }

  /** MediaMTX path name of the crop rendition. */
  static cropPathName(apiKey) { return `${apiKey}-crop`; }

  isRunning(apiKey) { return this._sessions.has(apiKey); }

  /**
   * `'live'` when position changes go over runtime filter commands,
   * `'restart'` when they need a process swap. Optimistically 'live' until
   * the lazy `zeromq` import has settled (first start() resolves it).
   */
  repositionMode() {
    return this._ffmpegCaps?.hasZmq && this._zmqModuleAvailable !== false ? 'live' : 'restart';
  }

  getStatus(apiKey) {
    const s = this._sessions.get(apiKey);
    if (!s) return { running: false, repositionMode: this.repositionMode() };
    return {
      running:        true,
      repositionMode: s.zmq ? 'live' : 'restart',
      activePresetId: s.activePresetId ?? null,
      xNorm:          s.position.xNorm,
      yNorm:          s.position.yNorm,
      inW:            s.geometry.inW,
      inH:            s.geometry.inH,
      cropW:          s.geometry.cropW,
      cropH:          s.geometry.cropH,
      startedAt:      s.startedAt,
    };
  }

  /**
   * Start (or restart) the crop renderer for a key.
   *
   * @param {string} apiKey
   * @param {object} config   crop_config shape from db/crop.js (getCropConfig)
   * @param {{ position?: { xNorm: number, yNorm: number }, activePresetId?: string|null }} [opts]
   */
  async start(apiKey, config, { position, activePresetId = null } = {}) {
    if (this._ffmpegCaps?.available === false) {
      throw new Error('ffmpeg is not installed or not available in PATH. Vertical crop requires ffmpeg.');
    }
    // The renderer always re-encodes with libx264 — fail fast with a clear
    // error instead of spawning an ffmpeg that exits immediately.
    if (this._ffmpegCaps?.hasLibx264 === false) {
      throw new Error('ffmpeg lacks the libx264 encoder. Vertical crop requires an ffmpeg build with libx264.');
    }
    const previous = this._sessions.get(apiKey);
    // Carry the last position across restarts unless explicitly overridden.
    const pos = {
      xNorm: clampNorm(position?.xNorm ?? previous?.position.xNorm ?? 0.5),
      yNorm: clampNorm(position?.yNorm ?? previous?.position.yNorm ?? 0),
    };
    await this.stop(apiKey);

    const srcUrl = `${DEFAULT_MEDIAMTX_RTSP}/${encodeURIComponent(apiKey)}`;
    // Reuse the previous session's successfully-probed resolution on restarts
    // (restart-mode repositioning would otherwise pay the probe on every move).
    let inW, inH, probed;
    if (previous?.geometry?.probed) {
      ({ inW, inH } = previous.geometry);
      probed = true;
    } else {
      const res = await this._probeResolution(srcUrl).catch(() => null);
      probed = !!res;
      inW = res?.inW ?? 1920;
      inH = res?.inH ?? 1080;
      if (!res) {
        logger.warn(`[crop:${apiKey.slice(0, 8)}] input resolution probe failed — assuming ${inW}x${inH}`);
      }
    }

    const geometry = { inW, inH, probed, ...computeCropGeometry({ inW, inH, aspectW: config.aspectW, aspectH: config.aspectH }) };
    const { x, y } = normToPixels(pos, geometry);
    const outW = config.outW ?? Number((process.env.CROP_OUTPUT_DEFAULT || '1080x1920').split('x')[0]);
    const outH = config.outH ?? Number((process.env.CROP_OUTPUT_DEFAULT || '1080x1920').split('x')[1]);

    // zmq lands in the graph only when both the ffmpeg build and the node
    // client side are available — a bind without a client would be dead
    // weight (and a pointless port allocation), so resolve the optional
    // `zeromq` import BEFORE deciding whether to insert the filter.
    const zmqMod = this._ffmpegCaps?.hasZmq ? await this._loadZmqModule() : null;
    const zmqPort = zmqMod ? ZMQ_PORT_BASE + (this._nextZmqOffset++ % 1000) : null;
    let filter = `[0:v]crop@vcrop=${geometry.cropW}:${geometry.cropH}:${x}:${y},scale=${outW}:${outH}`;
    // Args go through spawn (no shell); only the filtergraph parser needs the
    // ':' inside the bind address escaped, so a single literal backslash.
    if (zmqPort) filter += `,zmq=bind_address=tcp\\://127.0.0.1\\:${zmqPort}`;
    filter += '[v]';

    const args = [
      '-rtsp_transport', 'tcp', '-i', srcUrl,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    ];
    if (config.videoBitrate) args.push('-b:v', config.videoBitrate);
    args.push('-c:a', 'copy');
    // Bare path — MediaMTX uses the full URL path as the path name.
    args.push('-f', 'flv', `${DEFAULT_MEDIAMTX_RTMP}/${CropManager.cropPathName(apiKey)}`);

    const tag = `[crop:${apiKey.slice(0, 8)}]`;
    const runner = createFfmpegRunner({
      runner: process.env.FFMPEG_RUNNER ?? 'spawn',
      cmd: 'ffmpeg',
      args,
      name: tag,
      stdin: 'ignore',
      purpose: 'crop',
      apiKey,
    });
    const handle = await runner.start();

    const session = {
      handle,
      geometry,
      config,
      position: pos,
      activePresetId,
      zmq: null,
      zmqPort,
      startedAt: new Date(),
      transitionTimer: null,
    };
    this._sessions.set(apiKey, session);

    if (zmqPort) {
      session.zmq = this._openZmq(apiKey, zmqMod, zmqPort);
    }

    if (handle?.stderr) handle.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

    runner.on('error', err => {
      if (this._sessions.get(apiKey) === session) this._cleanupSession(apiKey, session);
      logger.error(`${tag} ffmpeg error: ${err.message}`);
    });
    runner.on('close', info => {
      if (this._sessions.get(apiKey) === session) this._cleanupSession(apiKey, session);
      logger.info(`${tag} crop renderer exited${info?.code != null ? ` (code ${info.code})` : ''}`);
    });

    logger.info(`${tag} crop renderer started ${geometry.cropW}x${geometry.cropH}@${x},${y} → ${outW}x${outH} (${session.zmq ? 'live' : 'restart'} repositioning)`);
  }

  /**
   * Move the crop window. In live mode the change lands on the next frame
   * (optionally eased over transitionMs); in restart mode the renderer is
   * restarted at the new position.
   *
   * @returns {{ ok: boolean, mode: 'live'|'restart', xNorm: number, yNorm: number }}
   */
  async applyPosition(apiKey, { xNorm, yNorm, transitionMs = 0, activePresetId } = {}) {
    const session = this._sessions.get(apiKey);
    if (!session) throw new Error('Crop renderer is not running for this key');

    const target = { xNorm: clampNorm(xNorm), yNorm: clampNorm(yNorm) };
    if (activePresetId !== undefined) session.activePresetId = activePresetId;

    if (session.transitionTimer) {
      clearInterval(session.transitionTimer);
      session.transitionTimer = null;
    }

    if (session.zmq) {
      if (transitionMs > 0) {
        const steps = buildEaseSteps({ ...session.position }, target, transitionMs);
        let i = 0;
        await this._sendZmqPosition(session, steps.length ? steps[0] : target);
        session.position = steps.length ? { ...steps[0] } : target;
        i = 1;
        if (steps.length > 1) {
          session.transitionTimer = setInterval(() => {
            const cur = this._sessions.get(apiKey);
            if (cur !== session || i >= steps.length) {
              clearInterval(session.transitionTimer);
              session.transitionTimer = null;
              return;
            }
            const step = steps[i++];
            session.position = { ...step };
            this._sendZmqPosition(session, step).catch(() => {});
          }, TRANSITION_TICK_MS);
          if (session.transitionTimer.unref) session.transitionTimer.unref();
        }
      } else {
        await this._sendZmqPosition(session, target);
        session.position = target;
      }
      return { ok: true, mode: 'live', xNorm: target.xNorm, yNorm: target.yNorm };
    }

    // Restart fallback — MediaMTX keeps the path alive across the swap.
    await this.start(apiKey, session.config, { position: target, activePresetId: session.activePresetId });
    return { ok: true, mode: 'restart', xNorm: target.xNorm, yNorm: target.yNorm };
  }

  async stop(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) return;
    this._cleanupSession(apiKey, session);
    try {
      if (typeof session.handle?.stop === 'function') await session.handle.stop(3000);
    } catch {}
  }

  async stopAll() {
    await Promise.all([...this._sessions.keys()].map(k => this.stop(k)));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  _cleanupSession(apiKey, session) {
    if (this._sessions.get(apiKey) === session) this._sessions.delete(apiKey);
    if (session.transitionTimer) {
      clearInterval(session.transitionTimer);
      session.transitionTimer = null;
    }
    if (session.zmq) {
      try { session.zmq.close(); } catch {}
      session.zmq = null;
    }
  }

  /**
   * Open a ZeroMQ REQ socket to the process's zmq filter. Returns null (and
   * downgrades the session to restart mode) when socket setup fails.
   * The module itself was already resolved by start() via _loadZmqModule().
   */
  _openZmq(apiKey, zmqMod, port) {
    try {
      const socket = new zmqMod.Request({ sendTimeout: 500, receiveTimeout: 500 });
      socket.connect(`tcp://127.0.0.1:${port}`);
      return {
        async send(cmd) {
          await socket.send(cmd);
          const [reply] = await socket.receive();
          return String(reply);
        },
        close() { try { socket.close(); } catch {} },
      };
    } catch (err) {
      logger.warn(`[crop:${apiKey.slice(0, 8)}] zmq socket setup failed (${err.message}) — falling back to restart-based repositioning`);
      return null;
    }
  }

  async _sendZmqPosition(session, pos) {
    const { x, y } = normToPixels(pos, session.geometry);
    await session.zmq.send(`crop@vcrop x ${x}`);
    await session.zmq.send(`crop@vcrop y ${y}`);
  }
}
