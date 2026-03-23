/**
 * Tests for pcm-buffer.js — buildWav + PcmSilenceBuffer (Phase 3)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWav, PcmSilenceBuffer } from '../src/stt-adapters/pcm-buffer.js';

// ── buildWav ─────────────────────────────────────────────────────────────────

describe('buildWav', () => {
  test('returns a Buffer starting with RIFF', () => {
    const pcm = Buffer.alloc(3200); // 100ms @ 16kHz s16le
    const wav = buildWav(pcm);
    assert.ok(Buffer.isBuffer(wav));
    assert.strictEqual(wav.slice(0, 4).toString('ascii'), 'RIFF');
    assert.strictEqual(wav.slice(8, 12).toString('ascii'), 'WAVE');
    assert.strictEqual(wav.slice(12, 16).toString('ascii'), 'fmt ');
    assert.strictEqual(wav.slice(36, 40).toString('ascii'), 'data');
  });

  test('total length = 44 (header) + pcm.length', () => {
    const pcm = Buffer.alloc(6400);
    const wav = buildWav(pcm);
    assert.strictEqual(wav.length, 44 + 6400);
  });

  test('RIFF chunk size = 36 + pcm.length', () => {
    const pcm = Buffer.alloc(3200);
    const wav = buildWav(pcm);
    assert.strictEqual(wav.readUInt32LE(4), 36 + 3200);
  });

  test('PCM format = 1 (linear)', () => {
    const wav = buildWav(Buffer.alloc(32));
    assert.strictEqual(wav.readUInt16LE(20), 1);
  });

  test('channels = 1', () => {
    const wav = buildWav(Buffer.alloc(32));
    assert.strictEqual(wav.readUInt16LE(22), 1);
  });

  test('sample rate = 16000 by default', () => {
    const wav = buildWav(Buffer.alloc(32));
    assert.strictEqual(wav.readUInt32LE(24), 16000);
  });

  test('custom sample rate is written correctly', () => {
    const wav = buildWav(Buffer.alloc(32), 44100);
    assert.strictEqual(wav.readUInt32LE(24), 44100);
  });

  test('bits per sample = 16', () => {
    const wav = buildWav(Buffer.alloc(32));
    assert.strictEqual(wav.readUInt16LE(34), 16);
  });

  test('data subchunk size = pcm.length', () => {
    const pcm = Buffer.alloc(6400);
    const wav = buildWav(pcm);
    assert.strictEqual(wav.readUInt32LE(40), 6400);
  });

  test('PCM data is appended verbatim after the header', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const wav = buildWav(pcm);
    assert.deepStrictEqual([...wav.slice(44)], [1, 2, 3, 4]);
  });
});

// ── PcmSilenceBuffer ─────────────────────────────────────────────────────────

describe('PcmSilenceBuffer', () => {
  // Helper: build a PCM buffer of `durationMs` ms filled with a given amplitude
  function makePcm(durationMs, amplitude = 1000) {
    const samples = Math.ceil((durationMs / 1000) * 16000);
    const buf = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      buf.writeInt16LE(amplitude, i * 2);
    }
    return buf;
  }

  // Silent PCM = amplitude 0
  function makeSilence(durationMs) { return makePcm(durationMs, 0); }

  test('does not flush before minDurationMs', async () => {
    const buf = new PcmSilenceBuffer({ minDurationMs: 500, maxDurationMs: 5000, silenceDurationMs: 100, checkIntervalMs: 20 });
    let flushed = false;
    buf.on('flush', () => { flushed = true; });

    buf.write(makeSilence(200));
    await new Promise(r => setTimeout(r, 200));
    assert.ok(!flushed, 'should not flush before minDurationMs');
    buf.reset();
  });

  test('flush() forces immediate emit', () => {
    const buf = new PcmSilenceBuffer({ minDurationMs: 5000 });
    let received = null;
    buf.on('flush', data => { received = data; });

    const pcm = makePcm(100, 500);
    buf.write(pcm);
    buf.flush();

    assert.ok(received, 'flush() should emit flush event');
    assert.ok(Buffer.isBuffer(received.pcm));
    assert.ok(received.timestamp instanceof Date);
    assert.ok(received.durationMs > 0);
  });

  test('flush() emits nothing on empty buffer', () => {
    const buf = new PcmSilenceBuffer();
    let flushed = false;
    buf.on('flush', () => { flushed = true; });
    buf.flush();
    assert.ok(!flushed);
  });

  test('reset() discards buffered audio', () => {
    const buf = new PcmSilenceBuffer({ minDurationMs: 500 });
    let flushed = false;
    buf.on('flush', () => { flushed = true; });

    buf.write(makePcm(300, 500));
    buf.reset();
    buf.flush(); // flush after reset should emit nothing
    assert.ok(!flushed);
  });

  test('timestamp records wall-clock time of first write', () => {
    const buf = new PcmSilenceBuffer({ minDurationMs: 100 });
    let ts = null;
    buf.on('flush', data => { ts = data.timestamp; });

    const before = Date.now();
    buf.write(makePcm(50, 500));
    buf.flush();
    const after = Date.now();

    assert.ok(ts instanceof Date);
    assert.ok(ts.getTime() >= before && ts.getTime() <= after + 10);
  });

  test('flushes on maxDurationMs hard cap', () => {
    const maxMs = 500;
    const buf = new PcmSilenceBuffer({
      minDurationMs:  100,
      maxDurationMs:  maxMs,
      silenceDurationMs: 10_000, // silence threshold never reached
      checkIntervalMs: 50,
    });

    let flushed = false;
    buf.on('flush', () => { flushed = true; });

    // Write more than maxDurationMs worth of audio in one call
    buf.write(makePcm(maxMs + 100, 500));
    assert.ok(flushed, 'should force-flush when maxBytes reached');
  });

  test('concatenates all written chunks into the flushed PCM', () => {
    const buf = new PcmSilenceBuffer({ minDurationMs: 0 });
    let flushed = null;
    buf.on('flush', data => { flushed = data; });

    const a = Buffer.from([1, 0]);  // one s16le sample = 1
    const b = Buffer.from([2, 0]);  // one s16le sample = 2
    buf.write(a);
    buf.write(b);
    buf.flush();

    assert.ok(flushed);
    assert.strictEqual(flushed.pcm.length, 4);
    assert.strictEqual(flushed.pcm[0], 1);
    assert.strictEqual(flushed.pcm[2], 2);
  });

  test('silence detection triggers flush after minDurationMs', async () => {
    const buf = new PcmSilenceBuffer({
      minDurationMs:     300,
      maxDurationMs:     10_000,
      silenceDurationMs: 100,
      silenceThreshold:  100,
      checkIntervalMs:   20,
    });

    let flushed = false;
    buf.on('flush', () => { flushed = true; });

    // Write 300ms of loud audio to pass minDurationMs
    buf.write(makePcm(300, 5000));
    // Then write 200ms of silence
    buf.write(makeSilence(200));

    // Wait for silence detection to fire
    await new Promise(r => setTimeout(r, 400));
    assert.ok(flushed, 'silence detection should trigger flush');
  });
});
