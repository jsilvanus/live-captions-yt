/**
 * MusicManager
 *
 * Manages one server-side audio analysis session per API key: polls HLS
 * segments (MediaMTX fMP4 output) via HlsSegmentFetcher, decodes each
 * segment to PCM via ffmpeg, classifies it as music/speech/silence, and
 * estimates BPM when music is detected.
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
import { HlsSegmentFetcher } from './hls-segment-fetcher.js';
import { extractPcm, probeFfmpegVersion } from './pcm-extractor.js';
import { classify } from './analyser/spectral-detector.js';
import { detectBpm, createBpmSmoother } from './analyser/bpm-detector.js';
import { getMusicConfig } from './db.js';

const DEFAULT_MEDIAMTX_HLS_BASE = 'http://127.0.0.1:8888';
const SAMPLE_RATE = 22050;
const BPM_CHANGE_THRESHOLD = 2;

/**
 * @typedef {object} MusicSession
 * @property {string} streamKey
 * @property {Date} startedAt
 * @property {number} segmentsProcessed
 * @property {HlsSegmentFetcher} fetcher
 * @property {string|null} pendingLabel
 * @property {number} pendingCount
 * @property {string|null} confirmedLabel
 * @property {string|null} lastEmittedLabel
 * @property {number|null} lastEmittedBpm
 * @property {ReturnType<typeof createBpmSmoother>} bpmSmoother
 * @property {object} config
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
   * @param {string} [opts.streamKey]  MediaMTX path; defaults to apiKey
   */
  async start(apiKey, { streamKey = null } = {}) {
    if (this._sessions.has(apiKey)) {
      await this.stop(apiKey);
    }

    const effectiveStreamKey = streamKey || apiKey;
    const config = getMusicConfig(this._db, apiKey);

    const hlsBase = process.env.MEDIAMTX_HLS_BASE_URL || DEFAULT_MEDIAMTX_HLS_BASE;
    const fetcher = new HlsSegmentFetcher({ hlsBase, streamKey: effectiveStreamKey });

    /** @type {MusicSession} */
    const session = {
      streamKey: effectiveStreamKey,
      startedAt: new Date(),
      segmentsProcessed: 0,
      fetcher,
      pendingLabel: null,
      pendingCount: 0,
      confirmedLabel: null,
      lastEmittedLabel: null,
      lastEmittedBpm: null,
      bpmSmoother: createBpmSmoother(),
      config,
    };

    this._sessions.set(apiKey, session);

    fetcher.on('segment', ({ buffer }) => {
      this._processSegment(apiKey, buffer).catch((err) => {
        this.emit('error', { apiKey, error: err });
      });
    });

    fetcher.on('error', ({ error }) => {
      this.emit('error', { apiKey, error });
    });

    fetcher.start();
  }

  /**
   * Stop analysis for an API key.
   * @param {string} apiKey
   */
  async stop(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) return;

    this._sessions.delete(apiKey);
    try { session.fetcher.stop(); } catch { /* ignore */ }

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
   * @returns {{ running: boolean, streamKey?: string, startedAt?: Date, segmentsProcessed?: number, label?: string|null, bpm?: number|null, ffmpegVersion?: object|null }}
   */
  getStatus(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) {
      return { running: false, ffmpegVersion: this.ffmpegVersion ?? null };
    }
    return {
      running: true,
      streamKey: session.streamKey,
      startedAt: session.startedAt,
      segmentsProcessed: session.segmentsProcessed,
      label: session.lastEmittedLabel,
      bpm: session.lastEmittedBpm,
      ffmpegVersion: this.ffmpegVersion ?? null,
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
    const { config } = session;

    const pcm = await extractPcm(segmentBuffer, { sampleRate: SAMPLE_RATE });
    if (pcm.length === 0) return;

    const { label: rawLabel, confidence } = classify(pcm, {
      sampleRate: SAMPLE_RATE,
      silenceThreshold: config.silenceThreshold,
      flatnessThreshold: config.flatnessThreshold,
      zcrThreshold: config.zcrThreshold,
    });

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
}
