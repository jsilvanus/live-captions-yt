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
 * Manages ffmpeg subprocesses for RTMP relay fan-out.
 *
 * One incoming RTMP stream (identified by apiKey) fans out to up to 4 targets.
 * Each target is a (apiKey, slot) pair. Internal process key: `${apiKey}:${slot}`.
 *
 * Stat callbacks:
 *   onStreamStarted(apiKey, slot, { targetUrl, targetName, captionMode, startedAt })
 *   onStreamEnded(apiKey, slot, { targetUrl, targetName, captionMode, startedAt, endedAt, durationMs })
 *
 * Environment variables read at construction (can be overridden via opts):
 *   RTMP_CONTROL_URL   — nginx-rtmp control base URL (e.g. http://127.0.0.1:8888/control)
 *   RTMP_APPLICATION   — application name used when dropping publishers
 */
export class RtmpRelayManager {
  /**
   * @param {{
   *   onStreamStarted?: Function,
   *   onStreamEnded?: Function,
   *   rtmpControlUrl?: string|null,
   *   rtmpApplication?: string,
   * }} [opts]
   */
  constructor({ onStreamStarted, onStreamEnded, rtmpControlUrl, rtmpApplication } = {}) {
    /** @type {Map<string, import('node:child_process').ChildProcess>} key = `${apiKey}:${slot}` */
    this._procs = new Map();
    /** @type {Map<string, { targetUrl: string, targetName: string|null, captionMode: string, startedAt: Date }>} */
    this._meta  = new Map();
    /** @type {Set<string>} API keys that nginx-rtmp is currently publishing (on_publish received, on_publish_done not yet) */
    this._publishing = new Set();
    this._onStreamStarted = onStreamStarted ?? null;
    this._onStreamEnded   = onStreamEnded   ?? null;
    // nginx-rtmp control API (e.g. http://127.0.0.1:8888/control)
    this._controlUrl = rtmpControlUrl ?? process.env.RTMP_CONTROL_URL ?? null;
    this._rtmpApp    = rtmpApplication ?? process.env.RTMP_APPLICATION ?? DEFAULT_RTMP_APP;
  }

  /** Internal composite key for (apiKey, slot). */
  _key(apiKey, slot) { return `${apiKey}:${slot}`; }

  /**
   * Start (or restart) an ffmpeg relay for a specific slot.
   * @param {string} apiKey
   * @param {number} slot   1-4
   * @param {string} targetUrl         Base RTMP URL (application URL)
   * @param {{ targetName?: string|null, captionMode?: string }} [opts]
   * @returns {Promise<void>}
   */
  start(apiKey, slot, targetUrl, { targetName = null, captionMode = 'http' } = {}) {
    return new Promise((resolve, reject) => {
      const k = this._key(apiKey, slot);
      // Kill any existing process for this key+slot first
      this._kill(k);

      // Build the full ffmpeg target: append targetName as the RTMP stream name
      const ffmpegTarget = targetName
        ? `${targetUrl.replace(/\/$/, '')}/${targetName}`
        : targetUrl;

      const src = sourceUrl(apiKey);
      console.log(`[rtmp] Starting relay slot ${slot}: ${src} → ${ffmpegTarget}`);

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
      this._procs.set(k, proc);
      this._meta.set(k, { targetUrl, targetName, captionMode, startedAt });

      this._onStreamStarted?.(apiKey, slot, { targetUrl, targetName, captionMode, startedAt });

      const tag = `[ffmpeg:${apiKey.slice(0, 8)}#${slot}]`;
      proc.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
      proc.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));

      proc.on('error', (err) => {
        this._procs.delete(k);
        this._meta.delete(k);
        console.error(`[rtmp] ffmpeg error slot ${slot} for ${apiKey}: ${err.message}`);
        reject(err);
      });

      proc.on('close', (code) => {
        this._procs.delete(k);
        const meta = this._meta.get(k);
        this._meta.delete(k);

        if (meta) {
          const endedAt    = new Date();
          const durationMs = endedAt.getTime() - meta.startedAt.getTime();
          this._onStreamEnded?.(apiKey, slot, {
            targetUrl:   meta.targetUrl,
            targetName:  meta.targetName,
            captionMode: meta.captionMode,
            startedAt:   meta.startedAt,
            endedAt,
            durationMs,
          });
        } else {
          console.warn(`[rtmp] Stream metadata missing on close for key ${apiKey.slice(0, 8)}… slot ${slot}`);
        }

        if (code !== 0 && code !== null) {
          console.warn(`[rtmp] ffmpeg exited with code ${code} (slot ${slot}) for key ${apiKey.slice(0, 8)}…`);
        } else {
          console.log(`[rtmp] Relay ended (slot ${slot}) for key ${apiKey.slice(0, 8)}…`);
        }
      });

      // Resolve once the process has started (i.e. no immediate spawn error)
      setImmediate(resolve);
    });
  }

  /**
   * Start ffmpeg for all provided relay slots simultaneously.
   * Individual slot failures are logged but do not reject the returned promise.
   * @param {string} apiKey
   * @param {Array<{ slot: number, targetUrl: string, targetName?: string|null, captionMode?: string }>} relays
   * @returns {Promise<void>}
   */
  async startAll(apiKey, relays) {
    await Promise.all(
      relays.map(r =>
        this.start(apiKey, r.slot, r.targetUrl, {
          targetName:  r.targetName,
          captionMode: r.captionMode,
        }).catch(err =>
          console.error(`[rtmp] Failed to start slot ${r.slot} for ${apiKey.slice(0, 8)}…: ${err.message}`)
        )
      )
    );
  }

  /**
   * Stop the ffmpeg relay for a specific slot.
   * @param {string} apiKey
   * @param {number} slot
   * @returns {Promise<void>}
   */
  stop(apiKey, slot) {
    return new Promise((resolve) => {
      const k    = this._key(apiKey, slot);
      const proc = this._procs.get(k);
      if (!proc) return resolve();
      proc.once('close', () => resolve());
      this._kill(k);
    });
  }

  /**
   * Stop all ffmpeg relay slots for an API key.
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async stopKey(apiKey) {
    const slots = this.runningSlots(apiKey);
    await Promise.all(slots.map(s => this.stop(apiKey, s)));
  }

  /**
   * Drop the publisher from nginx using the RTMP control API.
   * This terminates the incoming RTMP stream, which causes all ffmpeg
   * processes reading from nginx to receive EOF and exit naturally.
   *
   * Requires RTMP_CONTROL_URL to be configured (via env or constructor opts).
   *
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async dropPublisher(apiKey) {
    if (!this._controlUrl) {
      console.debug('[rtmp] RTMP_CONTROL_URL not set — skipping drop/publisher');
      return;
    }
    const url = `${this._controlUrl}/drop/publisher?app=${encodeURIComponent(this._rtmpApp)}&name=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        console.warn(`[rtmp] drop/publisher returned ${res.status} for key ${apiKey.slice(0, 8)}…`);
      } else {
        console.log(`[rtmp] drop/publisher successful for key ${apiKey.slice(0, 8)}…`);
      }
    } catch (err) {
      console.error(`[rtmp] drop/publisher request failed: ${err.message}`);
    }
  }

  /**
   * Check whether any relay slot is currently running for an API key.
   * @param {string} apiKey
   * @returns {boolean}
   */
  isRunning(apiKey) {
    return this.runningSlots(apiKey).length > 0;
  }

  /**
   * Check whether a specific slot is currently running.
   * @param {string} apiKey
   * @param {number} slot
   * @returns {boolean}
   */
  isSlotRunning(apiKey, slot) {
    return this._procs.has(this._key(apiKey, slot));
  }

  /**
   * Mark that nginx-rtmp has started publishing for an API key (on_publish received).
   * @param {string} apiKey
   */
  markPublishing(apiKey) { this._publishing.add(apiKey); }

  /**
   * Mark that nginx-rtmp has stopped publishing for an API key (on_publish_done received).
   * @param {string} apiKey
   */
  markNotPublishing(apiKey) { this._publishing.delete(apiKey); }

  /**
   * Check whether nginx-rtmp is currently publishing for an API key.
   * Used to decide whether to start fan-out immediately when the user activates the relay.
   * @param {string} apiKey
   * @returns {boolean}
   */
  isPublishing(apiKey) { return this._publishing.has(apiKey); }

  /**
   * Return the list of slot numbers currently running for an API key.
   * @param {string} apiKey
   * @returns {number[]}
   */
  runningSlots(apiKey) {
    const prefix = `${apiKey}:`;
    const slots = [];
    for (const k of this._procs.keys()) {
      if (k.startsWith(prefix)) {
        slots.push(parseInt(k.slice(prefix.length), 10));
      }
    }
    return slots.sort((a, b) => a - b);
  }

  /**
   * Kill the ffmpeg process for a composite key (SIGTERM → SIGKILL after 3s).
   * @param {string} compositeKey  `${apiKey}:${slot}`
   */
  _kill(compositeKey) {
    const proc = this._procs.get(compositeKey);
    if (!proc) return;
    this._procs.delete(compositeKey);
    try {
      proc.kill('SIGTERM');
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (err) {
          if (err.code !== 'ESRCH') console.warn(`[rtmp] SIGKILL failed for ${compositeKey}: ${err.message}`);
        }
      }, 3000);
      if (timer.unref) timer.unref();
    } catch {}
  }

  /**
   * Stop all running relay slots across all API keys. Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    const keys = [...this._procs.keys()];
    await Promise.all(keys.map(k => {
      const colonIdx = k.indexOf(':');
      const apiKey   = k.slice(0, colonIdx);
      const slot     = parseInt(k.slice(colonIdx + 1), 10);
      return this.stop(apiKey, slot);
    }));
  }
}
