import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createFfmpegRunner } from '../../../lcyt-backend/src/ffmpeg/index.js';
import { NginxManager } from './nginx-manager.js';

const DEFAULT_HLS_ROOT   = process.env.RADIO_HLS_ROOT   || '/tmp/hls';
const DEFAULT_LOCAL_RTMP = process.env.RADIO_LOCAL_RTMP  || 'rtmp://127.0.0.1:1935';
const DEFAULT_RTMP_APP   = process.env.RADIO_RTMP_APP    || process.env.RTMP_APPLICATION || 'live';

/**
 * HLS source backend for the radio pipeline.
 *
 *   'ffmpeg'   (default) — spawn ffmpeg to transcode RTMP → AAC HLS segments locally.
 *                          Requires ffmpeg in PATH (or FFMPEG_RUNNER env).
 *                          Segments are served from the filesystem by the backend.
 *
 *   'mediamtx' — MediaMTX receives RTMP and serves HLS natively.
 *                No ffmpeg process is spawned for radio.
 *                When NGINX_RADIO_CONFIG_PATH is set, NginxManager writes a nginx
 *                location block that proxies the public slug URL to the MediaMTX
 *                HLS endpoint, keeping the API key out of public URLs.
 *                When nginx integration is disabled, the radio route still proxies
 *                to MediaMTX via the Node.js backend.
 *
 * Controlled by: RADIO_HLS_SOURCE=ffmpeg|mediamtx  (default: ffmpeg)
 * MediaMTX HLS: MEDIAMTX_HLS_BASE_URL (default: http://127.0.0.1:8080)
 */
const RADIO_HLS_SOURCE = process.env.RADIO_HLS_SOURCE || 'ffmpeg';

