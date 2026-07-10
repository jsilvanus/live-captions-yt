/**
 * SttManager
 *
 * Manages one STT session per API key. Wires HlsSegmentFetcher → SttAdapter
 * → transcript → session._sendQueue so transcripts are delivered like any other
 * caption source.
 *
 * Events:
 *   transcript  ({ apiKey, text, confidence, timestamp, provider })
 *   error       ({ apiKey, error })
 *   stopped     ({ apiKey })
 *
 * @module stt-manager
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { HlsSegmentFetcher } from './hls-segment-fetcher.js';
import { GoogleSttAdapter } from './stt-adapters/google-stt.js';
import { WhisperHttpAdapter } from './stt-adapters/whisper-http.js';
import { OpenAiAdapter } from './stt-adapters/openai.js';
import { translateText, isSameLanguage } from './translate-server.js';
import { getSttConfig } from './db.js';
import logger from 'lcyt/logger';

const DEFAULT_MEDIAMTX_HLS_BASE = 'http://127.0.0.1:8888';

// ── ffmpeg version probe ────────────────────────────────────────────────────

/**
 * Probe the installed ffmpeg version.
 * @returns {Promise<{ major: number, minor: number }|null>}
 */
export async function probeFfmpegVersion() {
  return new Promise(resolve => {
    let output = '';
    let proc;
    try {
      proc = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    proc.stdout?.on('data', d => { output += d.toString(); });
    proc.stderr?.on('data', d => { output += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = output.match(/ffmpeg version (\d+)\.(\d+)/);
      resolve(m ? { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) } : null);
    });
  });
}

/**
 * @typedef {object} SttSession
 * @property {string}              provider
 * @property {string}              language
 * @property {string}              audioSource
 * @property {string}              streamKey
 * @property {Date}                startedAt
 * @property {number}              segmentsSent
 * @property {string|null}         lastTranscript
 * @property {HlsSegmentFetcher}   fetcher
 * @property {import('./stt-adapters/google-stt.js').GoogleSttAdapter} adapter
 */

export class SttManager extends EventEmitter {
  /**
   * @param {import('../../../lcyt-backend/src/store.js').SessionStore} store
   *   The backend session store — used to inject transcripts into session._sendQueue.
   * @param {import('better-sqlite3').Database} [db]
   *   Optional: required for server-side translation in Phase 5.
   */
  constructor(store, db = null) {
    super();
    this._store = store;
    this._db = db;
    this._getTranslationVendorConfig = null;
    this._getTranslationTargets = null;
    this._broadcastToViewers = null;
    this._writeBackendCaptionFiles = null;
    /** @type {Map<string, SttSession>} */
    this._sessions = new Map();
    /** @type {{ major: number, minor: number }|null} */
    this.ffmpegVersion = null;

    // Probe ffmpeg asynchronously; errors are non-fatal
    probeFfmpegVersion().then(v => {
      this.ffmpegVersion = v;
      if (!v) {
        logger.warn('[stt] ffmpeg not found — RTMP/WHEP audioSource will be unavailable');
      } else if (v.major < 6 || (v.major === 6 && v.minor < 1)) {
        logger.warn(`[stt] ffmpeg ${v.major}.${v.minor} detected — WHEP audioSource requires ffmpeg ≥ 6.1`);
      } else {
        logger.info(`[stt] ffmpeg ${v.major}.${v.minor} detected — RTMP and WHEP audioSources available`);
      }
    }).catch(() => {});
  }

  /**
   * Inject cross-package helpers needed for transcript delivery (Phase 5
   * server-side translation + viewer-target broadcast). Called once from
   * lcyt-backend's server.js after `initRtmpControl()` returns — this plugin
   * must not reach into the consuming app's private `src/` tree directly
   * (that was a real bug: a previous version of `_deliverTranscript` used
   * `await import('../../lcyt-backend/src/...')`, a relative path that
   * doesn't even resolve from this file's location, silently swallowed by
   * a `.catch(() => ({}))`, so translation and viewer-target delivery never
   * actually ran). Setter-injection matches this codebase's existing
   * convention, e.g. `cueEngine.setEmbeddingFn()` in `lcyt-agent`.
   *
   * @param {{ getTranslationVendorConfig?: Function, getTranslationTargets?: Function, broadcastToViewers?: Function, writeBackendCaptionFiles?: Function }} [helpers]
   *   `writeBackendCaptionFiles(session, { text, translations, fileFormats, timestamp })`
   *   archives the transcript + translations as backend caption files
   *   (lcyt-backend's createSessionCaptionFileWriter) — the same archiving
   *   POST /captions does, which this direct-delivery path bypasses.
   */
  setDeliveryHelpers({ getTranslationVendorConfig, getTranslationTargets, broadcastToViewers, writeBackendCaptionFiles } = {}) {
    this._getTranslationVendorConfig = getTranslationVendorConfig || null;
    this._getTranslationTargets = getTranslationTargets || null;
    this._broadcastToViewers = broadcastToViewers || null;
    this._writeBackendCaptionFiles = writeBackendCaptionFiles || null;
  }

