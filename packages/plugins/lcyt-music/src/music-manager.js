/**
 * MusicManager
 *
 * Manages one server-side audio analysis session per API key. Two audio
 * sources are supported:
 *
 *  - 'hls'  (default) — polls HLS segments (MediaMTX fMP4 output) via
 *    HlsSegmentFetcher and decodes each segment to PCM via ffmpeg.
 *  - 'rtmp' — spawns ffmpeg directly against the RTMP relay's own stream
 *    (same approach as SttManager's rtmp path) and slices the continuous
 *    PCM output into fixed-duration windows. Used for deployments without
 *    MediaMTX.
 *
 * Both sources feed the same classify()/detectBpm() pipeline and confirm-
 * segments state machine.
 *
 * Unlike SttManager's transcript delivery, analysis results are NEVER
 * fanned out to YouTube/viewer/generic targets. They are signal-only:
 * the synthesised metacode caption ("<!-- sound:music --> <!-- bpm:128 -->")
 * is fed directly into the SoundCaptionProcessor, which strips it to ""
 * (nothing reaches YouTube), persists it to music_events, and emits
 * sound_label / bpm_update SSE events on the session's existing
 * GET /events stream.
 *
 * A confirm-segments state machine smooths rapid label flicker (require
 * N consecutive segments with the same label before treating it as a
 * real transition), and a caption is only synthesised when the confirmed
 * label changes or the smoothed BPM estimate moves by more than 2 BPM —
 * mirroring the client-side detector's own delta-gating before it calls
 * captionContext.send().
 *
 * Events:
 *   label_change ({ apiKey, label, confidence, bpm, ts })
 *   bpm_update   ({ apiKey, bpm, confidence, ts })
 *   error        ({ apiKey, error })
 *   stopped      ({ apiKey })
 *
 * @module music-manager
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { HlsSegmentFetcher } from './hls-segment-fetcher.js';
import { extractPcm, probeFfmpegVersion } from './pcm-extractor.js';
import { classify } from './analyser/spectral-detector.js';
import { classifyExternal } from './analyser/external-classifier.js';
import { detectBpm, createBpmSmoother } from './analyser/bpm-detector.js';
import { getMusicConfig } from './db.js';

// Matches the repo-wide MediaMTX HLS convention (PORTS.md, docker/mediamtx.yml
// hlsAddress :8080) — override with MEDIAMTX_HLS_BASE_URL.
const DEFAULT_MEDIAMTX_HLS_BASE = 'http://127.0.0.1:8080';
const SAMPLE_RATE = 22050;
const BPM_CHANGE_THRESHOLD = 2;
// RTMP path has no natural segment boundary, so PCM is windowed at the same
// duration MediaMTX is recommended to use for HLS segments (see plan_music.md
// Open Questions #3) — a comfortable 3-4 beat window at most tempos.
const RTMP_WINDOW_SECONDS = 6;
const RTMP_WINDOW_BYTES = SAMPLE_RATE * RTMP_WINDOW_SECONDS * 2; // s16le mono

// Phase 4: auto-calibration. Sample RMS energy for the first ~5s of audio
// (instead of classifying) and derive a silenceThreshold from the observed
// range, clamped to a sane band so a near-silent or very loud room can't
// produce a degenerate threshold.
const CALIBRATION_SECONDS = 5;
const CALIBRATION_MIN_THRESHOLD = 0.002;
const CALIBRATION_MAX_THRESHOLD = 0.05;
const CALIBRATION_FACTOR = 0.5; // midpoint between observed min/max RMS

function computeRms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

/**
 * @typedef {object} MusicSession
 * @property {string} streamKey
 * @property {'hls'|'rtmp'} audioSource
 * @property {Date} startedAt
 * @property {number} segmentsProcessed
 * @property {HlsSegmentFetcher|null} fetcher
 * @property {import('node:child_process').ChildProcess|null} ffmpegProc
 * @property {Buffer} pcmAccumulator   raw s16le bytes awaiting a full window (rtmp source only)
 * @property {string|null} pendingLabel
 * @property {number} pendingCount
 * @property {string|null} confirmedLabel
 * @property {string|null} lastEmittedLabel
 * @property {number|null} lastEmittedBpm
 * @property {ReturnType<typeof createBpmSmoother>} bpmSmoother
 * @property {object} config
 * @property {boolean} calibrating
 * @property {number[]} calibrationSamples   RMS values observed during the calibration window
 * @property {number} calibrationSampleCount total raw PCM samples observed during calibration
 * @property {number|null} calibratedSilenceThreshold
 * @property {Promise<void>|null} processingQueue   serialises RTMP window analysis when MUSIC_CLASSIFIER_URL is set
 */

