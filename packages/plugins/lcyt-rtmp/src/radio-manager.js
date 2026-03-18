import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_HLS_ROOT   = process.env.RADIO_HLS_ROOT   || '/tmp/hls';
const DEFAULT_LOCAL_RTMP = process.env.RADIO_LOCAL_RTMP  || 'rtmp://127.0.0.1:1935';
const DEFAULT_RTMP_APP   = process.env.RADIO_RTMP_APP    || process.env.RTMP_APPLICATION || 'live';

/**
 * Manages ffmpeg subprocesses for RTMP → audio-only HLS "radio" streaming.
 *
 * One ffmpeg process per radio key reads from the local nginx-rtmp server and
 * outputs an HLS playlist with audio-only segments to the configured HLS root
 * directory. The segments and playlist are served via the /radio/:key/* routes.
 *
 * Public API:
 *   start(radioKey)    — spawn ffmpeg; create HLS output dir
 *   stop(radioKey)     — stop ffmpeg and clean up HLS files
 *   stopAll()          — stop all running processes
 *   isRunning(radioKey)— true if a process is currently running
 *   hlsDir(radioKey)   — path to the HLS output directory for a key
 *
 * Environment variables:
 *   RADIO_HLS_ROOT     — HLS output root directory (default: /tmp/hls)
 *   RADIO_LOCAL_RTMP   — local nginx-rtmp base URL (default: rtmp://127.0.0.1:1935)
 *   RADIO_RTMP_APP     — RTMP application name (default: RTMP_APPLICATION or 'live')
 */
export class RadioManager {
  /**
   * @param {{ hlsRoot?: string, localRtmp?: string, rtmpApp?: string }} [opts]
   */
  constructor({ hlsRoot, localRtmp, rtmpApp } = {}) {
    /**
     * One process per radio key.
     * @type {Map<string, import('node:child_process').ChildProcess>}
     */
    this._procs = new Map();

    this._hlsRoot = hlsRoot  ?? DEFAULT_HLS_ROOT;
    this._local   = localRtmp ?? DEFAULT_LOCAL_RTMP;
    this._app     = rtmpApp  ?? DEFAULT_RTMP_APP;
  }

  /**
   * Return the HLS output directory path for a given radio key.
   * @param {string} radioKey
   * @returns {string}
   */
  hlsDir(radioKey) {
    return join(this._hlsRoot, radioKey);
  }

  /**
   * Start an ffmpeg process that reads from the local RTMP stream and produces
   * audio-only HLS segments.  If a process is already running for the key it
   * is stopped first.
   *
   * @param {string} radioKey
   * @returns {Promise<void>} Resolves once ffmpeg has been spawned (before it exits).
   */
  start(radioKey) {
    return new Promise((resolve, reject) => {
      this._stopProc(radioKey);

      const dir    = this.hlsDir(radioKey);
      mkdirSync(dir, { recursive: true });

      const src      = `${this._local.replace(/\/$/, '')}/${this._app}/${radioKey}`;
      const playlist = join(dir, 'index.m3u8');
      const segPat   = join(dir, 'seg%05d.ts');

      // Audio-only HLS: strip video, encode audio to AAC, write HLS playlist.
      // -hls_flags delete_segments: remove old segments automatically.
      // -hls_flags append_list: keep appending to the playlist (live mode).
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

      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this._procs.set(radioKey, proc);

      proc.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
      proc.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

      proc.on('error', err => {
        this._procs.delete(radioKey);
        console.error(`${tag} ffmpeg error: ${err.message}`);
        reject(err);
      });

      proc.on('close', code => {
        this._procs.delete(radioKey);
        if (code !== 0 && code !== null) {
          console.warn(`${tag} ffmpeg exited with code ${code}`);
        } else {
          console.log(`${tag} HLS stream ended`);
        }
        this._cleanup(radioKey);
      });

      setImmediate(resolve);
    });
  }

  /**
   * Stop the ffmpeg process for a radio key and clean up HLS files.
   * @param {string} radioKey
   * @returns {Promise<void>}
   */
  stop(radioKey) {
    return new Promise(resolve => {
      const proc = this._procs.get(radioKey);
      if (!proc) return resolve();
      proc.once('close', resolve);
      this._stopProc(radioKey);
    });
  }

  /**
   * Stop all running radio processes.  Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    await Promise.all([...this._procs.keys()].map(k => this.stop(k)));
  }

  /**
   * Check whether a radio stream is currently running for a key.
   * @param {string} radioKey
   * @returns {boolean}
   */
  isRunning(radioKey) {
    return this._procs.has(radioKey);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove HLS segment files and playlist for a key.
   * Called automatically when the ffmpeg process exits.
   * @param {string} radioKey
   */
  _cleanup(radioKey) {
    try {
      rmSync(this.hlsDir(radioKey), { recursive: true, force: true });
    } catch (err) {
      console.warn(`[radio] cleanup failed for ${radioKey.slice(0, 8)}: ${err.message}`);
    }
  }

  /**
   * Terminate the ffmpeg process for a key (SIGTERM, then SIGKILL after 3 s).
   * @param {string} radioKey
   */
  _stopProc(radioKey) {
    const proc = this._procs.get(radioKey);
    if (!proc) return;
    this._procs.delete(radioKey);
    try {
      proc.kill('SIGTERM');
      const t = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 3000);
      if (t.unref) t.unref();
    } catch {}
  }
}
