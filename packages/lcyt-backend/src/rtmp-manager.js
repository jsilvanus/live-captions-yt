import { spawn } from 'node:child_process';

const DEFAULT_RTMP_HOST = process.env.RTMP_HOST || 'rtmp.lcyt.fi';
const DEFAULT_RTMP_APP  = process.env.RTMP_APP  || 'stream';

/**
 * Milliseconds to shift a caption earlier when speechStart is not provided.
 * Can be overridden via the CEA708_OFFSET_MS environment variable.
 */
const CEA708_OFFSET_MS          = Number(process.env.CEA708_OFFSET_MS          ?? 2000);

/**
 * Default cue duration in milliseconds (how long each CEA-708 caption is displayed).
 * Can be overridden via the CEA708_DURATION_MS environment variable.
 */
const CEA708_DURATION_MS        = Number(process.env.CEA708_DURATION_MS        ?? 3000);

/**
 * Maximum milliseconds a cue may be shifted backwards from the current stream position.
 * Prevents captions from referencing video frames older than this threshold — decoders
 * typically discard SEI NAL data that is too far behind the current PTS.
 * Can be overridden via the CEA708_MAX_BACKTRACK_MS environment variable.
 */
const CEA708_MAX_BACKTRACK_MS   = Number(process.env.CEA708_MAX_BACKTRACK_MS   ?? 5000);

/**
 * Format a number of milliseconds as an SRT timestamp: HH:MM:SS,mmm
 * @param {number} ms
 * @returns {string}
 */