export class RadioManager {
  /**
   * @param {{
   *   hlsRoot?:       string,
   *   localRtmp?:     string,
   *   rtmpApp?:       string,
   *   runner?:        string,
   *   hlsSource?:     'ffmpeg' | 'mediamtx',
   *   mediamtxClient?: import('./mediamtx-client.js').MediaMtxClient,
   *   nginxManager?:  NginxManager,
   * }} [opts]
   */
  constructor({ hlsRoot, localRtmp, rtmpApp, runner, hlsSource, mediamtxClient, nginxManager } = {}) {
    this._procs   = new Map();
    this._hlsRoot = hlsRoot   ?? DEFAULT_HLS_ROOT;
    this._local   = localRtmp ?? DEFAULT_LOCAL_RTMP;
    this._app     = rtmpApp   ?? DEFAULT_RTMP_APP;
    this._runner  = runner    ?? process.env.FFMPEG_RUNNER ?? 'spawn';

    /** @type {'ffmpeg' | 'mediamtx'} */
    this._hlsSource = hlsSource ?? RADIO_HLS_SOURCE;

    /** @type {import('./mediamtx-client.js').MediaMtxClient | null} */
    this._mediamtx = mediamtxClient ?? null;

    /**
     * NginxManager handles writing nginx proxy locations for slug → MediaMTX.
     * When null / no-op, MediaMTX HLS is still accessible via the backend
     * proxy route (/radio/:key/…) at the cost of exposing the API key in the URL.
     *
     * @type {NginxManager}
     */
    this._nginxManager = nginxManager ?? new NginxManager();

    /**
     * Track active MediaMTX streams: radioKey → { slug }
     * (ffmpeg mode tracks processes in _procs instead)
     *
     * @type {Map<string, { slug: string }>}
     */
    this._mediamtxStreams = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  hlsDir(radioKey) { return join(this._hlsRoot, radioKey); }

  /**
   * Start HLS for a radio key.
   * In ffmpeg mode: spawn ffmpeg to transcode RTMP → AAC HLS.
   * In mediamtx mode: register with NginxManager (no ffmpeg process spawned).
   *
   * @param {string} radioKey
   * @returns {Promise<void>}
   */
  async start(radioKey) {
    if (this._hlsSource === 'mediamtx') {
      return this._startMediaMtx(radioKey);
    }
    return this._startFfmpeg(radioKey);
  }

  /**
   * Stop HLS for a radio key.
   * In ffmpeg mode: kill the ffmpeg process.
   * In mediamtx mode: deregister from NginxManager.
   *
   * @param {string} radioKey
   * @returns {Promise<void>}
   */
  async stop(radioKey) {
    if (this._hlsSource === 'mediamtx') {
      return this._stopMediaMtx(radioKey);
    }
    return this._stopFfmpeg(radioKey);
  }

  async stopAll() {
    await Promise.all([...this._activeKeys()].map(k => this.stop(k)));
  }

  /**
   * Check whether a radio key is currently live.
   * In mediamtx mode, returns true if we registered the stream with nginx.
   */
  isRunning(radioKey) {
    if (this._hlsSource === 'mediamtx') {
      return this._mediamtxStreams.has(radioKey);
    }
    return this._procs.has(radioKey);
  }

  /**
   * Get the public HLS URL for a radio key.
   *
   * In ffmpeg mode: returns the backend-served URL (/radio/:key/index.m3u8).
   * In mediamtx + nginx mode: returns the slug-based nginx URL (/r/:slug/index.m3u8).
   * In mediamtx without nginx: returns the backend proxy URL (/radio/:key/index.m3u8).
   *
   * @param {string} radioKey
   * @param {string} origin    e.g. "https://api.example.com"
   * @returns {string}
   */
  getPublicHlsUrl(radioKey, origin) {
    if (this._hlsSource === 'mediamtx' && this._nginxManager.isEnabled) {
      return this._nginxManager.getPublicUrl(radioKey, origin);
    }
    return `${origin}/radio/${radioKey}/index.m3u8`;
  }

  /**
   * Returns the nginx-proxy slug for a radio key (MediaMTX mode only).
   * Returns null in ffmpeg mode.
   *
   * @param {string} radioKey
   * @returns {string | null}
   */
  getSlug(radioKey) {
    if (this._hlsSource !== 'mediamtx') return null;
    return NginxManager.keyToSlug(radioKey);
  }

  // ---------------------------------------------------------------------------
  // MediaMTX mode implementation
  // ---------------------------------------------------------------------------

  /**
   * MediaMTX mode: register nginx proxy location.
   * MediaMTX is assumed to already receive the RTMP stream (no ffmpeg needed).
   *
   * If a MediaMtxClient is available, we also dynamically add the path so
   * MediaMTX can start accepting the stream before the publisher arrives.
   *
   * @param {string} radioKey
   */
  async _startMediaMtx(radioKey) {
    const tag = `[radio:${radioKey.slice(0, 8)}]`;

    // Optionally pre-register path with MediaMTX API
    if (this._mediamtx) {
      try {
        await this._mediamtx.addPath(radioKey, { source: 'publisher' });
        console.log(`${tag} MediaMTX path registered`);
      } catch (err) {
        // Path may already exist; non-fatal
        console.warn(`${tag} MediaMTX addPath warning: ${err.message}`);
      }
    }

    // Register nginx proxy location (api key hidden behind slug)
    let slug;
    try {
      slug = await this._nginxManager.addStream(radioKey);
      console.log(`${tag} nginx proxy: ${this._nginxManager._prefix}/${slug}/ → mediamtx/${radioKey}/`);
    } catch (err) {
      console.warn(`${tag} nginx update warning: ${err.message}`);
      slug = NginxManager.keyToSlug(radioKey);
    }

    this._mediamtxStreams.set(radioKey, { slug });
  }

  /**
   * MediaMTX mode: deregister nginx proxy location.
   *
   * @param {string} radioKey
   */
  async _stopMediaMtx(radioKey) {
    if (!this._mediamtxStreams.has(radioKey)) return;
    this._mediamtxStreams.delete(radioKey);

    const tag = `[radio:${radioKey.slice(0, 8)}]`;

    // Remove nginx proxy location
    try {
      await this._nginxManager.removeStream(radioKey);
      console.log(`${tag} nginx proxy removed`);
    } catch (err) {
      console.warn(`${tag} nginx remove warning: ${err.message}`);
    }

    // Optionally clean up MediaMTX path
    if (this._mediamtx) {
      try {
        await this._mediamtx.deletePath(radioKey);
        console.log(`${tag} MediaMTX path removed`);
      } catch (err) {
        console.warn(`${tag} MediaMTX deletePath warning: ${err.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ffmpeg mode implementation (original behaviour, unchanged)
  // ---------------------------------------------------------------------------

  async _startFfmpeg(radioKey) {
    return new Promise(async (resolve, reject) => {
      this._stopProc(radioKey);

      const dir    = this.hlsDir(radioKey);
      mkdirSync(dir, { recursive: true });

      const src      = `${this._local.replace(/\/$/, '')}/${this._app}/${radioKey}`;
      const playlist = join(dir, 'index.m3u8');
      const segPat   = join(dir, 'seg%05d.ts');

      const args = [
        '-re', '-i', src,
        '-vn',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segPat,
        playlist,
      ];

      const tag = `[radio:${radioKey.slice(0, 8)}]`;
      console.log(`${tag} Starting HLS: ${src} → ${playlist}`);

      const runner = createFfmpegRunner({ runner: this._runner, cmd: 'ffmpeg', args, name: tag, stdin: 'ignore' });
      try {
        const handle = await runner.start();
        this._procs.set(radioKey, handle);

        if (handle.stdout) handle.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
        if (handle.stderr) handle.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

        runner.on('error', err => {
          this._procs.delete(radioKey);
          console.error(`${tag} ffmpeg error: ${err.message}`);
          reject(err);
        });

        runner.on('close', info => {
          this._procs.delete(radioKey);
          if (info && info.code !== undefined && info.code !== null) console.warn(`${tag} ffmpeg exited with code ${info.code}`);
          else console.log(`${tag} HLS stream ended`);
          this._cleanup(radioKey);
        });

        setImmediate(resolve);
      } catch (err) {
        reject(err);
      }
    });
  }

  async _stopFfmpeg(radioKey) {
    const runner = this._procs.get(radioKey);
    if (!runner) return;
    try {
      return await (typeof runner.stop === 'function' ? runner.stop(3000) : Promise.resolve({ timedOut: false }));
    } finally {
      this._stopProc(radioKey);
    }
  }

  _cleanup(radioKey) {
    try {
      rmSync(this.hlsDir(radioKey), { recursive: true, force: true });
    } catch (err) {
      console.warn(`[radio] cleanup failed for ${radioKey.slice(0, 8)}: ${err.message}`);
    }
  }

  _stopProc(radioKey) {
    const runner = this._procs.get(radioKey);
    if (!runner) return;
    this._procs.delete(radioKey);
    try {
      if (typeof runner.stop === 'function') {
        try { runner.stop(3000); } catch (e) {}
      } else if (runner.proc && typeof runner.proc.kill === 'function') {
        runner.proc.kill('SIGTERM');
        const t = setTimeout(() => {
          try { if (runner.proc && typeof runner.proc.kill === 'function') runner.proc.kill('SIGKILL'); } catch {}
        }, 3000);
        if (t.unref) t.unref();
      }
    } catch {}
  }

  /** Returns all active keys regardless of mode. */
  _activeKeys() {
    return new Set([...this._procs.keys(), ...this._mediamtxStreams.keys()]);
  }
}
