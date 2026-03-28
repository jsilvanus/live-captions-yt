import { spawn, spawnSync } from 'node:child_process';
import { createFfmpegRunner } from 'lcyt-backend/ffmpeg';
import { makeFifo } from 'lcyt-backend/ffmpeg/pipe-utils';
import { createWriteStream } from 'node:fs';
import { MediaMtxClient } from './mediamtx-client.js';
import logger from 'lcyt/logger';
import logger from 'lcyt/logger';

const DEFAULT_RTMP_HOST       = process.env.RTMP_HOST             || 'rtmp.lcyt.fi';
const DEFAULT_RTMP_APP        = process.env.RTMP_APP              || 'stream';
const DEFAULT_MEDIAMTX_RTSP   = (process.env.MEDIAMTX_RTSP_BASE_URL || 'rtsp://127.0.0.1:8554').replace(/\/$/, '');

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
   *   mediamtxClient?: import('./mediamtx-client.js').MediaMtxClient|null,
   * }} [opts]
   */
  constructor({ onStreamStarted, onStreamEnded, rtmpControlUrl, rtmpApplication, ffmpegCaps, mediamtxClient } = {}) {
    /**
     * One ffmpeg process per API key (CEA-708, DSK overlay, or per-slot transcode).
     * @type {Map<string, import('node:child_process').ChildProcess>}
     */
    this._procs = new Map();

    /**
     * Plain relay keys managed by MediaMTX (no local ffmpeg process).
     * MediaMTX runs the forwarding command via its runOnPublish hook.
     * @type {Map<string, { slots: Array, startedAt: Date }>}
     */
    this._mediamtxRelays = new Map();

    /**
     * Per-key metadata: { slots, startedAt, hasCea708, srtSeq }
     * @type {Map<string, { slots: Array, startedAt: Date, hasCea708: boolean, srtSeq: number, cea708DelayMs: number }>}
     */
    this._meta = new Map();

    /**
     * Server-side DSK overlay state: ordered image paths to composite on the relay stream.
     * Populated by setDskOverlay(); read by start().
     * For RTMP DSK streams, only `rtmpUrl` is set (no imagePaths).
     * @type {Map<string, { names: string[], imagePaths: string[], rtmpUrl?: string }>}
     */
    this._dskState = new Map();

    /** @type {Set<string>} API keys currently publishing in nginx-rtmp */
    this._publishing = new Set();

    this._onStreamStarted = onStreamStarted ?? null;
    this._onStreamEnded   = onStreamEnded   ?? null;
    this._controlUrl = rtmpControlUrl ?? process.env.RTMP_CONTROL_URL ?? null;
    this._rtmpApp    = rtmpApplication ?? process.env.RTMP_APPLICATION ?? DEFAULT_RTMP_APP;
    this._ffmpegCaps = ffmpegCaps ?? null;
    // MediaMTX REST API client. When provided (or MEDIAMTX_API_URL is set), `dropPublisher`
    // uses the MediaMTX `/v3/paths/kick` endpoint instead of the nginx-rtmp control URL.
    this._mediamtx = mediamtxClient
      ?? (process.env.MEDIAMTX_API_URL ? new MediaMtxClient() : null);
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
  async start(apiKey, relays, { cea708DelayMs = 0 } = {}) {
      if (!relays || relays.length === 0) {
        this._stopProc(apiKey);
        return;
      }

      // Check if ffmpeg is available (capability check from probeFfmpeg at startup).
      // Only block if we have explicit capability info confirming ffmpeg is absent.
      if (this._ffmpegCaps?.available === false) {
        throw new Error('ffmpeg is not installed or not available in PATH. RTMP relay requires ffmpeg.');
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
      const hasDsk = !!(dskState && (dskState.imagePaths?.length > 0 || dskState.rtmpUrl));

      const src = sourceUrl(apiKey);
      
      logger.info(`[rtmp] Starting relay (${relays.length} slot(s), cea708=${hasCea708}, transcode=${hasTranscode}, dsk=${hasDsk}): ${src}`);

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

        // Per-stream codec options.
        // NOTE: All video outputs come from the filter_complex (split filter), so stream-copy
        // is not possible for any video stream — filtergraph outputs must be re-encoded.
        // Audio is mapped directly from input (0:a:0) and can still be copied.
        for (let i = 0; i < N; i++) {
          const r = relays[i];
          args.push(`-c:v:${i}`, 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
          if (r.videoBitrate) args.push(`-b:v:${i}`, r.videoBitrate);
          if (r.audioBitrate) {
            args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, r.audioBitrate);
          } else {
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
        if (dskState.rtmpUrl) {
          // RTMP stream as DSK source (e.g. from OBS pushing to rtmp://server/dsk/<key>)
          args = ['-re', '-i', src, '-re', '-i', dskState.rtmpUrl];
          args.push('-filter_complex', '[0:v][1:v]overlay=0:0:shortest=1[ovout]');
        } else {
          // Static image files as DSK source
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
        }

        args.push('-map', '[ovout]', '-map', '0:a');
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
        args.push('-c:a', 'copy');

        const teeTargets = relays.map(r => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv]${url}`;
        }).join('|');
        args.push('-f', 'tee', teeTargets);

      } else if (this._mediamtx) {
        // ── Plain relay via MediaMTX runOnPublish (no local ffmpeg process) ─
        // Validate API key and target URLs strictly to avoid shell/command injection
        const SAFE_APIKEY_RE = /^[A-Za-z0-9_-]+$/;
        const SAFE_RTMP_RE = /^rtmp:\/\/[A-Za-z0-9.:-]+\/[A-Za-z0-9_\-\/\.]+$/;
        const SAFE_NAME_RE = /^[A-Za-z0-9_\-]+$/;

        if (!SAFE_APIKEY_RE.test(apiKey)) {
          throw new Error('API key contains unsafe characters for MediaMTX runOnPublish');
        }

        for (const r of relays) {
          const nameOk = r.targetName == null || SAFE_NAME_RE.test(r.targetName);
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          if (!nameOk || !SAFE_RTMP_RE.test(url)) {
            throw new Error(`Target URL or name unsafe for MediaMTX runOnPublish: ${String(url).slice(0,80)}`);
          }
        }

        const teeTargets = relays.map(r => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv]${url}`;
        }).join('|');

        // Escape double-quotes as a safety measure (shouldn't be present after validation).
        const safeTee = teeTargets.replace(/"/g, '');
        const runOnPublish = `ffmpeg -re -i ${DEFAULT_MEDIAMTX_RTSP}/${encodeURIComponent(apiKey)} -c copy -f tee "${safeTee}"`;

        try {
          await this._mediamtx.addPath(apiKey, { runOnPublish, runOnPublishRestart: true });
          logger.info(`[rtmp] Plain relay for ${apiKey.slice(0,8)} configured via MediaMTX (${relays.length} slot(s))`);
        } catch (err) {
          logger.warn(`[rtmp] MediaMTX addPath failed for ${apiKey.slice(0,8)}: ${err.message} — stream may not forward`);
        }

        // Kick the current publisher so MediaMTX fires runOnPublish immediately.
        this._mediamtx.kickPath(apiKey).catch(() => {});

        const startedAt = new Date();
        this._mediamtxRelays.set(apiKey, { slots: relays.map(r => ({ ...r })), startedAt });

        for (const r of relays) {
          this._onStreamStarted?.(apiKey, r.slot, {
            targetUrl:   r.targetUrl,
            targetName:  r.targetName ?? null,
            captionMode: 'http',
            startedAt,
          });
        }
        return;

      } else {
        // ── Simple stream copy mode fallback (no MediaMTX client) ─────────
        const teeTargets = relays.map(r => {
          const url = r.targetName ? `${r.targetUrl.replace(/\/$/, '')}/${r.targetName}` : r.targetUrl;
          return `[f=flv]${url}`;
        }).join('|');
        args = ['-re', '-i', src, '-c', 'copy', '-f', 'tee', teeTargets];
      }

      const tag = `[ffmpeg:${apiKey.slice(0, 8)}]`;

      // Optionally use FIFO-based stdin instead of pipe (disabled by default).
      const useFifo = process.env.FFMPEG_USE_FIFO === '1';

      // If using FIFO and we are in CEA-708 mode, replace pipe:0 with a FIFO path.
      let fifoPath = null;
      if (useFifo && stdinMode === 'pipe' && hasCea708) {
        fifoPath = `/tmp/lcyt-ffmpeg-${apiKey}.srt`;
        // replace the 'pipe:0' usage with the fifo path
        const idx = args.indexOf('pipe:0');
        if (idx !== -1) {
          args[idx] = fifoPath;
        }
      }

      // Build runner options: pass stdin mode if using pipe; Local runner will accept 'pipe' or 'ignore'
      const runnerOpts = {
        runner: process.env.FFMPEG_RUNNER ?? 'spawn',
        cmd: 'ffmpeg',
        args,
        name: tag,
        stdin: stdinMode,
      };

      const runner = createFfmpegRunner(runnerOpts);

      const handle = await runner.start();

      const startedAt = new Date();
      this._procs.set(apiKey, handle);
      this._meta.set(apiKey, { slots: relays.map(r => ({ ...r })), startedAt, hasCea708, hasDsk, dskNames: dskState?.names ?? [], srtSeq: 0, captionsSent: 0, cea708DelayMs, fifoPath });

      // If FIFO requested, create it and a writer stream for caption injection
      if (fifoPath) {
        try {
          await makeFifo(fifoPath);
          try {
            // createFifoWriter may be async in the new runner API; await it.
            const { createFifoWriter } = await import('../../../lcyt-backend/src/ffmpeg/pipe-utils.js');
            const writer = await createFifoWriter(fifoPath, { timeoutMs: 50 });
            const meta = this._meta.get(apiKey);
            if (meta) meta._fifoWriter = writer;
          } catch (e) {
            logger.warn(`[rtmp] Failed to open FIFO writer for ${apiKey.slice(0,8)}: ${e.message}`);
          }
        } catch (err) {
          logger.warn(`[rtmp] makeFifo failed for ${fifoPath}: ${err.message}`);
        }
      }

      for (const r of relays) {
        this._onStreamStarted?.(apiKey, r.slot, {
          targetUrl:   r.targetUrl,
          targetName:  r.targetName ?? null,
          captionMode: hasCea708 ? (r.captionMode ?? 'http') : 'http',
          startedAt,
        });
      }

      if (handle && handle.stdout) handle.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
      if (handle && handle.stderr) handle.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));

      // Runner emits 'error' and 'close' events like child process.
      // By this point start() has already returned successfully; these callbacks only
      // handle cleanup and stat recording after the relay process exits.
      runner.on('error', (err) => {
        this._procs.delete(apiKey);
        this._meta.delete(apiKey);
        logger.error(`[rtmp] ffmpeg error for ${apiKey.slice(0, 8)}: ${err.message}`);
      });

      runner.on('close', (info) => {
        this._procs.delete(apiKey);
        const meta = this._meta.get(apiKey);
        this._meta.delete(apiKey);

        // Close any FIFO writer
        if (meta && meta._fifoWriter && typeof meta._fifoWriter.close === 'function') {
          try { meta._fifoWriter.close(); } catch (e) {}
        }

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
          logger.warn(`[rtmp] Metadata missing on close for key ${apiKey.slice(0, 8)}`);
        }

        if (info && info.code !== undefined && info.code !== null) {
          logger.warn(`[rtmp] ffmpeg exited with code ${info.code} for key ${apiKey.slice(0, 8)}`);
        } else {
          logger.info(`[rtmp] Relay ended for key ${apiKey.slice(0, 8)}`);
        }
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
   * Stop the relay for an API key.
   * Handles both MediaMTX-managed plain relays and local ffmpeg processes.
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  stop(apiKey) {
    return (async () => {
      // MediaMTX-managed plain relay
      if (this._mediamtxRelays.has(apiKey)) {
        const meta = this._mediamtxRelays.get(apiKey);
        this._mediamtxRelays.delete(apiKey);
        if (this._mediamtx) {
          try { await this._mediamtx.deletePath(apiKey); } catch {}
        }
        if (meta) {
          const endedAt = new Date();
          const durationMs = endedAt.getTime() - meta.startedAt.getTime();
          for (const r of meta.slots) {
            this._onStreamEnded?.(apiKey, r.slot, {
              targetUrl:   r.targetUrl,
              targetName:  r.targetName ?? null,
              captionMode: 'http',
              startedAt:   meta.startedAt,
              endedAt,
              durationMs,
              captionsSent: 0,
            });
          }
        }
        return;
      }

      // Local ffmpeg process
      const handle = this._procs.get(apiKey);
      if (!handle) return;
      try {
        if (typeof handle.stop === 'function') {
          await handle.stop(3000);
        } else {
          await new Promise(resolve => {
            handle.once && handle.once('close', resolve);
            this._stopProc(apiKey);
          });
        }
      } finally {
        this._stopProc(apiKey);
      }
    })();
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
   * Stop all running relays (both MediaMTX-managed and local ffmpeg). Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    const keys = new Set([...this._procs.keys(), ...this._mediamtxRelays.keys()]);
    await Promise.all([...keys].map(k => this.stop(k)));
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
  async writeCaption(apiKey, text, { speechStart, timestamp } = {}) {
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

    // The video stream is delayed by cea708DelayMs via the setpts filter, so caption cue
    // timestamps must be shifted forward by the same amount to align with the delayed frames.
    const delayMs = meta.cea708DelayMs || 0;

    let cueStartMs;
    if (speechStart !== undefined && speechStart !== null) {
      // VAD onset — use as cue start, shifted by video delay
      cueStartMs = Math.max(0, toStreamMs(speechStart) + delayMs);
    } else if (timestamp !== undefined && timestamp !== null) {
      // ASR finalisation minus pre-roll offset, shifted by video delay
      cueStartMs = Math.max(0, toStreamMs(timestamp) - CEA708_OFFSET_MS + delayMs);
    } else {
      // No timing info — shift back from current stream time, compensating for video delay
      cueStartMs = Math.max(0, streamTimeMs - CEA708_OFFSET_MS + delayMs);
    }

    // Don't backtrack too far — decoders typically discard stale SEI data.
    // The reference point is the delayed stream time (current video PTS seen by the decoder).
    const delayedStreamTimeMs = streamTimeMs + delayMs;
    const minStartMs = Math.max(0, delayedStreamTimeMs - CEA708_MAX_BACKTRACK_MS);
    cueStartMs = Math.max(minStartMs, cueStartMs);

    meta.srtSeq += 1;
    meta.captionsSent = (meta.captionsSent || 0) + 1;
    const cue = buildSrtCue(meta.srtSeq, cueStartMs, CEA708_DURATION_MS, text);

    try {
      const meta = this._meta.get(apiKey);
      // FIFO mode: write to FIFO writer if present (non-blocking, returns boolean)
      if (meta && meta._fifoWriter) {
        try {
          const ok = await meta._fifoWriter.write(cue);
          if (!ok) {
            // record metric and return false
            logger.warn(`[rtmp] FIFO write timed out/dropped for ${apiKey.slice(0,8)}`);
            return false;
          }
          return true;
        } catch (err) {
          logger.error(`[rtmp] FIFO writer error for ${apiKey.slice(0,8)}: ${err.message}`);
          return false;
        }
      }

      // Default: write to child process stdin
      if (proc && proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write(cue);
        return true;
      }
      return false;
    } catch (err) {
      if (err.code !== 'EPIPE') {
        logger.error(`[rtmp] Failed to write CEA-708 cue for ${apiKey.slice(0, 8)}: ${err.message}`);
      }
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Public: state queries
  // ---------------------------------------------------------------------------

  /**
   * Check whether any relay is currently running for an API key.
   * Covers both MediaMTX-managed plain relays and local ffmpeg processes.
   * @param {string} apiKey
   * @returns {boolean}
   */
  isRunning(apiKey) {
    return this._procs.has(apiKey) || this._mediamtxRelays.has(apiKey);
  }

  /**
   * Check whether a specific relay slot is in the running tee.
   * @param {string} apiKey
   * @param {number} slot
   * @returns {boolean}
   */
  isSlotRunning(apiKey, slot) {
    const meta = this._meta.get(apiKey) ?? this._mediamtxRelays.get(apiKey);
    return !!meta && meta.slots.some(s => s.slot === slot);
  }

  /**
   * Return the sorted list of slot numbers currently running for an API key.
   * @param {string} apiKey
   * @returns {number[]}
   */
  runningSlots(apiKey) {
    const meta = this._meta.get(apiKey) ?? this._mediamtxRelays.get(apiKey);
    if (!meta) return [];
    return meta.slots.map(s => s.slot).sort((a, b) => a - b);
  }

  /**
   * Return the start time of the running relay for an API key, or null.
   * @param {string} apiKey
   * @returns {Date|null}
   */
  startedAt(apiKey) {
    return (this._meta.get(apiKey) ?? this._mediamtxRelays.get(apiKey))?.startedAt ?? null;
  }

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
          logger.error(`[rtmp] Failed to restart relay after DSK update for ${apiKey.slice(0, 8)}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Set an RTMP stream as the server-side DSK overlay source for an API key.
   * Call this when an OBS/broadcaster publishes to the backend's DSK nginx-rtmp endpoint.
   * Pass `null` for `rtmpUrl` to clear the RTMP DSK overlay.
   *
   * @param {string} apiKey     The API key that owns the relay
   * @param {string|null} rtmpUrl  Full RTMP URL of the DSK source (e.g. rtmp://127.0.0.1:1935/dsk/mykey)
   * @returns {Promise<void>}
   */
  async setDskRtmpSource(apiKey, rtmpUrl) {
    if (!rtmpUrl) {
      this._dskState.delete(apiKey);
    } else {
      this._dskState.set(apiKey, { names: ['rtmp-dsk'], imagePaths: [], rtmpUrl });
    }

    if (this.isRunning(apiKey)) {
      const meta = this._meta.get(apiKey);
      if (meta) {
        try {
          await this.start(apiKey, meta.slots, { cea708DelayMs: meta.cea708DelayMs ?? 0 });
        } catch (err) {
          logger.error(`[rtmp] Failed to restart relay after RTMP DSK update for ${apiKey.slice(0, 8)}: ${err.message}`);
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
  // Public: media-server control API (MediaMTX or nginx-rtmp)
  // ---------------------------------------------------------------------------

  /**
   * Drop the active publisher for a stream key.
   *
   * **MediaMTX** (preferred): when a `MediaMtxClient` is configured (via the `mediamtxClient`
   * constructor option or the `MEDIAMTX_API_URL` environment variable), this calls
   * `POST /v3/paths/kick/<name>` on the MediaMTX REST API.
   *
   * **nginx-rtmp fallback**: when no MediaMTX client is available but `RTMP_CONTROL_URL`
   * is set, falls back to the legacy nginx-rtmp control API (`drop/publisher` endpoint).
   *
   * If neither is configured the call is a no-op (logs at debug level).
   *
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async dropPublisher(apiKey) {
    // --- MediaMTX path (preferred) -------------------------------------------
    if (this._mediamtx) {
      try {
        await this._mediamtx.kickPath(apiKey);
        logger.info(`[rtmp] mediamtx kick successful for key ${apiKey.slice(0, 8)}`);
      } catch (err) {
        logger.warn(`[rtmp] mediamtx kick failed for key ${apiKey.slice(0, 8)}: ${err.message}`);
      }
      return;
    }

    // --- nginx-rtmp fallback --------------------------------------------------
    if (!this._controlUrl) {
      logger.debug('[rtmp] neither MEDIAMTX_API_URL nor RTMP_CONTROL_URL set -- skipping drop/publisher');
      return;
    }
    const url = `${this._controlUrl}/drop/publisher?app=${encodeURIComponent(this._rtmpApp)}&name=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        logger.warn(`[rtmp] drop/publisher returned ${res.status} for key ${apiKey.slice(0, 8)}`);
      } else {
        logger.info(`[rtmp] drop/publisher successful for key ${apiKey.slice(0, 8)}`);
      }
    } catch (err) {
      logger.error(`[rtmp] drop/publisher request failed: ${err.message}`);
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
      // Runner handle (new interface) exposes .stop(). Prefer that.
      if (typeof proc.stop === 'function') {
        try { proc.stop().catch(() => {}); } catch (e) {}
        return;
      }
      if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end();
    } catch (err) {
      if (err.code !== 'EPIPE') logger.warn(`[rtmp] stdin.end() failed for ${apiKey.slice(0, 8)}: ${err.message}`);
    }
    try {
      if (typeof proc.kill === 'function') proc.kill('SIGTERM');
      const timer = setTimeout(() => {
        try { if (typeof proc.kill === 'function') proc.kill('SIGKILL'); } catch (err) {
          if (err.code !== 'ESRCH') logger.warn(`[rtmp] SIGKILL failed for ${apiKey.slice(0, 8)}: ${err.message}`);
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
      logger.warn('⚠ ffmpeg not found in PATH — RTMP relay will not be available.');
      logger.warn('  Install ffmpeg to enable stream relay: https://ffmpeg.org/download.html');
    } else {
      logger.warn('⚠ ffmpeg probe failed:', which.error.message);
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

    logger.info('✓ ffmpeg found — RTMP relay is available.');

    if (!hasLibx264) {
      logger.info('  [i] ffmpeg: libx264 encoder not detected -- CEA-708 embedded captions unavailable (HTTP caption mode will be used).');
    }

    return { available: true, hasLibx264, hasEia608, hasSubrip };
  } catch (err) {
    logger.warn('⚠ ffmpeg probe failed:', err.message);
    return { available: false, hasLibx264: false, hasEia608: false, hasSubrip: false };
  }
}