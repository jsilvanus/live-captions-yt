import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_HLS_ROOT   = process.env.HLS_ROOT      || '/tmp/hls-video';
const DEFAULT_LOCAL_RTMP = process.env.HLS_LOCAL_RTMP || process.env.RADIO_LOCAL_RTMP || 'rtmp://127.0.0.1:1935';
const DEFAULT_RTMP_APP   = process.env.HLS_RTMP_APP   || process.env.RTMP_APPLICATION || 'live';

/**
 * Manages ffmpeg subprocesses for RTMP → video+audio HLS embed streaming.
 *
 * One ffmpeg process per HLS key reads from the local nginx-rtmp server and
 * outputs an HLS playlist with video+audio segments to the configured HLS root
 * directory. The segments and playlist are served via the /stream-hls/:key/* routes.
 *
 * Public API:
 *   start(hlsKey)    — spawn ffmpeg; create HLS output dir
 *   stop(hlsKey)     — stop ffmpeg and clean up HLS files
 *   stopAll()        — stop all running processes
 *   isRunning(hlsKey)— true if a process is currently running
 *   hlsDir(hlsKey)   — path to the HLS output directory for a key
 *
 * Environment variables:
 *   HLS_ROOT         — HLS output root directory (default: /tmp/hls-video)
 *   HLS_LOCAL_RTMP   — local nginx-rtmp base URL (default: RADIO_LOCAL_RTMP or rtmp://127.0.0.1:1935)
 *   HLS_RTMP_APP     — RTMP application name (default: RTMP_APPLICATION or 'live')
 */
export class HlsManager {
  /**
   * @param {{ hlsRoot?: string, localRtmp?: string, rtmpApp?: string }} [opts]
   */
  constructor({ hlsRoot, localRtmp, rtmpApp } = {}) {
    /**
     * One process per HLS key.
     * @type {Map<string, import('node:child_process').ChildProcess>}
     */
    this._procs = new Map();

    this._hlsRoot = hlsRoot   ?? DEFAULT_HLS_ROOT;
    this._local   = localRtmp ?? DEFAULT_LOCAL_RTMP;
    this._app     = rtmpApp   ?? DEFAULT_RTMP_APP;
  }

  /**
   * Return the HLS output directory path for a given key.
   * @param {string} hlsKey
   * @returns {string}
   */
  hlsDir(hlsKey) {
    return join(this._hlsRoot, hlsKey);
  }

  /**
   * Start an ffmpeg process that reads from the local RTMP stream and produces
   * video+audio HLS segments.  If a process is already running for the key it
   * is stopped first.
   *
   * Uses stream copy (-c copy) for lowest CPU usage and latency.  Most RTMP
   * sources (OBS, hardware encoders) output H.264 + AAC which HLS players
   * accept natively, so re-encoding is not needed.
   *
   * @param {string} hlsKey
   * @returns {Promise<void>} Resolves once ffmpeg has been spawned (before it exits).
   */
  start(hlsKey) {
    return new Promise((resolve, reject) => {
      this._stopProc(hlsKey);

      const dir    = this.hlsDir(hlsKey);
      mkdirSync(dir, { recursive: true });

      const src      = `${this._local.replace(/\/$/, '')}/${this._app}/${hlsKey}`;
      const playlist = join(dir, 'index.m3u8');
      const segPat   = join(dir, 'seg%05d.ts');

      // Video+audio HLS: stream copy (no re-encode) for minimum CPU and latency.
      // -hls_flags delete_segments: remove old segments automatically.
      // -hls_flags append_list: keep appending to the playlist (live mode).
      const args = [
        '-re', '-i', src,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segPat,
        playlist,
      ];

      const tag = `[hls:${hlsKey.slice(0, 8)}]`;
      console.log(`${tag} Starting HLS: ${src} → ${playlist}`);

      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this._procs.set(hlsKey, proc);

      proc.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
      proc.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

      proc.on('error', err => {
        this._procs.delete(hlsKey);
        console.error(`${tag} ffmpeg error: ${err.message}`);
        reject(err);
      });

      proc.on('close', code => {
        this._procs.delete(hlsKey);
        if (code !== 0 && code !== null) {
          console.warn(`${tag} ffmpeg exited with code ${code}`);
        } else {
          console.log(`${tag} HLS stream ended`);
        }
        this._cleanup(hlsKey);
      });

      setImmediate(resolve);
    });
  }

  /**
   * Stop the ffmpeg process for an HLS key and clean up HLS files.
   * @param {string} hlsKey
   * @returns {Promise<void>}
   */
  stop(hlsKey) {
    return new Promise(resolve => {
      const proc = this._procs.get(hlsKey);
      if (!proc) return resolve();
      proc.once('close', resolve);
      this._stopProc(hlsKey);
    });
  }

  /**
   * Stop all running HLS processes.  Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    await Promise.all([...this._procs.keys()].map(k => this.stop(k)));
  }

  /**
   * Check whether an HLS stream is currently running for a key.
   * @param {string} hlsKey
   * @returns {boolean}
   */
  isRunning(hlsKey) {
    return this._procs.has(hlsKey);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove HLS segment files and playlist for a key.
   * Called automatically when the ffmpeg process exits.
   * @param {string} hlsKey
   */
  _cleanup(hlsKey) {
    try {
      rmSync(this.hlsDir(hlsKey), { recursive: true, force: true });
    } catch (err) {
      console.warn(`[hls] cleanup failed for ${hlsKey.slice(0, 8)}: ${err.message}`);
    }
  }

  /**
   * Terminate the ffmpeg process for a key (SIGTERM, then SIGKILL after 3 s).
   * @param {string} hlsKey
   */
  _stopProc(hlsKey) {
    const proc = this._procs.get(hlsKey);
    if (!proc) return;
    this._procs.delete(hlsKey);
    try {
      proc.kill('SIGTERM');
      const t = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 3000);
      if (t.unref) t.unref();
    } catch {}
  }
}
