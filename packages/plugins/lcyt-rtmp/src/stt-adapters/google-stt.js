/**
 * GoogleSttAdapter — Phase 1 (REST) + Phase 4 (gRPC streaming)
 *
 * Posts fMP4 HLS segments to the Google Cloud Speech-to-Text v1 REST API and
 * emits 'transcript' events for each non-empty result.
 *
 * Set GOOGLE_STT_MODE=grpc to use gRPC streaming (lower latency, requires
 * @google-cloud/speech to be installed).  Falls back to REST automatically
 * when the package is absent.
 *
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS  Path to service account JSON (for OAuth2)
 *   GOOGLE_STT_KEY                  API key (REST fallback, simpler setup)
 *   GOOGLE_STT_MODE                 'rest' (default) | 'grpc'
 *
 * Events:
 *   transcript  ({ text, confidence, timestamp })
 *   error       ({ error })
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { createSign } from 'node:crypto';
import { PcmSilenceBuffer, buildWav } from './pcm-buffer.js';

const GOOGLE_STT_REST_URL = 'https://speech.googleapis.com/v1/speech:recognize';

// gRPC streaming restarts after this many seconds (API hard limit is ~5 min)
const GRPC_RESTART_INTERVAL_MS = 4.5 * 60 * 1000;

// Minimum segment size in bytes — skip smaller buffers (silence / empty init)
const MIN_SEGMENT_BYTES = 1;

// ── Punctuation normalisation ─────────────────────────────────────────────────

/**
 * Ensure the text ends with sentence-ending punctuation.
 * Some providers (e.g. Whisper) omit trailing punctuation on finals.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalisePunctuation(text) {
  const s = text.trim();
  if (!s) return s;
  // Already ends with sentence-ending or ellipsis punctuation — leave it
  if (/[.!?,;:\u2026]$/.test(s)) return s;
  return `${s}.`;
}

/**
 * Minimal Google OAuth2 service-account token fetcher.
 * Uses only Node.js stdlib (crypto + fetch) — no google-auth-library required.
 *
 * @param {object} serviceAccount  Parsed service account JSON
 * @returns {Promise<string>} Access token
 */
async function fetchServiceAccountToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Google OAuth2 token fetch failed: HTTP ${resp.status} ${body}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// ── Try to load @google-cloud/speech for gRPC mode ────────────────────────────

let SpeechClient = null;
try {
  const mod = await import('@google-cloud/speech');
  SpeechClient = mod.SpeechClient ?? mod.default?.SpeechClient ?? null;
} catch {
  // Package not installed — gRPC mode unavailable, REST mode used always
}

