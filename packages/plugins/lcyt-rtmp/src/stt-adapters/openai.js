/**
 * OpenAiAdapter — Phase 2
 *
 * Posts fMP4 HLS segments to any OpenAI-compatible /v1/audio/transcriptions
 * endpoint (OpenAI, Groq, LocalAI, etc.).
 *
 * Environment variables:
 *   OPENAI_STT_URL      Base URL for the OpenAI-compatible API
 *                       (e.g. https://api.openai.com or http://localhost:8080)
 *   OPENAI_STT_API_KEY  Bearer token / API key sent as Authorization header
 *   OPENAI_STT_MODEL    Model name to request (e.g. whisper-1, whisper-large-v3)
 *
 * Events:
 *   transcript  ({ text, confidence, timestamp })
 *   error       ({ error })
 */

import { EventEmitter } from 'node:events';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL    = 'whisper-1';

export class OpenAiAdapter extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.language='en']   BCP-47 language hint
   * @param {string} [opts.baseUrl]         Override for OPENAI_STT_URL
   * @param {string} [opts.apiKey]          Override for OPENAI_STT_API_KEY
   * @param {string} [opts.model]           Override for OPENAI_STT_MODEL
   */
  constructor({ language = 'en', baseUrl, apiKey, model } = {}) {
    super();
    this._language = language;
    this._baseUrl  = (baseUrl  ?? process.env.OPENAI_STT_URL     ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this._apiKey   = apiKey   ?? process.env.OPENAI_STT_API_KEY  ?? null;
    this._model    = model    ?? process.env.OPENAI_STT_MODEL    ?? DEFAULT_MODEL;
  }

  async start({ language } = {}) {
    if (language) this._language = language;

    if (!this._apiKey) {
      throw new Error(
        'OpenAiAdapter: OPENAI_STT_API_KEY is not set. ' +
        'Set it to the API key for your OpenAI-compatible endpoint.'
      );
    }
  }

  /**
   * Send one fMP4 HLS segment to the /v1/audio/transcriptions endpoint.
   *
   * @param {Buffer} buffer        Raw fMP4 segment bytes
   * @param {{ timestamp: Date, duration: number }} meta
   */
  async sendSegment(buffer, { timestamp, duration }) {
    if (!buffer || buffer.length === 0) return;

    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'audio/mp4' });
    formData.append('file', blob, 'segment.mp4');
    formData.append('model', this._model);

    // ISO 639-1 short code — OpenAI /v1/audio/transcriptions accepts short codes
    const lang = this._language.split('-')[0];
    formData.append('language', lang);

    // Request plain-text response to keep the parsing simple
    formData.append('response_format', 'json');

    const headers = {
      Authorization: `Bearer ${this._apiKey}`,
    };

    let resp;
    try {
      resp = await fetch(`${this._baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers,
        body:   formData,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.emit('error', { error: new Error(`OpenAiAdapter: request failed: ${err.message}`) });
      return;
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      this.emit('error', { error: new Error(`OpenAiAdapter: server error ${resp.status}: ${errBody}`) });
      return;
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      this.emit('error', { error: new Error(`OpenAiAdapter: invalid JSON response: ${err.message}`) });
      return;
    }

    // OpenAI /v1/audio/transcriptions JSON response: { text: "..." }
    const text = (data.text ?? '').trim();
    if (!text) return;

    this.emit('transcript', {
      text,
      confidence: null, // OpenAI transcriptions API does not expose per-result confidence
      timestamp,
    });
  }

  /** No-op: REST mode has no persistent connection. */
  async stop() {}
}