export class MusicManager extends EventEmitter {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {import('../../../lcyt-backend/src/store.js').SessionStore} store
   * @param {(apiKey: string, text: string) => string} soundProcessor
   *   Built via createSoundCaptionProcessor({ store, db }) — called directly
   *   with synthesised metacode text. Never routed through session._sendQueue.
   */
  constructor(db, store, soundProcessor) {
    super();
    this._db = db;
    this._store = store;
    this._soundProcessor = soundProcessor;
    /** @type {Map<string, MusicSession>} */
    this._sessions = new Map();
    /** @type {{ major: number, minor: number }|null} */
    this.ffmpegVersion = null;

    probeFfmpegVersion().then((v) => { this.ffmpegVersion = v; }).catch(() => {});
  }

  /**
   * Start analysis for an API key.
   *
   * @param {string} apiKey
   * @param {object} [opts]
   * @param {string} [opts.streamKey]  MediaMTX/RTMP path; defaults to apiKey
   * @param {'hls'|'rtmp'} [opts.audioSource='hls']
   */
  async start(apiKey, { streamKey = null, audioSource = 'hls' } = {}) {
    if (this._sessions.has(apiKey)) {
      await this.stop(apiKey);
    }

    if (audioSource !== 'hls' && audioSource !== 'rtmp') {
      throw new Error(`MusicManager: unsupported audioSource "${audioSource}". Supported: hls, rtmp`);
    }

    const effectiveStreamKey = streamKey || apiKey;
    const config = getMusicConfig(this._db, apiKey);

    /** @type {MusicSession} */
    const session = {
      streamKey: effectiveStreamKey,
      audioSource,
      startedAt: new Date(),
      segmentsProcessed: 0,
      fetcher: null,
      ffmpegProc: null,
      pcmAccumulator: Buffer.alloc(0),
      pendingLabel: null,
      pendingCount: 0,
      confirmedLabel: null,
      lastEmittedLabel: null,
      lastEmittedBpm: null,
      bpmSmoother: createBpmSmoother(),
      config,
      calibrating: config.autoCalibrate === true,
      calibrationSamples: [],
      calibrationSampleCount: 0,
      calibratedSilenceThreshold: null,
      processingQueue: null,
    };

    this._sessions.set(apiKey, session);

    if (audioSource === 'hls') {
      const hlsBase = process.env.MEDIAMTX_HLS_BASE_URL || DEFAULT_MEDIAMTX_HLS_BASE;
      const fetcher = new HlsSegmentFetcher({ hlsBase, streamKey: effectiveStreamKey });
      session.fetcher = fetcher;

      fetcher.on('segment', ({ buffer }) => {
        this._processSegment(apiKey, buffer).catch((err) => {
          this.emit('error', { apiKey, error: err });
        });
      });

      fetcher.on('error', ({ error }) => {
        this.emit('error', { apiKey, error });
      });

      fetcher.start();
    } else {
      this._startRtmp(apiKey, session, effectiveStreamKey);
    }
  }

  /**
   * Spawn ffmpeg against the RTMP relay's own stream and pipe raw PCM
   * straight to stdout — no HLS/MediaMTX involved. Mirrors SttManager's
   * rtmp audioSource path.
   *
   * @param {string} apiKey
   * @param {MusicSession} session
   * @param {string} streamKey
   */
  _startRtmp(apiKey, session, streamKey) {
    const rtmpBase = (process.env.HLS_LOCAL_RTMP || 'rtmp://127.0.0.1:1935').replace(/\/$/, '');
    const rtmpApp  = process.env.HLS_RTMP_APP || 'live';
    const inputUrl = `${rtmpBase}/${rtmpApp}/${streamKey}`;

    const ffmpegArgs = [
      '-hide_banner', '-loglevel', 'error',
      '-i', inputUrl,
      '-vn',                    // drop video
      '-ac', '1',                // mono
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',              // raw PCM s16le
      'pipe:1',
    ];

    let proc;
    try {
      proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this._sessions.delete(apiKey);
      throw new Error(`MusicManager: failed to spawn ffmpeg for rtmp: ${err.message}`);
    }

    session.ffmpegProc = proc;

    proc.stdout.on('data', (chunk) => {
      const sess = this._sessions.get(apiKey);
      if (!sess) return;
      sess.pcmAccumulator = Buffer.concat([sess.pcmAccumulator, chunk]);

      while (sess.pcmAccumulator.length >= RTMP_WINDOW_BYTES) {
        const windowBuf = sess.pcmAccumulator.subarray(0, RTMP_WINDOW_BYTES);
        sess.pcmAccumulator = sess.pcmAccumulator.subarray(RTMP_WINDOW_BYTES);
        this._processRtmpWindow(apiKey, windowBuf);
      }
    });

    proc.stderr.on('data', () => {}); // suppress ffmpeg's verbose output

    proc.on('error', (err) => {
      this.emit('error', { apiKey, error: new Error(`ffmpeg error: ${err.message}`) });
    });

    proc.on('close', (code) => {
      if (this._sessions.has(apiKey)) {
        if (code !== 0) {
          this.emit('error', { apiKey, error: new Error(`ffmpeg exited with code ${code}`) });
        }
        this.stop(apiKey);
      }
    });
  }