export class GoogleSttAdapter extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.language='en-US']  BCP-47 language code
   */
  constructor({ language = 'en-US' } = {}) {
    super();
    this._language       = language;
    this._apiKey         = process.env.GOOGLE_STT_KEY || null;
    this._serviceAccount = null;
    this._token          = null;
    this._tokenExpiry    = 0; // unix seconds
    this._mode           = (process.env.GOOGLE_STT_MODE === 'grpc' && SpeechClient) ? 'grpc' : 'rest';

    // Track outstanding network promises so stop() can wait for them
    this._pending = new Set();

    // gRPC state
    this._grpcClient     = null;
    this._grpcStream     = null;
    this._grpcStartedAt  = 0;
    this._grpcRestartTimer = null;
  }


  _track(p) {
    this._pending.add(p);
    const cleanup = () => this._pending.delete(p);
    p.then(cleanup, cleanup);
    return p;
  }

  async _waitPending() {
    if (this._pending.size === 0) return;
    await Promise.allSettled(Array.from(this._pending));
  }

  /** The active recognition mode: 'rest' | 'grpc' */
  get mode() { return this._mode; }

  async start({ language } = {}) {
    if (language) this._language = language;

    // Load service account if configured
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && !this._serviceAccount) {
      try {
        this._serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      } catch (err) {
        throw new Error(`GoogleSttAdapter: failed to read service account at ${credPath}: ${err.message}`);
      }
    }

    if (!this._serviceAccount && !this._apiKey) {
      throw new Error(
        'GoogleSttAdapter: no credentials configured. ' +
        'Set GOOGLE_APPLICATION_CREDENTIALS (service account JSON path) or GOOGLE_STT_KEY (API key).'
      );
    }

    if (this._mode === 'grpc') {
      this._startGrpcStream();
    }
  }

  /**
   * Send one fMP4 HLS segment to Google STT.
   * Skips very small buffers (silence / empty fMP4 init segments).
   *
   * @param {Buffer} buffer        Raw fMP4 segment bytes
   * @param {{ timestamp: Date, duration: number }} meta
   */
  async sendSegment(buffer, { timestamp, duration }) {
    if (!buffer || buffer.length < MIN_SEGMENT_BYTES) return;

    if (this._mode === 'grpc') {
      this._sendSegmentGrpc(buffer, timestamp);
    } else {
      const p = this._sendSegmentRest(buffer, timestamp);
      await this._track(p);
    }
  }

  // ── gRPC streaming ──────────────────────────────────────────────────────────

  _startGrpcStream() {
    if (!SpeechClient) return;
    try {
      if (!this._grpcClient) {
        this._grpcClient = new SpeechClient(
          this._serviceAccount ? { credentials: this._serviceAccount } : {}
        );
      }
      const request = {
        config: {
          languageCode: this._language,
          enableAutomaticPunctuation: true,
          model: 'latest_long',
        },
        interimResults: false,
      };
      this._grpcStream = this._grpcClient.streamingRecognize(request);
      this._grpcStartedAt = Date.now();

      this._grpcStream.on('data', (response) => {
        for (const result of (response.results || [])) {
          if (!result.isFinal) continue;
          const alt = result.alternatives?.[0];
          if (!alt?.transcript?.trim()) continue;
          this.emit('transcript', {
            text:       alt.transcript.trim(),
            confidence: alt.confidence ?? null,
            timestamp:  new Date(),
          });
        }
      });

      this._grpcStream.on('error', (err) => {
        if (err.code === 11) {
          // OUT_OF_RANGE — stream too long, restart
          this._restartGrpcStream();
        } else {
          this.emit('error', { error: new Error(`GoogleSttAdapter gRPC: ${err.message}`) });
          this._restartGrpcStream();
        }
      });

      this._grpcStream.on('end', () => {
        // Unexpected end — restart if still running
        if (this._grpcStream) this._restartGrpcStream();
      });

      // Schedule proactive restart before the 5-minute API limit
      if (this._grpcRestartTimer) clearTimeout(this._grpcRestartTimer);
      this._grpcRestartTimer = setTimeout(() => {
        this._restartGrpcStream();
      }, GRPC_RESTART_INTERVAL_MS);

    } catch (err) {
      this.emit('error', { error: new Error(`GoogleSttAdapter gRPC init: ${err.message}`) });
    }
  }

  _restartGrpcStream() {
    if (this._grpcRestartTimer) {
      clearTimeout(this._grpcRestartTimer);
      this._grpcRestartTimer = null;
    }
    const old = this._grpcStream;
    this._grpcStream = null;
    if (old) {
      old.removeAllListeners();
      try { old.end(); } catch {}
    }
    // Brief delay before reconnecting
    setTimeout(() => { this._startGrpcStream(); }, 500);
  }

  _sendSegmentGrpc(buffer, timestamp) {
    if (!this._grpcStream || this._grpcStream.writableEnded) {
      this._restartGrpcStream();
      return;
    }
    try {
      this._grpcStream.write({ audioContent: buffer });
    } catch (err) {
      this.emit('error', { error: new Error(`GoogleSttAdapter gRPC write: ${err.message}`) });
    }
  }

  // ── REST mode ───────────────────────────────────────────────────────────────

  async _sendSegmentRest(buffer, timestamp) {
    let authHeader;
    if (this._serviceAccount) {
      const token = await this._getToken();
      authHeader = `Bearer ${token}`;
    } else {
      authHeader = null; // use ?key= param
    }

    const audioContent = buffer.toString('base64');

    // Google STT v1 REST request body.
    // encoding is omitted to let the API auto-detect the fMP4/AAC container.
    // sampleRateHertz is also omitted for the same reason.
    const body = {
      config: {
        languageCode:       this._language,
        enableAutomaticPunctuation: true,
        model:              'latest_long',
      },
      audio: {
        content: audioContent,
      },
    };

    const url = authHeader
      ? GOOGLE_STT_REST_URL
      : `${GOOGLE_STT_REST_URL}?key=${encodeURIComponent(this._apiKey)}`;

    let resp;
    try {
      resp = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.emit('error', { error: new Error(`GoogleSttAdapter: request failed: ${err.message}`) });
      return;
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      this.emit('error', { error: new Error(`GoogleSttAdapter: API error ${resp.status}: ${errBody}`) });
      return;
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      this.emit('error', { error: new Error(`GoogleSttAdapter: invalid JSON response: ${err.message}`) });
      return;
    }

    // Extract transcript from results
    const results = data.results || [];
    for (const result of results) {
      const alt = result.alternatives?.[0];
      if (!alt?.transcript?.trim()) continue;
      this.emit('transcript', {
        text:       alt.transcript.trim(),
        confidence: alt.confidence ?? null,
        timestamp,
      });
    }
  }

  /**
   * ffmpeg fallback path (RTMP / WHEP audioSource).
   * Called with raw s16le 16 kHz mono PCM chunks from ffmpeg stdout.
   * Accumulates audio in a PcmSilenceBuffer; flushes automatically on
   * silence gaps or when the max duration cap is reached.
   *
   * @param {Buffer} pcmChunk
   */
  write(pcmChunk) {
    if (!this._pcmBuf) {
      this._pcmBuf = new PcmSilenceBuffer();
      this._pcmBuf.on('flush', ({ pcm, timestamp, durationMs }) => {
        // Encode PCM as WAV then send to Google STT using LINEAR16 encoding
        const wav = buildWav(pcm);
        const p = this._sendWav(wav, timestamp, durationMs);
        this._track(p).catch(err => { this.emit('error', { error: err }); });
      });
    }
    this._pcmBuf.write(pcmChunk);
  }

  async _sendWav(wav, timestamp) {
    const audioContent = wav.toString('base64');
    const body = {
      config: {
        languageCode: this._language,
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        audioChannelCount: 1,
        enableAutomaticPunctuation: true,
        model: 'latest_long',
      },
      audio: { content: audioContent },
    };

    let authHeader;
    if (this._serviceAccount) {
      const token = await this._getToken();
      authHeader = `Bearer ${token}`;
    } else {
      authHeader = null;
    }

    const url = authHeader
      ? GOOGLE_STT_REST_URL
      : `${GOOGLE_STT_REST_URL}?key=${encodeURIComponent(this._apiKey)}`;

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(`GoogleSttAdapter (PCM): request failed: ${err.message}`);
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`GoogleSttAdapter (PCM): API error ${resp.status}: ${errBody}`);
    }

    let data;
    try { data = await resp.json(); } catch (err) {
      throw new Error(`GoogleSttAdapter (PCM): invalid JSON: ${err.message}`);
    }

    for (const result of (data.results || [])) {
      const alt = result.alternatives?.[0];
      if (!alt?.transcript?.trim()) continue;
      this.emit('transcript', {
        text:       alt.transcript.trim(),
        confidence: alt.confidence ?? null,
        timestamp,
      });
    }
  }

  /** Flush any buffered PCM and release resources. */
  async stop() {
    if (this._grpcRestartTimer) {
      clearTimeout(this._grpcRestartTimer);
      this._grpcRestartTimer = null;
    }
    if (this._grpcStream) {
      const s = this._grpcStream;
      this._grpcStream = null;
      s.removeAllListeners();
      try { s.end(); } catch {}
    }
    if (this._grpcClient) {
      try { await this._grpcClient.close(); } catch {}
      this._grpcClient = null;
    }
    if (this._pcmBuf) {
      this._pcmBuf.flush();
      this._pcmBuf.reset();
      this._pcmBuf = null;
    }
    // Wait for any outstanding network requests to settle
    await this._waitPending();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  async _getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this._token && this._tokenExpiry > now + 60) {
      return this._token;
    }
    this._token = await fetchServiceAccountToken(this._serviceAccount);
    this._tokenExpiry = now + 3600;
    return this._token;
  }
}