  /**
   * Start STT for an API key.
   *
   * @param {string} apiKey
   * @param {object} opts
   * @param {string} [opts.provider='google']
   * @param {string} [opts.language='en-US']
   * @param {string} [opts.audioSource='hls']
   * @param {string} [opts.streamKey]  MediaMTX path; defaults to apiKey
   */
  async start(apiKey, {
    provider             = 'google',
    language             = process.env.STT_DEFAULT_LANGUAGE || 'en-US',
    audioSource          = process.env.STT_AUDIO_SOURCE    || 'hls',
    streamKey            = null,
    confidenceThreshold  = null,
  } = {}) {
    if (this._sessions.has(apiKey)) {
      await this.stop(apiKey);
    }

    const effectiveStreamKey = streamKey || apiKey;

    // Create adapter
    let adapter;
    if (provider === 'google') {
      adapter = new GoogleSttAdapter({ language });
    } else if (provider === 'whisper_http') {
      adapter = new WhisperHttpAdapter({ language });
    } else if (provider === 'openai') {
      adapter = new OpenAiAdapter({ language });
    } else {
      throw new Error(`SttManager: unsupported provider "${provider}". Supported: google, whisper_http, openai`);
    }

    await adapter.start({ language });

    /** @type {SttSession} */
    const session = {
      provider,
      language,
      audioSource,
      streamKey:           effectiveStreamKey,
      startedAt:           new Date(),
      segmentsSent:        0,
      lastTranscript:      null,
      confidenceThreshold: confidenceThreshold,
      fetcher:             null,
      ffmpegProc:          null,
      adapter,
    };

    this._sessions.set(apiKey, session);

    // ── Wire common adapter events ────────────────────────────────────────
    adapter.on('transcript', ({ text, confidence, timestamp }) => {
      const sess = this._sessions.get(apiKey);
      if (!sess) return;
      // Confidence threshold filtering — discard transcripts below the minimum
      const threshold = sess.confidenceThreshold;
      if (threshold !== null && threshold > 0 && confidence !== null && confidence < threshold) {
        logger.info(`[stt] Discarded low-confidence transcript (${confidence?.toFixed(2)} < ${threshold}) for key ${apiKey.slice(0, 8)}…`);
        return;
      }
      sess.lastTranscript = text;
      const mode = adapter.mode ?? null;
      this.emit('transcript', { apiKey, text, confidence, timestamp, provider, mode });
      this._deliverTranscript(apiKey, text, timestamp, this._db);
    });

    adapter.on('error', ({ error }) => {
      this.emit('error', { apiKey, error });
    });

    // ── Audio source ──────────────────────────────────────────────────────
    if (audioSource === 'hls') {
      const hlsBase = process.env.MEDIAMTX_HLS_BASE_URL || DEFAULT_MEDIAMTX_HLS_BASE;
      const fetcher = new HlsSegmentFetcher({ hlsBase, streamKey: effectiveStreamKey });
      session.fetcher = fetcher;

      fetcher.on('segment', async ({ buffer, timestamp, duration }) => {
        const sess = this._sessions.get(apiKey);
        if (!sess) return;
        sess.segmentsSent++;
        try {
          await adapter.sendSegment(buffer, { timestamp, duration });
        } catch (err) {
          this.emit('error', { apiKey, error: err });
        }
      });

      fetcher.on('error', ({ error }) => { this.emit('error', { apiKey, error }); });

      fetcher.start();

    } else if (audioSource === 'rtmp' || audioSource === 'whep') {
      const inputUrl = this._buildFfmpegInputUrl(audioSource, effectiveStreamKey);
      const ffmpegArgs = [
        '-i', inputUrl,
        '-vn',               // drop video
        '-ac', '1',          // mono
        '-ar', '16000',      // 16 kHz
        '-f', 's16le',       // raw PCM s16le
        'pipe:1',
      ];

      let proc;
      try {
        proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        this._sessions.delete(apiKey);
        throw new Error(`SttManager: failed to spawn ffmpeg for ${audioSource}: ${err.message}`);
      }

      session.ffmpegProc = proc;

      proc.stdout.on('data', chunk => {
        if (!this._sessions.has(apiKey)) return;
        session.segmentsSent++;
        adapter.write(chunk);
      });

      proc.stderr.on('data', () => {}); // suppress ffmpeg's verbose output

      proc.on('error', err => {
        this.emit('error', { apiKey, error: new Error(`ffmpeg error: ${err.message}`) });
      });

      proc.on('close', code => {
        if (this._sessions.has(apiKey)) {
          // Unexpected exit — clean up and report
          if (code !== 0) {
            this.emit('error', { apiKey, error: new Error(`ffmpeg exited with code ${code}`) });
          }
          this.stop(apiKey);
        }
      });

    } else {
      this._sessions.delete(apiKey);
      throw new Error(`SttManager: unsupported audioSource "${audioSource}". Supported: hls, rtmp, whep`);
    }

    logger.info(`[stt] Started for key ${apiKey.slice(0, 8)}… provider=${provider} lang=${language} source=${audioSource} stream=${effectiveStreamKey}`);
  }

