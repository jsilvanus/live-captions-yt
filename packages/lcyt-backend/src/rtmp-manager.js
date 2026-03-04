import { spawn } from 'node:child_process';

const DEFAULT_RTMP_HOST = process.env.RTMP_HOST || 'rtmp.lcyt.fi';
const DEFAULT_RTMP_APP  = process.env.RTMP_APP  || 'stream';

/**
 * Build the source RTMP URL from which nginx-rtmp is publishing.
 * The stream name matches the API key (as configured by nginxbot.sh).
 *
 * @param {string} apiKey
 * @returns {string}
 */
function sourceUrl(apiKey) {
  return `rtmp://${DEFAULT_RTMP_HOST}/${DEFAULT_RTMP_APP}/${apiKey}`;
}

/**
 * Manages one ffmpeg subprocess per API key that relays an incoming RTMP stream
 * to a configured target URL.
 *
 * ffmpeg is spawned with:
 *   ffmpeg -re -i <sourceUrl> -c copy -f flv <targetFfmpegUrl>
 *
 * Stat callbacks:
 *   onStreamStarted(apiKey, { targetUrl, targetName, captionMode, startedAt }) — called when relay begins
 *   onStreamEnded(apiKey, { targetUrl, targetName, captionMode, startedAt, endedAt, durationMs }) — called when relay ends
 */
export class RtmpRelayManager {
  /**
   * @param {{ onStreamStarted?: Function, onStreamEnded?: Function }} [opts]
   */
  constructor({ onStreamStarted, onStreamEnded } = {}) {
    /** @type {Map<string, import('node:child_process').ChildProcess>} */
    this._procs = new Map();
    /** @type {Map<string, { targetUrl: string, targetName: string|null, captionMode: string, startedAt: Date }>} */
    this._meta = new Map();
    this._onStreamStarted = onStreamStarted ?? null;
    this._onStreamEnded   = onStreamEnded   ?? null;
  }

  /**
   * Start (or restart) an ffmpeg relay for an API key.
   * @param {string} apiKey
   * @param {string} targetUrl         Base RTMP URL (application URL)
   * @param {{ targetName?: string|null, captionMode?: string }} [opts]
   * @returns {Promise<void>}
   */
  start(apiKey, targetUrl, { targetName = null, captionMode = 'http' } = {}) {
    return new Promise((resolve, reject) => {
      // Kill any existing process for this key first
      this._kill(apiKey);

      // Build the full ffmpeg target: append targetName as the RTMP stream name
      const ffmpegTarget = targetName
        ? `${targetUrl.replace(/\/$/, '')}/${targetName}`
        : targetUrl;

      const src = sourceUrl(apiKey);
      console.log(`[rtmp] Starting relay: ${src} → ${ffmpegTarget}`);

      const proc = spawn('ffmpeg', [
        '-re',
        '-i', src,
        '-c', 'copy',
        '-f', 'flv',
        ffmpegTarget,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const startedAt = new Date();
      this._procs.set(apiKey, proc);
      this._meta.set(apiKey, { targetUrl, targetName, captionMode, startedAt });

      this._onStreamStarted?.(apiKey, { targetUrl, targetName, captionMode, startedAt });

      proc.stdout.on('data', (d) => process.stdout.write(`[ffmpeg:${apiKey.slice(0, 8)}] ${d}`));
      proc.stderr.on('data', (d) => process.stderr.write(`[ffmpeg:${apiKey.slice(0, 8)}] ${d}`));

      proc.on('error', (err) => {
        this._procs.delete(apiKey);
        this._meta.delete(apiKey);
        console.error(`[rtmp] ffmpeg error for ${apiKey}: ${err.message}`);
        reject(err);
      });

      proc.on('close', (code) => {
        this._procs.delete(apiKey);
        const meta = this._meta.get(apiKey);
        this._meta.delete(apiKey);

        if (meta) {
          const endedAt  = new Date();
          const durationMs = endedAt.getTime() - meta.startedAt.getTime();
          this._onStreamEnded?.(apiKey, {
            targetUrl:   meta.targetUrl,
            targetName:  meta.targetName,
            captionMode: meta.captionMode,
            startedAt:   meta.startedAt,
            endedAt,
            durationMs,
          });
        } else {
          console.warn(`[rtmp] Stream metadata missing on close for key ${apiKey.slice(0, 8)}…`);
        }

        if (code !== 0 && code !== null) {
          console.warn(`[rtmp] ffmpeg exited with code ${code} for key ${apiKey.slice(0, 8)}…`);
        } else {
          console.log(`[rtmp] Relay ended for key ${apiKey.slice(0, 8)}…`);
        }
      });

      // Resolve once the process has started (i.e. no immediate spawn error)
      setImmediate(resolve);
    });
  }

  /**
   * Stop the ffmpeg relay for an API key.
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  stop(apiKey) {
    return new Promise((resolve) => {
      const proc = this._procs.get(apiKey);
      if (!proc) return resolve();

      proc.once('close', () => resolve());
      this._kill(apiKey);
    });
  }

  /**
   * Check whether a relay is currently running for an API key.
   * @param {string} apiKey
   * @returns {boolean}
   */
  isRunning(apiKey) {
    return this._procs.has(apiKey);
  }

  /**
   * Kill the ffmpeg process for an API key (SIGTERM → SIGKILL after 3s).
   * @param {string} apiKey
   */
  _kill(apiKey) {
    const proc = this._procs.get(apiKey);
    if (!proc) return;
    this._procs.delete(apiKey);
    try {
      proc.kill('SIGTERM');
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (err) {
          // ESRCH means the process already exited between SIGTERM and SIGKILL — ignore
          if (err.code !== 'ESRCH') console.warn(`[rtmp] SIGKILL failed for key ${apiKey.slice(0, 8)}…: ${err.message}`);
        }
      }, 3000);
      if (timer.unref) timer.unref();
    } catch {}
  }

  /**
   * Stop all running relays. Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    const keys = [...this._procs.keys()];
    await Promise.all(keys.map(k => this.stop(k)));
  }
}
