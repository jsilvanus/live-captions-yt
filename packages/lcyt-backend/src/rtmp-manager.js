import { spawn, spawnSync } from 'node:child_process';

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
     * @type {Map<string, { slots: Array, startedAt: Date, hasCea708: boolean, srtSeq: number, cea708DelayMs: number }>}
     */
    this._meta = new Map();

    /**
     * Server-side DSK overlay state: ordered image paths to composite on the relay stream.
     * Populated by setDskOverlay(); read by start().
     * @type {Map<string, { names: string[], imagePaths: string[] }>}
     */
    this._dskState = new Map();

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
   * **CEA-708 mode** (Phase 5): when any relay slot has `captionMode='cea708'` AND the local
   * ffmpeg binary supports `libx264` + `eia608` + `subrip`, the process re-encodes video with
   * libx264 and embeds CEA-608/708 caption data from an SRT stdin pipe.  An optional video
   * delay (`cea708DelayMs`) compensates for speech-to-text latency by shifting the video later
   * in time so real-time captions appear to arrive early (i.e., in sync with the delayed video).
   *
   * **Per-slot transcoding** (Phase 7): when any relay slot carries transcode options
   * (`scale`, `fps`, `videoBitrate`, `audioBitrate`), ffmpeg uses a `filter_complex` to produce
   * per-output video streams.  Slots without transcode options use stream copy (`-c:v copy`).
   *
   * **Server-side DSK overlay** (Phase 8): when `setDskOverlay()` has been called for this
   * API key with one or more image paths, ffmpeg composites the images on top of the video in
   * the specified order (first name = bottom layer, last = top layer) using the `overlay` filter.
   * SVG images are skipped (ffmpeg does not support SVG input natively).  DSK overlay requires
   * re-encoding (`libx264`) and is not compatible with CEA-708 mode (CEA-708 takes priority).
   *
   * CEA-708 and per-slot transcoding cannot be combined in the same process (the stdin SRT
   * pipe conflicts with the filter_complex approach).  CEA-708 takes priority if both are set.
   *
   * @param {string} apiKey
   * @param {Array<{ slot: number, targetUrl: string, targetName?: string|null, captionMode?: string, scale?: string|null, fps?: number|null, videoBitrate?: string|null, audioBitrate?: string|null }>} relays
   * @param {{ cea708DelayMs?: number }} [opts]
   * @returns {Promise<void>}
   */
  start(apiKey, relays, { cea708DelayMs = 0 } = {}) {
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

      // Determine operating mode.
      // CEA-708: any slot with captionMode='cea708' AND ffmpeg supports libx264+eia608+subrip.
      const hasCea708 = !!(
        (this._ffmpegCaps?.hasLibx264 ?? false) &&
        (this._ffmpegCaps?.hasEia608  ?? false) &&
        (this._ffmpegCaps?.hasSubrip  ?? false) &&
        relays.some(r => r.captionMode === 'cea708')
      );

      // Per-slot transcoding: any slot with scale/fps/videoBitrate/audioBitrate set.
      // Not compatible with CEA-708 (takes priority below).
      const hasTranscode = !hasCea708 && relays.some(
        r => r.scale || r.fps != null || r.videoBitrate || r.audioBitrate
      );

      // Server-side DSK overlay: images composite on top of the video in metacode order.
      // Not compatible with CEA-708 (CEA-708 takes priority).
      // Not compatible with per-slot transcoding (each slot gets its own video stream; skip DSK there).
      const dskState = !hasCea708 && !hasTranscode ? (this._dskState.get(apiKey) ?? null) : null;
      const hasDsk = !!(dskState && dskState.imagePaths.length > 0);

      const src = sourceUrl(apiKey);
      const tag = `[ffmpeg:${apiKey.slice(0, 8)}]`;
      console.log(`[rtmp] Starting relay (${relays.length} slot(s), cea708=${hasCea708}, transcode=${hasTranscode}, dsk=${hasDsk}): ${src}`);

      let args;
      let stdinMode = 'ignore';

      if (hasCea708) {
        // ── CEA-708 mode ───────────────────────────────────────────────────
        // Input 0: RTMP source; Input 1: SRT captions from stdin (pipe:0)
        args = ['-re', '-i', src, '-f', 'subrip', '-i', 'pipe:0'];

        if (cea708DelayMs > 0) {
          // Delay video and audio to compensate for STT latency.
          // The delay is specified in seconds to the setpts/asetpts filters.
          const delayS = cea708DelayMs / 1000;
          args.push('-vf', `setpts=PTS+(${delayS}/TB)`, '-af', `asetpts=PTS+(${delayS}/TB)`);
          args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
          // Re-encode audio too so the delay filter is applied
          args.push('-c:a', 'aac', '-b:a', '128k');
        } else {
          args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
          args.push('-c:a', 'copy');
        }

        args.push('-c:s', 'eia608');
        args.push('-map', '0:v', '-map', '0:a', '-map', '1:s');

        const teeTargets = relays.map(r => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv]${url}`;
        }).join('|');
        args.push('-f', 'tee', teeTargets);
        stdinMode = 'pipe';

      } else if (hasTranscode) {
        // ── Per-slot transcoding mode (Phase 7) ────────────────────────────
        // Build filter_complex: split video into N streams, apply per-slot transforms.
        const N = relays.length;
        const filterParts = [`[0:v]split=${N}${relays.map((_, i) => `[v${i}]`).join('')}`];
        const videoLabels = [];

        for (let i = 0; i < N; i++) {
          const r = relays[i];
          const filters = [];
          if (r.scale) filters.push(`scale=${r.scale.replace(/x/, ':')}`); // stored as WxH; ffmpeg wants W:H
          if (r.fps != null) filters.push(`fps=fps=${r.fps}`);

          if (filters.length > 0) {
            filterParts.push(`[v${i}]${filters.join(',')}[vout${i}]`);
            videoLabels.push(`[vout${i}]`);
          } else {
            videoLabels.push(`[v${i}]`);
          }
        }

        args = ['-re', '-i', src, '-filter_complex', filterParts.join('; ')];

        // Map per-slot video and audio streams
        for (let i = 0; i < N; i++) {
          args.push('-map', videoLabels[i]);
          args.push('-map', '0:a:0');
        }

        // Per-stream codec options
        for (let i = 0; i < N; i++) {
          const r = relays[i];
          const needsEncode = r.scale || r.fps != null || r.videoBitrate || r.audioBitrate;
          if (needsEncode) {
            args.push(`-c:v:${i}`, 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
            if (r.videoBitrate) args.push(`-b:v:${i}`, r.videoBitrate);
            args.push(`-c:a:${i}`, 'aac');
            args.push(`-b:a:${i}`, r.audioBitrate || '128k');
          } else {
            args.push(`-c:v:${i}`, 'copy');
            args.push(`-c:a:${i}`, 'copy');
          }
        }

        const teeTargets = relays.map((r, i) => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv:select=v:${i}+a:${i}]${url}`;
        }).join('|');
        args.push('-f', 'tee', teeTargets);

      } else if (hasDsk) {
        // ── Server-side DSK overlay mode (Phase 8) ─────────────────────────
        // Add source then each image as a separate input.
        args = ['-re', '-i', src];
        for (const imgPath of dskState.imagePaths) {
          args.push('-i', imgPath);
        }

        // Build the overlay chain: [0:v][1:v]overlay=0:0[odsk0]; [odsk0][2:v]overlay=0:0[odsk1] ...
        // The first listed image is the bottom layer; the last is the top layer.
        const N = dskState.imagePaths.length;
        const filterParts = [];
        let prevLabel = '[0:v]';
        for (let i = 0; i < N; i++) {
          const imgLabel = `[${i + 1}:v]`;
          const outLabel = i < N - 1 ? `[odsk${i}]` : '[ovout]';
          filterParts.push(`${prevLabel}${imgLabel}overlay=0:0${outLabel}`);
          prevLabel = outLabel;
        }

        args.push('-filter_complex', filterParts.join('; '));
        args.push('-map', '[ovout]', '-map', '0:a');
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
        args.push('-c:a', 'copy');

        const teeTargets = relays.map(r => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv]${url}`;
        }).join('|');
        args.push('-f', 'tee', teeTargets);

      } else {
        // ── Simple stream copy mode (Phase 1) ─────────────────────────────
        const teeTargets = relays.map(r => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv]${url}`;
        }).join('|');
        args = ['-re', '-i', src, '-c', 'copy', '-f', 'tee', teeTargets];
      }

      const proc = spawn('ffmpeg', args, {
        stdio: [stdinMode, 'pipe', 'pipe'],
      });

      const startedAt = new Date();
      this._procs.set(apiKey, proc);
      this._meta.set(apiKey, { slots: relays.map(r => ({ ...r })), startedAt, hasCea708, hasDsk, dskNames: dskState?.names ?? [], srtSeq: 0, captionsSent: 0, cea708DelayMs });

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
   * @param {{ cea708DelayMs?: number }} [opts]
   * @returns {Promise<void>}
   */
  startAll(apiKey, relays, opts) {
    return this.start(apiKey, relays, opts);
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
    if (!this.hasCea708(apiKey)) return false;

    const proc = this._procs.get(apiKey);
    if (!proc || !proc.stdin || proc.stdin.destroyed) return false;

    const meta = this._meta.get(apiKey);
    if (!meta) return false;

    const now = Date.now();
    const streamTimeMs = now - meta.startedAt.getTime();

    /**
     * Convert a wall-clock timestamp value to ms-since-stream-start.
     * @param {Date|string|number} val
     * @returns {number}
     */
    function toStreamMs(val) {
      if (val instanceof Date) return val.getTime() - meta.startedAt.getTime();
      if (typeof val === 'string') return new Date(val).getTime() - meta.startedAt.getTime();
      if (typeof val === 'number') {
        // Values >= 1e12 are treated as Unix epoch ms (wall-clock);
        // smaller values are already stream-relative ms (elapsed since stream start).
        return val >= 1e12 ? val - meta.startedAt.getTime() : val;
      }
      return streamTimeMs;
    }

    let cueStartMs;
    if (speechStart !== undefined && speechStart !== null) {
      // VAD onset — use as cue start
      cueStartMs = Math.max(0, toStreamMs(speechStart));
    } else if (timestamp !== undefined && timestamp !== null) {
      // ASR finalisation minus offset
      cueStartMs = Math.max(0, toStreamMs(timestamp) - CEA708_OFFSET_MS);
    } else {
      // No timing info — shift back from current stream time
      cueStartMs = Math.max(0, streamTimeMs - CEA708_OFFSET_MS);
    }

    // Don't backtrack too far — decoders typically discard stale SEI data
    const minStartMs = Math.max(0, streamTimeMs - CEA708_MAX_BACKTRACK_MS);
    cueStartMs = Math.max(minStartMs, cueStartMs);

    meta.srtSeq += 1;
    meta.captionsSent = (meta.captionsSent || 0) + 1;
    const cue = buildSrtCue(meta.srtSeq, cueStartMs, CEA708_DURATION_MS, text);

    try {
      proc.stdin.write(cue);
      return true;
    } catch (err) {
      if (err.code !== 'EPIPE') {
        console.error(`[rtmp] Failed to write CEA-708 cue for ${apiKey.slice(0, 8)}: ${err.message}`);
      }
      return false;
    }
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

  /**
   * Return true if the running process has an active server-side DSK overlay.
   * @param {string} apiKey
   * @returns {boolean}
   */
  hasDsk(apiKey) { return this._meta.get(apiKey)?.hasDsk ?? false; }

  /**
   * Return the ordered list of DSK shorthand names currently overlaid on the stream.
   * First element = bottom layer; last element = top layer.
   * Returns an empty array when no DSK is active.
   * @param {string} apiKey
   * @returns {string[]}
   */
  dskNames(apiKey) { return this._meta.get(apiKey)?.dskNames ?? []; }

  /**
   * Update the server-side DSK overlay for an API key and restart the relay if running.
   *
   * Call this whenever a `<!-- graphics:... -->` code is received.  Pass an empty `names`
   * array (or `imagePaths` of length 0) to clear the overlay and return to copy mode.
   *
   * Images are composited in the order they appear in `imagePaths` (first = bottom layer).
   * SVG images should be excluded by the caller — ffmpeg cannot overlay SVG natively.
   *
   * @param {string} apiKey
   * @param {string[]} names        Shorthand names in metacode order (for metadata tracking)
   * @param {string[]} imagePaths   Absolute paths to raster image files (PNG/WebP), same order
   * @returns {Promise<void>}
   */
  async setDskOverlay(apiKey, names, imagePaths) {
    const effective = imagePaths.filter(Boolean);
    if (effective.length === 0) {
      this._dskState.delete(apiKey);
    } else {
      this._dskState.set(apiKey, { names, imagePaths: effective });
    }

    // Restart the relay with the updated overlay if it is currently running.
    // This will cause a brief (~0.5 s) stream interruption at the DSK change point,
    // which is acceptable — DSK changes happen at known cue points, not continuously.
    if (this.isRunning(apiKey)) {
      const meta = this._meta.get(apiKey);
      if (meta) {
        try {
          await this.start(apiKey, meta.slots, { cea708DelayMs: meta.cea708DelayMs ?? 0 });
        } catch (err) {
          console.error(`[rtmp] Failed to restart relay after DSK update for ${apiKey.slice(0, 8)}: ${err.message}`);
        }
      }
    }
  }

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

/**
 * Probe local ffmpeg for required features (libx264, eia608, subrip).
 * @returns {{ available: boolean, hasLibx264: boolean, hasEia608: boolean, hasSubrip: boolean }}
 */
export function probeFfmpeg() {
  // First, check if ffmpeg binary exists at all
  const which = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 3000 });
  if (which.error) {
    const isNotFound = which.error.code === 'ENOENT' || which.error.message?.includes('ENOENT');
    if (isNotFound) {
      console.warn('⚠ ffmpeg not found in PATH — RTMP relay will not be available.');
      console.warn('  Install ffmpeg to enable stream relay: https://ffmpeg.org/download.html');
    } else {
      console.warn('⚠ ffmpeg probe failed:', which.error.message);
    }
    return { available: false, hasLibx264: false, hasEia608: false, hasSubrip: false };
  }

  try {
    const enc = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 3000 });
    const fmts = spawnSync('ffmpeg', ['-hide_banner', '-formats'], { encoding: 'utf8', timeout: 3000 });
    const demux = spawnSync('ffmpeg', ['-hide_banner', '-demuxers'], { encoding: 'utf8', timeout: 3000 });

    const encOut = (enc.stdout || '') + (enc.stderr || '');
    const fmtsOut = (fmts.stdout || '') + (fmts.stderr || '');
    const demuxOut = (demux.stdout || '') + (demux.stderr || '');

    const hasLibx264 = /libx264/i.test(encOut);
    const hasEia608 = /eia-?608|eia_?608|eia608/i.test(encOut);
    const hasSubrip = /subrip/i.test(fmtsOut) || /subrip/i.test(demuxOut);

    console.info('✓ ffmpeg found — RTMP relay is available.');

    if (!hasLibx264) {
      console.info('  [i] ffmpeg: libx264 encoder not detected -- CEA-708 embedded captions unavailable (HTTP caption mode will be used).');
    }

    return { available: true, hasLibx264, hasEia608, hasSubrip };
  } catch (err) {
    console.warn('⚠ ffmpeg probe failed:', err.message);
    return { available: false, hasLibx264: false, hasEia608: false, hasSubrip: false };
  }
}
