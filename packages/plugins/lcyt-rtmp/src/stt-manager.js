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
import { HlsSegmentFetcher } from './hls-segment-fetcher.js';
import { GoogleSttAdapter } from './stt-adapters/google-stt.js';
import { WhisperHttpAdapter } from './stt-adapters/whisper-http.js';
import { OpenAiAdapter } from './stt-adapters/openai.js';

const DEFAULT_MEDIAMTX_HLS_BASE = 'http://127.0.0.1:8888';

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
    provider    = 'google',
    language    = process.env.STT_DEFAULT_LANGUAGE || 'en-US',
    audioSource = process.env.STT_AUDIO_SOURCE    || 'hls',
    streamKey   = null,
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

    // Create fetcher
    if (audioSource !== 'hls') {
      throw new Error(`SttManager: audioSource "${audioSource}" not supported. Supported: hls`);
    }

    const hlsBase = process.env.MEDIAMTX_HLS_BASE_URL || DEFAULT_MEDIAMTX_HLS_BASE;
    const fetcher = new HlsSegmentFetcher({ hlsBase, streamKey: effectiveStreamKey });

    /** @type {SttSession} */
    const session = {
      provider,
      language,
      audioSource,
      streamKey: effectiveStreamKey,
      startedAt:      new Date(),
      segmentsSent:   0,
      lastTranscript: null,
      fetcher,
      adapter,
    };

    this._sessions.set(apiKey, session);

    // Wire events
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

    fetcher.on('error', ({ error }) => {
      this.emit('error', { apiKey, error });
    });

    fetcher.on('stopped', () => {
      // fetcher stopped — handled by the session cleanup in stop()
    });

    adapter.on('transcript', ({ text, confidence, timestamp }) => {
      const sess = this._sessions.get(apiKey);
      if (!sess) return;
      sess.lastTranscript = text;

      this.emit('transcript', { apiKey, text, confidence, timestamp, provider });
      this._deliverTranscript(apiKey, text, timestamp);
    });

    adapter.on('error', ({ error }) => {
      this.emit('error', { apiKey, error });
    });

    fetcher.start();
    console.log(`[stt] Started for key ${apiKey.slice(0, 8)}… provider=${provider} lang=${language} stream=${effectiveStreamKey}`);
  }

  /**
   * Stop STT for an API key.
   * @param {string} apiKey
   */
  async stop(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) return;

    this._sessions.delete(apiKey);

    try { session.fetcher.stop(); } catch {}
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
   * @returns {{ running: boolean, provider?: string, language?: string, startedAt?: Date, segmentsSent?: number, lastTranscript?: string|null }}
   */
  getStatus(apiKey) {
    const session = this._sessions.get(apiKey);
    if (!session) return { running: false };
    return {
      running:        true,
      provider:       session.provider,
      language:       session.language,
      audioSource:    session.audioSource,
      streamKey:      session.streamKey,
      startedAt:      session.startedAt,
      segmentsSent:   session.segmentsSent,
      lastTranscript: session.lastTranscript,
    };
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