  /**
   * Stop STT for an API key.
   * @param {string} apiKey
   */
  async stop(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) return;

    this._sessions.delete(apiKey);

    if (session.fetcher)    try { session.fetcher.stop(); }       catch {}
    if (session.ffmpegProc) try { session.ffmpegProc.kill('SIGTERM'); } catch {}
    try { await session.adapter.stop(); } catch {}

    this.emit('stopped', { apiKey });
    logger.info(`[stt] Stopped for key ${apiKey.slice(0, 8)}…`);
  }

  /**
   * Stop all running STT sessions.
   */
  async stopAll() {
    const keys = [...this._sessions.keys()];
    await Promise.all(keys.map(k => this.stop(k)));
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
   * @returns {{ running: boolean, provider?: string, language?: string, audioSource?: string, startedAt?: Date, segmentsSent?: number, lastTranscript?: string|null, ffmpegVersion?: object|null, whepAvailable?: boolean }}
   */
  getStatus(apiKey) {
    const session = this._sessions.get(apiKey);
    const ffv = this.ffmpegVersion;
    const whepAvailable = !!(ffv && (ffv.major > 6 || (ffv.major === 6 && ffv.minor >= 1)));

    if (!session) {
      return { running: false, ffmpegVersion: ffv ?? null, whepAvailable };
    }
    return {
      running:             true,
      provider:            session.provider,
      language:            session.language,
      audioSource:         session.audioSource,
      streamKey:           session.streamKey,
      startedAt:           session.startedAt,
      segmentsSent:        session.segmentsSent,
      lastTranscript:      session.lastTranscript,
      confidenceThreshold: session.confidenceThreshold ?? null,
      mode:                session.adapter?.mode ?? null,
      ffmpegVersion:       ffv ?? null,
      whepAvailable,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Build the ffmpeg input URL for RTMP or WHEP audio sources.
   * @param {'rtmp'|'whep'} audioSource
   * @param {string} streamKey
   */
  _buildFfmpegInputUrl(audioSource, streamKey) {
    if (audioSource === 'rtmp') {
      const rtmpBase = (process.env.HLS_LOCAL_RTMP || 'rtmp://127.0.0.1:1935').replace(/\/$/, '');
      const rtmpApp  = process.env.HLS_RTMP_APP || 'live';
      return `${rtmpBase}/${rtmpApp}/${streamKey}`;
    }
    // whep
    const mediamtxBase = (process.env.MEDIAMTX_HLS_BASE_URL || DEFAULT_MEDIAMTX_HLS_BASE).replace(/\/$/, '');
    return `${mediamtxBase}/${streamKey}/whep`;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Inject a transcript into the matching session's _sendQueue so it is
   * delivered to YouTube / viewer / generic targets like any other caption.
   *
   * The store does not expose a getByApiKey() method; we iterate all sessions.
   *
   * @param {string} apiKey
   * @param {string} text
   * @param {Date}   timestamp
   * @param {import('better-sqlite3').Database} [db]  Optional: required for server-side translation
   */
  _deliverTranscript(apiKey, text, timestamp, db = null) {
    if (!this._store) return;
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    // Find the active backend session for this API key
    let backendSession = null;
    for (const s of this._store.values()) {
      if (s.apiKey === apiKey) {
        backendSession = s;
        break;
      }
    }

    if (!backendSession) {
      // No live session — transcript is dropped (no target to deliver to)
      return;
    }

    // Serialise via _sendQueue so sequence numbers stay monotonic
    backendSession._sendQueue = backendSession._sendQueue.then(async () => {
      try {
        const seq = (backendSession.sequence ?? 0) + 1;
        backendSession.sequence = seq;

        const ts = timestamp instanceof Date ? timestamp : new Date();

        // Server-side translation (Phase 5)
        let translations = {};
        let captionLang = null;
        const fileFormats = {};
        if (db && this._getTranslationVendorConfig && this._getTranslationTargets) {
          try {
            const vendorConfig = this._getTranslationVendorConfig(db, apiKey);
            const translationTargets = this._getTranslationTargets(db, apiKey).filter(t => t.enabled);

            // Get current STT source language
            const sttCfg = getSttConfig(db, apiKey);
            const sourceLang = sttCfg?.language || 'en-US';

            // Translate to all enabled target languages
            await Promise.allSettled(
              translationTargets
                .filter(t => t.target === 'captions' || t.target === 'backend-file')
                .map(async t => {
                  if (isSameLanguage(sourceLang, t.lang)) {
                    translations[t.lang] = trimmed;
                  } else {
                    const translated = await translateText(trimmed, sourceLang, t.lang, vendorConfig).catch(() => trimmed);
                    translations[t.lang] = translated;
                  }
                  if (t.target === 'captions') {
                    captionLang = t.lang;
                  }
                  if (t.target === 'backend-file' && t.format) {
                    fileFormats[t.lang] = t.format;
                  }
                })
            );
          } catch (err) {
            logger.debug(`[stt] Translation skipped: ${err.message}`);
          }
        }

        // Archive transcript + translations as backend caption files (same
        // archiving POST /captions does; this delivery path bypasses it).
        // Fire-and-forget; the writer itself checks backend_file_enabled.
        if (this._writeBackendCaptionFiles) {
          try {
            this._writeBackendCaptionFiles(backendSession, {
              text: trimmed,
              translations,
              fileFormats,
              timestamp: ts.toISOString().replace('Z', ''),
            });
          } catch (err) {
            logger.debug(`[stt] Backend caption-file write skipped: ${err.message}`);
          }
        }

        // Fan-out to all extra targets (YouTube, viewer, generic)
        if (backendSession.extraTargets && backendSession.extraTargets.length > 0) {
          const broadcastToViewers = this._broadcastToViewers;

          for (const target of backendSession.extraTargets) {
            if (target.type === 'youtube' && target.sender) {
              target.sender.send(trimmed, ts).catch(err => {
                logger.warn(`[stt] YouTube target ${target.id} error: ${err.message}`);
              });
            } else if (target.type === 'viewer' && target.viewerKey && broadcastToViewers) {
              broadcastToViewers(target.viewerKey, {
                text:          trimmed,
                composedText:  trimmed,
                sequence:      seq,
                timestamp:     ts.toISOString(),
                ...(Object.keys(translations).length > 0 && { translations }),
              });
            } else if (target.type === 'generic' && target.url) {
              fetch(target.url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...(target.headers || {}) },
                body:    JSON.stringify({
                  source:   backendSession.domain,
                  sequence: seq,
                  captions: [{
                    text: trimmed,
                    composedText: trimmed,
                    timestamp: ts.toISOString(),
                    ...(captionLang && { captionLang }),
                    ...(Object.keys(translations).length > 0 && { translations }),
                  }],
                }),
              }).catch(err => {
                logger.warn(`[stt] Generic target ${target.id} error: ${err.message}`);
              });
            }
          }
        }

        // Legacy primary sender
        if (backendSession.sender) {
          backendSession.sender.send(trimmed, ts).catch(err => {
            logger.warn(`[stt] Primary sender error: ${err.message}`);
          });
          backendSession.sequence = backendSession.sender.sequence;
        }
      } catch (err) {
        logger.error(`[stt] _deliverTranscript error for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
    });
  }
}