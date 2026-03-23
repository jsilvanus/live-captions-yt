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
   */
  constructor(store) {
    super();
    this._store = store;
    /** @type {Map<string, SttSession>} */
    this._sessions = new Map();
    /** @type {{ major: number, minor: number }|null} */
    this.ffmpegVersion = null;

    // Probe ffmpeg asynchronously; errors are non-fatal
    probeFfmpegVersion().then(v => {
      this.ffmpegVersion = v;
      if (!v) {
        console.warn('[stt] ffmpeg not found — RTMP/WHEP audioSource will be unavailable');
      } else if (v.major < 6 || (v.major === 6 && v.minor < 1)) {
        console.warn(`[stt] ffmpeg ${v.major}.${v.minor} detected — WHEP audioSource requires ffmpeg ≥ 6.1`);
      } else {
        console.log(`[stt] ffmpeg ${v.major}.${v.minor} detected — RTMP and WHEP audioSources available`);
      }
    }).catch(() => {});
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
        console.log(`[stt] Discarded low-confidence transcript (${confidence?.toFixed(2)} < ${threshold}) for key ${apiKey.slice(0, 8)}…`);
        return;
      }
      sess.lastTranscript = text;
      const mode = adapter.mode ?? null;
      this.emit('transcript', { apiKey, text, confidence, timestamp, provider, mode });
      this._deliverTranscript(apiKey, text, timestamp);
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

    console.log(`[stt] Started for key ${apiKey.slice(0, 8)}… provider=${provider} lang=${language} source=${audioSource} stream=${effectiveStreamKey}`);
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
    console.log(`[stt] Stopped for key ${apiKey.slice(0, 8)}…`);
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
   */
  _deliverTranscript(apiKey, text, timestamp) {
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

        // Fan-out to all extra targets (YouTube, viewer, generic)
        if (backendSession.extraTargets && backendSession.extraTargets.length > 0) {
          const { broadcastToViewers } = await import('../../lcyt-backend/src/routes/viewer.js').catch(() => ({ broadcastToViewers: null }));

          for (const target of backendSession.extraTargets) {
            if (target.type === 'youtube' && target.sender) {
              target.sender.send(trimmed, ts).catch(err => {
                console.warn(`[stt] YouTube target ${target.id} error: ${err.message}`);
              });
            } else if (target.type === 'viewer' && target.viewerKey && broadcastToViewers) {
              broadcastToViewers(target.viewerKey, {
                text:          trimmed,
                composedText:  trimmed,
                sequence:      seq,
                timestamp:     ts.toISOString(),
              });
            } else if (target.type === 'generic' && target.url) {
              fetch(target.url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...(target.headers || {}) },
                body:    JSON.stringify({
                  source:   backendSession.domain,
                  sequence: seq,
                  captions: [{ text: trimmed, composedText: trimmed, timestamp: ts.toISOString() }],
                }),
              }).catch(err => {
                console.warn(`[stt] Generic target ${target.id} error: ${err.message}`);
              });
            }
          }
        }

        // Legacy primary sender
        if (backendSession.sender) {
          backendSession.sender.send(trimmed, ts).catch(err => {
            console.warn(`[stt] Primary sender error: ${err.message}`);
          });
          backendSession.sequence = backendSession.sender.sequence;
        }
      } catch (err) {
        console.error(`[stt] _deliverTranscript error for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
    });
  }
}
