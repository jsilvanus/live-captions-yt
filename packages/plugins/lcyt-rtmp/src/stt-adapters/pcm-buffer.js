/**
 * pcm-buffer.js — shared utilities for the ffmpeg PCM fallback path (Phase 3)
 *
 * Provides:
 *   buildWav(pcm, sampleRate?)      — wrap raw s16le PCM in a WAV container
 *   PcmSilenceBuffer                — accumulate PCM, flush on silence or max duration
 *
 * Both are used by GoogleSttAdapter, WhisperHttpAdapter, and OpenAiAdapter for the
 * 'rtmp' and 'whep' audioSource paths where ffmpeg produces raw s16le 16 kHz mono output.
 */

import { EventEmitter } from 'node:events';

const SAMPLE_RATE      = 16_000;   // Hz — must match ffmpeg output
const BYTES_PER_SAMPLE = 2;        // s16le
const BYTES_PER_SEC    = SAMPLE_RATE * BYTES_PER_SAMPLE;  // 32 000

// ── WAV header builder ────────────────────────────────────────────────────────

/**
 * Wrap raw s16le PCM data in a 44-byte RIFF/WAV header.
 *
 * @param {Buffer} pcm         Raw s16le PCM bytes (16 kHz, 1 channel)
 * @param {number} [sampleRate=16000]
 * @returns {Buffer}           Complete WAV file buffer
 */
export function buildWav(pcm, sampleRate = SAMPLE_RATE) {
  const dataLen     = pcm.length;
  const channels    = 1;
  const bitsPerSample = 16;
  const byteRate    = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign  = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF',  0, 'ascii');
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE',  8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16,          16);  // PCM subchunk size
  header.writeUInt16LE(1,           20);  // PCM format = 1
  header.writeUInt16LE(channels,    22);
  header.writeUInt32LE(sampleRate,  24);
  header.writeUInt32LE(byteRate,    28);
  header.writeUInt16LE(blockAlign,  32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLen,     40);
  return Buffer.concat([header, pcm]);
}

// ── PcmSilenceBuffer ─────────────────────────────────────────────────────────

/**
 * Accumulates raw PCM (s16le, 16 kHz, mono) chunks written via `write(chunk)`
 * and emits a `flush` event when a natural segment boundary is detected:
 *
 *   • Silence gap: RMS energy stays below `silenceThreshold` for at least
 *     `silenceDurationMs` ms — and the buffer has reached `minDurationMs`.
 *   • Max duration:  buffer reaches `maxDurationMs` regardless of energy.
 *
 * @emits flush  ({ pcm: Buffer, timestamp: Date, durationMs: number })
 */
export class PcmSilenceBuffer extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.minDurationMs=2000]      Don't flush before this many ms of audio
   * @param {number} [opts.maxDurationMs=10000]     Always flush after this many ms
   * @param {number} [opts.silenceDurationMs=800]   Flush after this many ms of consecutive silence
   * @param {number} [opts.silenceThreshold=300]    RMS amplitude below which audio is silent (0–32767)
   * @param {number} [opts.checkIntervalMs=100]     How often to evaluate silence (ms)
   */
  constructor({
    minDurationMs     = 2_000,
    maxDurationMs     = 10_000,
    silenceDurationMs = 800,
    silenceThreshold  = 300,
    checkIntervalMs   = 100,
  } = {}) {
    super();
    this._minBytes      = Math.ceil((minDurationMs     / 1000) * BYTES_PER_SEC);
    this._maxBytes      = Math.ceil((maxDurationMs     / 1000) * BYTES_PER_SEC);
    this._silenceBytes  = Math.ceil((silenceDurationMs / 1000) * BYTES_PER_SEC);
    this._threshold     = silenceThreshold;
    this._checkInterval = checkIntervalMs;

    this._chunks     = [];
    this._totalBytes = 0;
    this._timestamp  = null;  // wall-clock time of the first sample in the window
    this._silenceConsecutiveBytes = 0;
    this._timer      = null;
  }

  /**
   * Accept a raw PCM chunk from ffmpeg stdout.
   * @param {Buffer} chunk
   */
  write(chunk) {
    if (!chunk || chunk.length === 0) return;
    if (!this._timestamp) this._timestamp = new Date();

    this._chunks.push(chunk);
    this._totalBytes += chunk.length;

    if (!this._timer) {
      this._timer = setInterval(() => this._check(), this._checkInterval);
    }

    // Force-flush when the hard cap is reached
    if (this._totalBytes >= this._maxBytes) {
      this._flush('max-duration');
    }
  }

  /** Flush immediately regardless of silence state. */
  flush() {
    this._flush('manual');
  }

  /** Discard buffered audio and stop the silence-check timer. */
  reset() {
    this._stopTimer();
    this._chunks     = [];
    this._totalBytes = 0;
    this._timestamp  = null;
    this._silenceConsecutiveBytes = 0;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _check() {
    if (this._totalBytes < this._minBytes) return;

    // Inspect the most recent check-interval window for silence
    const windowBytes = Math.ceil((this._checkInterval / 1000) * BYTES_PER_SEC);
    const tail        = this._tailBytes(windowBytes);
    const rms         = _computeRms(tail);

    if (rms < this._threshold) {
      this._silenceConsecutiveBytes += windowBytes;
      if (this._silenceConsecutiveBytes >= this._silenceBytes) {
        this._flush('silence');
      }
    } else {
      this._silenceConsecutiveBytes = 0;
    }
  }

  /**
   * Return up to `n` bytes from the end of the accumulated buffer without
   * copying the entire buffer.
   */
  _tailBytes(n) {
    const available = Math.min(n, this._totalBytes);
    const out       = Buffer.alloc(available);
    let remaining   = available;
    let pos         = available;
    for (let i = this._chunks.length - 1; i >= 0 && remaining > 0; i--) {
      const chunk = this._chunks[i];
      const take  = Math.min(remaining, chunk.length);
      chunk.copy(out, pos - take, chunk.length - take);
      pos       -= take;
      remaining -= take;
    }
    return out;
  }

  _flush(reason) {
    this._stopTimer();
    this._silenceConsecutiveBytes = 0;

    if (this._totalBytes === 0) return;

    const pcm        = Buffer.concat(this._chunks);
    const durationMs = Math.round((pcm.length / BYTES_PER_SEC) * 1000);
    const ts         = this._timestamp ?? new Date();

    this._chunks     = [];
    this._totalBytes = 0;
    this._timestamp  = null;

    this.emit('flush', { pcm, timestamp: ts, durationMs });
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the RMS amplitude of a s16le PCM buffer.
 * Returns 0 for empty or malformed input.
 */
function _computeRms(buf) {
  if (!buf || buf.length < 2) return 0;
  const samples = Math.floor(buf.length / 2);
  let sum = 0;
  for (let i = 0; i < samples * 2; i += 2) {
    const s = buf.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}
