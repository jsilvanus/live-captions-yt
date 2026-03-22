import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createFfmpegRunner } from '../../../lcyt-backend/src/ffmpeg/index.js';

const DEFAULT_PREVIEW_ROOT = process.env.PREVIEW_ROOT    || '/tmp/previews';
const DEFAULT_LOCAL_RTMP   = process.env.HLS_LOCAL_RTMP  || process.env.RADIO_LOCAL_RTMP || 'rtmp://127.0.0.1:1935';
const DEFAULT_RTMP_APP     = process.env.HLS_RTMP_APP    || process.env.RTMP_APPLICATION || 'live';

// Seconds between thumbnail updates (one frame per this interval).
const PREVIEW_INTERVAL_S   = Number(process.env.PREVIEW_INTERVAL_S) || 5;

/**
 * Manages ffmpeg subprocesses for RTMP → JPEG thumbnail generation.
 *
 * One ffmpeg process per key reads the local nginx-rtmp stream and continuously
 * overwrites a single JPEG file with the latest video frame.  The JPEG is served
 * by the /preview/:key/incoming.jpg route.
 *
 * Public API:
 *   start(key)          — spawn ffmpeg; create preview dir
 *   stop(key)           — stop ffmpeg and clean up preview files
 *   stopAll()           — stop all running processes
 *   isRunning(key)      — true if a process is currently running
 *   previewPath(key)    — absolute path to the current JPEG for a key
 *
 * Environment variables:
 *   PREVIEW_ROOT        — preview output root directory (default: /tmp/previews)
 *   HLS_LOCAL_RTMP      — local nginx-rtmp base URL (default: rtmp://127.0.0.1:1935)
 *   HLS_RTMP_APP        — RTMP application name (default: RTMP_APPLICATION or 'live')
 *   PREVIEW_INTERVAL_S  — seconds between thumbnail updates (default: 5)
 */
export class PreviewManager {
  /**
   * @param {{ previewRoot?: string, localRtmp?: string, rtmpApp?: string, intervalS?: number }} [opts]
   */
  constructor({ previewRoot, localRtmp, rtmpApp, intervalS } = {}) {
    /**
     * One process per key.
     * @type {Map<string, import('node:child_process').ChildProcess>}
     */
    this._procs = new Map();

    this._root      = previewRoot ?? DEFAULT_PREVIEW_ROOT;
    this._local     = localRtmp  ?? DEFAULT_LOCAL_RTMP;
    this._app       = rtmpApp    ?? DEFAULT_RTMP_APP;
    this._intervalS = intervalS  ?? PREVIEW_INTERVAL_S;
  }

  /**
   * Return the JPEG path for a given key.
   * @param {string} key
   * @returns {string}
   */
  previewPath(key) {
    return join(this._root, key, 'incoming.jpg');
  }

  /**
   * Start an ffmpeg process that reads from the local RTMP stream and
   * continuously overwrites a single JPEG thumbnail every `intervalS` seconds.
   * If a process is already running for the key it is stopped first.
   *
   * @param {string} key
   * @returns {Promise<void>} Resolves once ffmpeg has been spawned (before it exits).
   */
  async start(key) {
    this._stopProc(key);

      const dir  = join(this._root, key);
      mkdirSync(dir, { recursive: true });

      const src  = `${this._local.replace(/\/$/, '')}/${this._app}/${key}`;
      const out  = this.previewPath(key);

      // Grab one frame every PREVIEW_INTERVAL_S seconds, overwrite the same JPEG.
      // -update 1 (image2 muxer): always overwrite the same output file.
      // -q:v 3: JPEG quality (1=best, 31=worst; 3 gives ~good quality at small size).
      const args = [
        '-re', '-i', src,
        '-vf', `fps=1/${this._intervalS}`,
        '-update', '1',
        '-q:v', '3',
        '-f', 'image2',
        '-y',
        out,
      ];

      const tag = `[preview:${key.slice(0, 8)}]`;
      console.log(`${tag} Starting preview: ${src} → ${out}`);

      const runner = createFfmpegRunner({ runner: 'spawn', cmd: 'ffmpeg', args, name: tag, stdin: 'ignore' });
      try {
        const handle = await runner.start();
        this._procs.set(key, handle);

        if (handle.stdout) handle.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
        if (handle.stderr) handle.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

        runner.on('error', err => {
          this._procs.delete(key);
          console.error(`${tag} ffmpeg error: ${err.message}`);
          throw err;
        });

        runner.on('close', info => {
          this._procs.delete(key);
          if (info && info.code !== undefined && info.code !== null) {
            console.warn(`${tag} ffmpeg exited with code ${info.code}`);
          } else {
            console.log(`${tag} Preview stream ended`);
          }
          this._cleanup(key);
        });

        // resolve immediately after spawn
        return;
      } catch (err) {
        throw err;
      }
  }

  /**
   * Stop the ffmpeg preview process for a key and clean up preview files.
   * @param {string} key
   * @returns {Promise<void>}
   */
  stop(key) {
    return (async () => {
      const handle = this._procs.get(key);
      if (!handle) return;
      try {
        if (typeof handle.stop === 'function') {
          await handle.stop(3000);
        } else {
          await new Promise(resolve => {
            handle.once && handle.once('close', resolve);
            this._stopProc(key);
          });
        }
      } finally {
        this._stopProc(key);
      }
    })();
  }

  /**
   * Stop all running preview processes.  Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    await Promise.all([...this._procs.keys()].map(k => this.stop(k)));
  }

  /**
   * Check whether a preview process is currently running for a key.
   * @param {string} key
   * @returns {boolean}
   */
  isRunning(key) {
    return this._procs.has(key);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove preview files for a key.
   * Called automatically when the ffmpeg process exits.
   * @param {string} key
   */
  _cleanup(key) {
    try {
      rmSync(join(this._root, key), { recursive: true, force: true });
    } catch (err) {
      console.warn(`[preview] cleanup failed for ${key.slice(0, 8)}: ${err.message}`);
    }
  }

  /**
   * Terminate the ffmpeg process for a key (SIGTERM, then SIGKILL after 3 s).
   * @param {string} key
   */
  _stopProc(key) {
    const proc = this._procs.get(key);
    if (!proc) return;
    this._procs.delete(key);
    try {
      // Support both ChildProcess and LocalFfmpegRunner
      if (typeof proc.stop === 'function') {
        proc.stop();
      } else if (typeof proc.kill === 'function') {
        proc.kill('SIGTERM');
        const t = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
        }, 3000);
        if (t.unref) t.unref();
      }
    } catch {}
  }
}