function srtTime(ms) {
  if (!Number.isFinite(ms)) return '00:00:00,000';
  const clampedMs = Math.max(0, Math.round(ms));
  const hh = String(Math.floor(clampedMs / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((clampedMs % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((clampedMs % 60_000) / 1000)).padStart(2, '0');
  const ms3 = String(clampedMs % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms3}`;
}

/**
 * Build an SRT cue string for ffmpeg stdin injection.
 * @param {number} seq         Monotonically increasing cue number (1-based)
 * @param {number} startMs     Cue start time in ms relative to stream start
 * @param {number} durationMs  Cue display duration in ms
 * @param {string} text        Plain-text caption content
 * @returns {string}
 */
function buildSrtCue(seq, startMs, durationMs, text) {
  const endMs = startMs + durationMs;
  return `${seq}\n${srtTime(startMs)} --> ${srtTime(endMs)}\n${text}\n\n`;
}

/**
 * Build the source RTMP URL from which nginx-rtmp is publishing.
 * @param {string} apiKey
 * @returns {string}
 */
function sourceUrl(apiKey) {
  return `rtmp://${DEFAULT_RTMP_HOST}/${DEFAULT_RTMP_APP}/${apiKey}`;
}

/**
 * Manages ffmpeg subprocesses for RTMP relay fan-out.
 *
 * One ffmpeg **process per API key** forwards the incoming nginx-rtmp stream to all configured
 * relay targets simultaneously using the ffmpeg tee muxer. In CEA-708 mode a single stdin
 * pipe carries SubRip (SRT/subrip) caption cues that ffmpeg embeds as CEA-608 SEI NAL units
 * inside H.264 (cc_data, via the eia608 subtitle encoder + libx264).
 *
 * Public API:
 *   start(apiKey, relays)            — spawn/restart one process for all relays via tee
 *   startAll(apiKey, relays)         — alias for start()
 *   stop(apiKey)                     — stop the process for this API key
 *   stopKey(apiKey)                  — alias for stop()
 *   stopAll()                        — stop all running processes
 *   writeCaption(apiKey, text, opts) — inject SRT cue into ffmpeg stdin (CEA-708 only)
 *   isRunning(apiKey)                — true if the process is running
 *   isSlotRunning(apiKey, slot)      — true if the slot is in the running tee
 *   runningSlots(apiKey)             — sorted slot numbers currently running
 *   startedAt(apiKey)                — Date when the process was spawned (or null)
 *   hasCea708(apiKey)                — true if any running slot uses cea708 mode
 *   isPublishing / markPublishing / markNotPublishing / dropPublisher
 *
 * Stat callbacks (optional):
 *   onStreamStarted(apiKey, slot, { targetUrl, targetName, captionMode, startedAt })
 *   onStreamEnded(apiKey, slot, { targetUrl, targetName, captionMode, startedAt, endedAt, durationMs })
 *
 * Environment variables:
 *   RTMP_CONTROL_URL   — nginx-rtmp control base URL
 *   RTMP_APPLICATION   — application name used when dropping publishers
 *   CEA708_OFFSET_MS   — ms to shift caption earlier when speechStart absent (default: 2000)
 *   CEA708_DURATION_MS — cue display duration in ms (default: 3000)
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
  constructor({ onStreamStarted, onStreamEnded, rtmpControlUrl, rtmpApplication, ffmpegCaps } = {}) {
    /**
     * One process per API key.
     * @type {Map<string, import('node:child_process').ChildProcess>}
     */
    this._procs = new Map();

    /**
     * Per-key metadata: { slots, startedAt, hasCea708, srtSeq }
     * @type {Map<string, { slots: Array, startedAt: Date, hasCea708: boolean, srtSeq: number }>}
     */
    this._meta = new Map();

    /** @type {Set<string>} API keys currently publishing in nginx-rtmp */
    this._publishing = new Set();

    this._onStreamStarted = onStreamStarted ?? null;
    this._onStreamEnded   = onStreamEnded   ?? null;
    this._controlUrl = rtmpControlUrl ?? process.env.RTMP_CONTROL_URL ?? null;
    this._rtmpApp    = rtmpApplication ?? process.env.RTMP_APPLICATION ?? DEFAULT_RTMP_APP;
    this._ffmpegCaps = ffmpegCaps ?? null;
  }

  // ---------------------------------------------------------------------------
  // Public: process lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start (or restart) a single ffmpeg process that forwards the source stream for `apiKey`
   * to all provided relay targets via the tee muxer.
   *
   * If any relay slot has captionMode='cea708', the process uses libx264 re-encoding with the
   * eia608 subtitle encoder so that CEA-608/708 data is embedded in H.264 SEI NAL units.
   * Otherwise the stream is forwarded with `-c copy` (no re-encoding).
   *
   * @param {string} apiKey
   * @param {Array<{ slot: number, targetUrl: string, targetName?: string|null, captionMode?: string }>} relays
   * @returns {Promise<void>}
   */
  start(apiKey, relays) {
    return new Promise((resolve, reject) => {
      if (!relays || relays.length === 0) {
        this._stopProc(apiKey);
        return resolve();
      }

      // Check if ffmpeg is available (capability check from probeFfmpeg at startup).
      // Only block if we have explicit capability info confirming ffmpeg is absent.
      if (this._ffmpegCaps?.available === false) {
        return reject(new Error('ffmpeg is not installed or not available in PATH. RTMP relay requires ffmpeg.'));
      }

      this._stopProc(apiKey);

      // CEA-708 mode disabled for now — force HTTP-only forwarding.
      const hasCea708 = false;

      // Build the tee muxer output: "[f=flv]url1|[f=flv]url2|..."
      const teeTargets = relays
        .map(r => {
          const url = r.targetName
            ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}`
            : r.targetUrl;
          return `[f=flv]${url}`;
        })
        .join('|');

      const src = sourceUrl(apiKey);
      const tag = `[ffmpeg:${apiKey.slice(0, 8)}]`;
      console.log(`[rtmp] Starting relay (tee, ${relays.length} slot(s), cea708=${hasCea708}): ${src} -> ${teeTargets}`);

      let args;
      // HTTP mode: forward without re-encoding (copy streams)
      args = ['-re', '-i', src, '-c', 'copy', '-f', 'tee', teeTargets];

      const proc = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const startedAt = new Date();
      this._procs.set(apiKey, proc);
      this._meta.set(apiKey, { slots: relays.map(r => ({ ...r })), startedAt, hasCea708, srtSeq: 0, captionsSent: 0 });

      for (const r of relays) {
        this._onStreamStarted?.(apiKey, r.slot, {
          targetUrl:   r.targetUrl,
          targetName:  r.targetName ?? null,
          captionMode: hasCea708 ? (r.captionMode ?? 'http') : 'http',
          startedAt,
        });
      }

      proc.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
      proc.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));

      proc.on('error', (err) => {
        this._procs.delete(apiKey);
        this._meta.delete(apiKey);
        console.error(`[rtmp] ffmpeg error for ${apiKey.slice(0, 8)}: ${err.message}`);
        reject(err);
      });

      proc.on('close', (code) => {
        this._procs.delete(apiKey);
        const meta = this._meta.get(apiKey);
        this._meta.delete(apiKey);

        const endedAt = new Date();
        if (meta) {
          const durationMs = endedAt.getTime() - meta.startedAt.getTime();
          for (const r of meta.slots) {
              this._onStreamEnded?.(apiKey, r.slot, {
                targetUrl:   r.targetUrl,
                targetName:  r.targetName ?? null,
                captionMode: r.captionMode ?? 'http',
                startedAt:   meta.startedAt,
                endedAt,
                durationMs,
                captionsSent: meta.captionsSent ?? 0,
              });
            }
        } else {
          console.warn(`[rtmp] Metadata missing on close for key ${apiKey.slice(0, 8)}`);
        }

        if (code !== 0 && code !== null) {
          console.warn(`[rtmp] ffmpeg exited with code ${code} for key ${apiKey.slice(0, 8)}`);
        } else {
          console.log(`[rtmp] Relay ended for key ${apiKey.slice(0, 8)}`);
        }
      });

      setImmediate(resolve);
    });
  }

  /**
   * Alias for start() — starts one process for all relay slots via tee muxer.
   * @param {string} apiKey
   * @param {Array<{ slot: number, targetUrl: string, targetName?: string|null, captionMode?: string }>} relays
   * @returns {Promise<void>}
   */
  startAll(apiKey, relays) {
    return this.start(apiKey, relays);
  }

  /**
   * Stop the ffmpeg relay process for an API key.
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  stop(apiKey) {
    return new Promise((resolve) => {
      const proc = this._procs.get(apiKey);
      if (!proc) return resolve();
      proc.once('close', () => resolve());
      this._stopProc(apiKey);
    });
  }

  /**
   * Alias for stop() — stops the single process for this API key.
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  stopKey(apiKey) {
    return this.stop(apiKey);
  }

  /**
   * Stop all running relay processes. Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    const keys = [...this._procs.keys()];
    await Promise.all(keys.map(k => this.stop(k)));
  }

  // ---------------------------------------------------------------------------
  // Public: CEA-708 caption injection
  // ---------------------------------------------------------------------------

  /**
   * Inject a caption cue into the ffmpeg stdin pipe (CEA-708 mode only).
   *
   * The cue is formatted as SRT and written to the stdin of the running ffmpeg process.
   * ffmpeg's eia608 subtitle encoder embeds the CEA-608/708 data into the next available
   * H.264 video frame as a cc_data SEI NAL unit (user_data_registered_itu_t_35).
   *
   * Timing options (wall-clock Date / ISO string / ms epoch):
   *   opts.speechStart — VAD onset time; used directly as the cue start.
   *                      If absent, cue start = `timestamp - CEA708_OFFSET_MS`.
   *   opts.timestamp   — ASR finalisation time.
   *
   * @param {string} apiKey
   * @param {string} text        Plain-text caption (no HTML tags)
   * @param {{ speechStart?: Date|string|number, timestamp?: Date|string|number }} [opts]
   * @returns {boolean}  true if cue was written, false if not in CEA-708 mode or pipe unavailable
   */
  writeCaption(apiKey, text, { speechStart, timestamp } = {}) {
    // CEA-708 disabled: no-op writeCaption and return false.
    return false;
  }

  // ---------------------------------------------------------------------------
  // Public: state queries
  // ---------------------------------------------------------------------------

  /**
   * Check whether any relay is currently running for an API key.
   * @param {string} apiKey
   * @returns {boolean}
   */
  isRunning(apiKey) {
    return this._procs.has(apiKey);
  }

  /**
   * Check whether a specific relay slot is in the running tee.
   * @param {string} apiKey
   * @param {number} slot
   * @returns {boolean}
   */
  isSlotRunning(apiKey, slot) {
    const meta = this._meta.get(apiKey);
    return !!meta && meta.slots.some(s => s.slot === slot);
  }

  /**
   * Return the sorted list of slot numbers currently running for an API key.
   * @param {string} apiKey
   * @returns {number[]}
   */
  runningSlots(apiKey) {
    const meta = this._meta.get(apiKey);
    if (!meta) return [];
    return meta.slots.map(s => s.slot).sort((a, b) => a - b);
  }

  /**
   * Return the start time of the running ffmpeg process for an API key, or null.
   * @param {string} apiKey
   * @returns {Date|null}
   */
  startedAt(apiKey) { return this._meta.get(apiKey)?.startedAt ?? null; }

  /**
   * Return true if the running process has any cea708 slot (stdin pipe active).
   * @param {string} apiKey
   * @returns {boolean}
   */
  hasCea708(apiKey) { return this._meta.get(apiKey)?.hasCea708 ?? false; }

  // ---------------------------------------------------------------------------
  // Public: nginx-rtmp publish tracking
  // ---------------------------------------------------------------------------

  /** Mark that nginx-rtmp has started publishing for an API key (on_publish received). */
  markPublishing(apiKey) { this._publishing.add(apiKey); }

  /** Mark that nginx-rtmp has stopped publishing for an API key (on_publish_done received). */
  markNotPublishing(apiKey) { this._publishing.delete(apiKey); }

  /** Check whether nginx-rtmp is currently publishing for an API key. */
  isPublishing(apiKey) { return this._publishing.has(apiKey); }

  // ---------------------------------------------------------------------------
  // Public: nginx-rtmp control API
  // ---------------------------------------------------------------------------

  /**
   * Drop the publisher from nginx using the RTMP control API.
   * Requires RTMP_CONTROL_URL to be configured.
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async dropPublisher(apiKey) {
    if (!this._controlUrl) {
      console.debug('[rtmp] RTMP_CONTROL_URL not set -- skipping drop/publisher');
      return;
    }
    const url = `${this._controlUrl}/drop/publisher?app=${encodeURIComponent(this._rtmpApp)}&name=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        console.warn(`[rtmp] drop/publisher returned ${res.status} for key ${apiKey.slice(0, 8)}`);
      } else {
        console.log(`[rtmp] drop/publisher successful for key ${apiKey.slice(0, 8)}`);
      }
    } catch (err) {
      console.error(`[rtmp] drop/publisher request failed: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Terminate the running ffmpeg process for an API key (SIGTERM then SIGKILL after 3 s).
   * Gracefully closes stdin so ffmpeg can flush any buffered CEA-708 data first.
   * @param {string} apiKey
   */
  _stopProc(apiKey) {
    const proc = this._procs.get(apiKey);
    if (!proc) return;
    this._procs.delete(apiKey);
    try {
      if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end();
    } catch (err) {
      if (err.code !== 'EPIPE') console.warn(`[rtmp] stdin.end() failed for ${apiKey.slice(0, 8)}: ${err.message}`);
    }
    try {
      proc.kill('SIGTERM');
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (err) {
          if (err.code !== 'ESRCH') console.warn(`[rtmp] SIGKILL failed for ${apiKey.slice(0, 8)}: ${err.message}`);
        }
      }, 3000);
      if (timer.unref) timer.unref();
    } catch {}
  }
}
