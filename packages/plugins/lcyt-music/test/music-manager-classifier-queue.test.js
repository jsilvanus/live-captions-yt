/**
 * MusicManager Phase 4 tests — RTMP processingQueue ordering when
 * MUSIC_CLASSIFIER_URL is set.
 *
 * Two full windows arriving in a single ffmpeg stdout 'data' chunk must be
 * classified (and their events emitted) in arrival order, not in whichever
 * order their classifier fetch() calls happen to resolve. We verify this by
 * holding the first window's fetch() pending (via a manually-resolved
 * deferred) and asserting the second window's fetch() is not even invoked
 * until the first one settles.
 *
 * Mirrors test/music-manager-rtmp.test.js's mock.module() setup for
 * node:child_process + pcm-extractor.js.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const SAMPLE_RATE = 22050;
const RTMP_WINDOW_SECONDS = 6;
const RTMP_WINDOW_BYTES = SAMPLE_RATE * RTMP_WINDOW_SECONDS * 2; // s16le mono

function makeToneBuffer(freq, sampleRate, numSamples, amplitude = 32767 * 0.8) {
  const buf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = function () {
    this.killed = true;
    setImmediate(() => this.emit('close', 0));
  };
  return proc;
}

const spawnCalls = [];

await mock.module('node:child_process', {
  namedExports: {
    spawn: mock.fn((cmd, args, opts) => {
      const proc = makeFakeProc();
      spawnCalls.push({ cmd, args, opts, proc });
      return proc;
    }),
  },
});

await mock.module('../src/pcm-extractor.js', {
  namedExports: {
    extractPcm: async () => new Float32Array(0),
    probeFfmpegVersion: async () => null,
  },
});

const { MusicManager } = await import('../src/music-manager.js');

function makeMockDb() {
  return {
    prepare() {
      return { get() { return undefined; }, run() { return {}; }, all() { return []; } };
    },
    exec() {},
  };
}

function makeSoundProcessor() {
  const calls = [];
  const fn = (apiKey, text) => { calls.push({ apiKey, text }); return ''; };
  fn.calls = calls;
  return fn;
}

async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Poll fetchEvents until it reaches the expected length, or time out. */
async function waitForLength(arr, length, timeoutMs = 1000) {
  const start = Date.now();
  while (arr.length < length) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for length ${length}, got ${JSON.stringify(arr)}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('MusicManager RTMP processingQueue ordering (MUSIC_CLASSIFIER_URL set)', () => {
  let originalUrl;
  let originalFetch;

  beforeEach(() => {
    spawnCalls.length = 0;
    originalUrl = process.env.MUSIC_CLASSIFIER_URL;
    process.env.MUSIC_CLASSIFIER_URL = 'http://classifier.example.test/classify';
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.MUSIC_CLASSIFIER_URL;
    else process.env.MUSIC_CLASSIFIER_URL = originalUrl;
    globalThis.fetch = originalFetch;
  });

  test('windows in the same data chunk are classified in arrival order, not resolution order', async () => {
    const fetchEvents = [];
    let callIndex = 0;
    const deferreds = [];

    globalThis.fetch = async () => {
      const index = callIndex++;
      fetchEvents.push(`start:${index}`);
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      deferreds.push(resolve);
      await promise;
      fetchEvents.push(`end:${index}`);
      const label = index === 0 ? 'speech' : 'music';
      return { ok: true, status: 200, json: async () => ({ label, confidence: 0.9 }) };
    };

    const soundProcessor = makeSoundProcessor();
    const labelEvents = [];
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    mgr.on('label_change', (e) => labelEvents.push(e));
    await mgr.start('keyQ', { streamKey: 'x', audioSource: 'rtmp' });

    const proc = spawnCalls[0].proc;
    const numSamples = RTMP_WINDOW_BYTES / 2;
    const window1 = makeToneBuffer(220, SAMPLE_RATE, numSamples);
    const window2 = makeToneBuffer(440, SAMPLE_RATE, numSamples);

    // Both windows arrive in a single 'data' chunk.
    proc.stdout.emit('data', Buffer.concat([window1, window2]));

    await waitForLength(fetchEvents, 1);
    await flushMicrotasks(10);
    assert.deepEqual(fetchEvents, ['start:0'], 'second window must not start classification until the first settles');

    // Resolve the first window's classifier call — only then should the
    // second window's classify() call (fetch) be invoked.
    deferreds[0]();
    await waitForLength(fetchEvents, 3);
    await flushMicrotasks(10);
    assert.deepEqual(fetchEvents, ['start:0', 'end:0', 'start:1']);

    deferreds[1]();
    await waitForLength(fetchEvents, 4);
    assert.deepEqual(fetchEvents, ['start:0', 'end:0', 'start:1', 'end:1']);

    await mgr.stop('keyQ');
  });

  test('falls back to the local heuristic when the classifier call fails', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500 });

    const soundProcessor = makeSoundProcessor();
    const labelEvents = [];
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    mgr.on('label_change', (e) => labelEvents.push(e));
    await mgr.start('keyF', { streamKey: 'x', audioSource: 'rtmp' });

    const proc = spawnCalls[0].proc;
    const numSamples = RTMP_WINDOW_BYTES / 2;
    const fullWindow = makeToneBuffer(220, SAMPLE_RATE, numSamples);

    proc.stdout.emit('data', fullWindow);
    proc.stdout.emit('data', fullWindow);
    await waitForLength(labelEvents, 1);

    assert.equal(labelEvents.length, 1, 'heuristic fallback should still classify the sustained tone as music');
    assert.equal(labelEvents[0].label, 'music');

    await mgr.stop('keyF');
  });
});
