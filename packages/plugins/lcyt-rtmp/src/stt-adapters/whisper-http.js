/**
 * WhisperHttpAdapter — Phase 2
 *
 * Posts fMP4 HLS segments to a running whisper.cpp HTTP server
 * (https://github.com/ggerganov/whisper.cpp/tree/master/examples/server).
 *
 * Environment variables:
 *   WHISPER_HTTP_URL    whisper.cpp server base URL (required)
 *   WHISPER_HTTP_MODEL  model name to request (optional, server default used if absent)
 *
 * Events:
 *   transcript  ({ text, confidence, timestamp })
 *   error       ({ error })
 */

import { EventEmitter } from 'node:events';
import { PcmSilenceBuffer, buildWav } from './pcm-buffer.js';

export class WhisperHttpAdapter extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.language='en']   Language code (BCP-47 or ISO 639-1 short form)
   * @param {string} [opts.serverUrl]       Override for WHISPER_HTTP_URL
   * @param {string} [opts.model]           Override for WHISPER_HTTP_MODEL
   */
  constructor({ language = 'en', serverUrl, model } = {}) {
    super();
    this._language  = language;
    this._serverUrl = (serverUrl ?? process.env.WHISPER_HTTP_URL ?? '').replace(/\/$/, '');
    this._model     = model ?? process.env.WHISPER_HTTP_MODEL ?? null;
  }

  async start({ language } = {}) {
    if (language) this._language = language;

    if (!this._serverUrl) {
      throw new Error(
        'WhisperHttpAdapter: WHISPER_HTTP_URL is not set. ' +
        'Set it to the base URL of your whisper.cpp HTTP server (e.g. http://localhost:8080).'
      );
    }
  }

  /**
   * Send one fMP4 HLS segment to the whisper.cpp /inference endpoint.
   *
   * @param {Buffer} buffer        Raw fMP4 segment bytes
   * @param {{ timestamp: Date, duration: number }} meta
   */
  async sendSegment(buffer, { timestamp, duration }) {
    if (!buffer || buffer.length === 0) return;

    // Build multipart/form-data body.
    // whisper.cpp /inference accepts audio files in any format it can decode
    // (MP4/AAC, WAV, MP3, etc.) as the `file` field.
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'audio/mp4' });
    formData.append('file', blob, 'segment.mp4');

    // Short ISO 639-1 code — whisper.cpp expects short codes like "en", "fi", "sv"
    const lang = this._language.split('-')[0];
    formData.append('language', lang);

    if (this._model) {
      formData.append('model', this._model);
    }

    let resp;
    try {
      resp = await fetch(`${this._serverUrl}/inference`, {
        method: 'POST',
        body:   formData,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.emit('error', { error: new Error(`WhisperHttpAdapter: request failed: ${err.message}`) });
      return;
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      this.emit('error', { error: new Error(`WhisperHttpAdapter: server error ${resp.status}: ${errBody}`) });
      return;
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      this.emit('error', { error: new Error(`WhisperHttpAdapter: invalid JSON response: ${err.message}`) });
      return;
    }

    // whisper.cpp /inference response:
    // { text: "...", segments: [...], language: "..." }
    // The top-level `text` field contains the full transcription.
    const text = (data.text ?? '').trim();
    if (!text) return;

    this.emit('transcript', {
      text,
      confidence: null, // whisper.cpp REST does not provide per-segment confidence
      timestamp,
    });
  }

  /**
   * ffmpeg fallback path (RTMP / WHEP audioSource).
   * Accepts raw s16le 16 kHz mono PCM chunks, buffers them with silence
   * detection, then posts the flushed window as a WAV file.
   *
   * @param {Buffer} pcmChunk
   */
  write(pcmChunk) {
    if (!this._pcmBuf) {
      this._pcmBuf = new PcmSilenceBuffer();
      this._pcmBuf.on('flush', ({ pcm, timestamp }) => {
        const wav = buildWav(pcm);
        this._sendWav(wav, timestamp).catch(err => {
          this.emit('error', { error: err });
        });
      });
    }
    this._pcmBuf.write(pcmChunk);
  }

  async _sendWav(wav, timestamp) {
    const formData = new FormData();
    const blob = new Blob([wav], { type: 'audio/wav' });
    formData.append('file', blob, 'segment.wav');

    const lang = this._language.split('-')[0];
    formData.append('language', lang);
    if (this._model) formData.append('model', this._model);

    let resp;
    try {
      resp = await fetch(`${this._serverUrl}/inference`, {
        method: 'POST',
        body:   formData,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new Error(`WhisperHttpAdapter (PCM): request failed: ${err.message}`);
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`WhisperHttpAdapter (PCM): server error ${resp.status}: ${errBody}`);
    }

    let data;
    try { data = await resp.json(); } catch (err) {
      throw new Error(`WhisperHttpAdapter (PCM): invalid JSON: ${err.message}`);
    }

    const text = (data.text ?? '').trim();
    if (text) this.emit('transcript', { text, confidence: null, timestamp });
  }

  /** Flush buffered PCM and release resources. */
  async stop() {
    if (this._pcmBuf) {
      this._pcmBuf.flush();
      this._pcmBuf.reset();
      this._pcmBuf = null;
    }
  }
}