  /**
   * Stop analysis for an API key.
   * @param {string} apiKey
   */
  async stop(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) return;

    this._sessions.delete(apiKey);
    if (session.fetcher)    try { session.fetcher.stop(); }            catch { /* ignore */ }
    if (session.ffmpegProc) try { session.ffmpegProc.kill('SIGTERM'); } catch { /* ignore */ }

    this.emit('stopped', { apiKey });
  }

  /** Stop all running sessions. */
  async stopAll() {
    const keys = [...this._sessions.keys()];
    await Promise.all(keys.map((k) => this.stop(k)));
  }

  /**
   * @param {string} apiKey
   * @returns {boolean}
   */
  isRunning(apiKey) {
    return this._sessions.has(apiKey);
  }

  /**
   * @param {string} apiKey
   * @returns {{ running: boolean, streamKey?: string, audioSource?: 'hls'|'rtmp', startedAt?: Date, segmentsProcessed?: number, label?: string|null, bpm?: number|null, ffmpegVersion?: object|null }}
   */
  getStatus(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) {
      return { running: false, ffmpegVersion: this.ffmpegVersion ?? null };
    }
    return {
      running: true,
      streamKey: session.streamKey,
      audioSource: session.audioSource,
      startedAt: session.startedAt,
      segmentsProcessed: session.segmentsProcessed,
      label: session.lastEmittedLabel,
      bpm: session.lastEmittedBpm,
      ffmpegVersion: this.ffmpegVersion ?? null,
      calibrating: session.calibrating,
      calibratedSilenceThreshold: session.calibratedSilenceThreshold,
    };
  }

  // ── Internal ───────────────────────────────────────────────────────────

  /**
   * @param {string} apiKey
   * @param {Buffer} segmentBuffer
   */
  async _processSegment(apiKey, segmentBuffer) {
    const session = this._sessions.get(apiKey);
    if (!session) return;

    session.segmentsProcessed++;

    const pcm = await extractPcm(segmentBuffer, { sampleRate: SAMPLE_RATE });
    if (pcm.length === 0) return;

    await this._analysePcm(apiKey, session, pcm);
  }

  /**
   * Convert one fixed-duration window of raw s16le PCM bytes (RTMP source)
   * into normalised Float32 samples and run it through the shared analysis
   * pipeline. Mirrors the Int16LE→Float32 conversion in pcm-extractor.js.
   *
   * @param {string} apiKey
   * @param {Buffer} windowBuf
   */
  _processRtmpWindow(apiKey, windowBuf) {
    const session = this._sessions.get(apiKey);
    if (!session) return;

    session.segmentsProcessed++;

    const sampleCount = Math.floor(windowBuf.length / 2);
    const pcm = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      pcm[i] = windowBuf.readInt16LE(i * 2) / 32768;
    }
    if (pcm.length === 0) return;

    // Default path (no MUSIC_CLASSIFIER_URL): call _analysePcm directly
    // rather than via .then() chaining. Its body runs synchronously to
    // completion in that case (no await is reached), which several RTMP
    // tests rely on — they emit('data', ...) and assert state immediately
    // afterward with no await. When MUSIC_CLASSIFIER_URL is set, route
    // through session.processingQueue so windows arriving in the same
    // chunk are classified (and their events emitted) in strict order.
    if (process.env.MUSIC_CLASSIFIER_URL) {
      session.processingQueue = (session.processingQueue ?? Promise.resolve())
        .then(() => this._analysePcm(apiKey, session, pcm))
        .catch((err) => { this.emit('error', { apiKey, error: err }); });
    } else {
      this._analysePcm(apiKey, session, pcm).catch((err) => {
        this.emit('error', { apiKey, error: err });
      });
    }
  }

  /**
   * Shared classify → confirm-segments state machine → BPM detection →
   * metacode emission pipeline, used by both the HLS (_processSegment) and
   * RTMP (_processRtmpWindow) audio sources.
   *
   * When MUSIC_CLASSIFIER_URL is set, delegates to the external classifier
   * hook and falls back to the local heuristic on error/timeout. That path
   * is the only one that actually awaits anything — the default (no env
   * var) path below stays fully synchronous so existing callers/tests that
   * assert state immediately after triggering analysis are unaffected.
   *
   * @param {string} apiKey
   * @param {MusicSession} session
   * @param {Float32Array} pcm
   */
  async _analysePcm(apiKey, session, pcm) {
    const { config } = session;

    if (session.calibrating) {
      this._accumulateCalibration(apiKey, session, pcm);
      return;
    }

    const effectiveSilenceThreshold = session.calibratedSilenceThreshold ?? config.silenceThreshold;
    const classifyOpts = {
      sampleRate: SAMPLE_RATE,
      silenceThreshold: effectiveSilenceThreshold,
      flatnessThreshold: config.flatnessThreshold,
      zcrThreshold: config.zcrThreshold,
    };

    let rawLabel, confidence;
    if (process.env.MUSIC_CLASSIFIER_URL) {
      try {
        ({ label: rawLabel, confidence } = await classifyExternal(pcm, { sampleRate: SAMPLE_RATE }));
      } catch {
        ({ label: rawLabel, confidence } = classify(pcm, classifyOpts));
      }
    } else {
      ({ label: rawLabel, confidence } = classify(pcm, classifyOpts));
    }

    // Confirm-segments state machine: require N consecutive identical raw
    // labels before treating it as a real transition (smooths flicker).
    if (rawLabel === session.pendingLabel) {
      session.pendingCount++;
    } else {
      session.pendingLabel = rawLabel;
      session.pendingCount = 1;
    }
    if (session.pendingCount >= Math.max(1, config.confirmSegments)) {
      session.confirmedLabel = rawLabel;
    }

    const ts = Date.now();
    const parts = [];

    const labelChanged = session.confirmedLabel !== null
      && session.confirmedLabel !== session.lastEmittedLabel;
    if (labelChanged) {
      session.lastEmittedLabel = session.confirmedLabel;
      session.lastEmittedBpm = null; // re-baseline BPM delta-gating on label change
      const confStr = confidence != null ? `:${confidence.toFixed(2)}` : '';
      parts.push(`<!-- sound:${session.confirmedLabel}${confStr} -->`);
      this.emit('label_change', { apiKey, label: session.confirmedLabel, confidence, bpm: null, ts });
    }

    if (config.bpmEnabled && session.confirmedLabel === 'music') {
      const result = detectBpm(pcm, { sampleRate: SAMPLE_RATE, bpmMin: config.bpmMin, bpmMax: config.bpmMax });
      if (result) {
        const smoothedBpm = session.bpmSmoother.smooth(result.bpm);
        const bpmChanged = session.lastEmittedBpm == null
          || Math.abs(smoothedBpm - session.lastEmittedBpm) > BPM_CHANGE_THRESHOLD;
        if (bpmChanged) {
          session.lastEmittedBpm = smoothedBpm;
          parts.push(`<!-- bpm:${smoothedBpm} -->`);
          this.emit('bpm_update', { apiKey, bpm: smoothedBpm, confidence: result.confidence, ts });
        }
      }
    } else {
      session.bpmSmoother.reset();
    }

    if (parts.length > 0) {
      this._soundProcessor(apiKey, parts.join(' '));
    }
  }

  /**
   * Accumulate RMS energy samples during the calibration window. Once enough
   * audio has been observed, derive calibratedSilenceThreshold from the
   * observed min/max RMS range, end calibration, and emit 'calibrated'.
   * Classification is skipped entirely for windows spent calibrating.
   *
   * @param {string} apiKey
   * @param {MusicSession} session
   * @param {Float32Array} pcm
   */
  _accumulateCalibration(apiKey, session, pcm) {
    session.calibrationSamples.push(computeRms(pcm));
    session.calibrationSampleCount += pcm.length;

    if (session.calibrationSampleCount < SAMPLE_RATE * CALIBRATION_SECONDS) return;

    const sorted = [...session.calibrationSamples].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const raw = min + (max - min) * CALIBRATION_FACTOR;
    const threshold = Math.max(CALIBRATION_MIN_THRESHOLD, Math.min(CALIBRATION_MAX_THRESHOLD, raw));

    session.calibratedSilenceThreshold = threshold;
    session.calibrating = false;

    this.emit('calibrated', { apiKey, silenceThreshold: threshold, ts: Date.now() });
  }
}
