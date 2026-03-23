/**
 * GoogleSttAdapter — Phase 1 (REST mode)
 *
 * Posts fMP4 HLS segments to the Google Cloud Speech-to-Text v1 REST API and
 * emits 'transcript' events for each non-empty result.
 *
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS  Path to service account JSON (for OAuth2)
 *   GOOGLE_STT_KEY                  API key (REST fallback, simpler setup)
 *
 * Events:
 *   transcript  ({ text, confidence, timestamp })
 *   error       ({ error })
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { PcmSilenceBuffer, buildWav } from './pcm-buffer.js';

const GOOGLE_STT_REST_URL = 'https://speech.googleapis.com/v1/speech:recognize';

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
  }

  async start({ language } = {}) {
    if (language) this._language = language;

    // Load service account if configured
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && !this._serviceAccount) {
      try {
        this._serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));
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
  }

  /**
   * Send one fMP4 HLS segment to Google STT.
   *
   * @param {Buffer} buffer        Raw fMP4 segment bytes
   * @param {{ timestamp: Date, duration: number }} meta
   */
  async sendSegment(buffer, { timestamp, duration }) {
    if (!buffer || buffer.length === 0) return;

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
        this._sendWav(wav, timestamp, durationMs).catch(err => {
          this.emit('error', { error: err });
        });
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
    if (this._pcmBuf) {
      this._pcmBuf.flush();
      this._pcmBuf.reset();
      this._pcmBuf = null;
    }
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
