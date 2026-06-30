/**
 * MusicManager Phase 3 tests — RTMP audio-source ffmpeg pipe path.
 *
 * Uses node:test's mock.module() to mock node:child_process.spawn so no real
 * ffmpeg is needed. pcm-extractor.js is also mocked (extractPcm/
 * probeFfmpegVersion) since it's only relevant to the HLS path, mirroring
 * test/music-manager.test.js's setup.
 *
 * IMPORTANT: mock.module() must be called at the top level (before any
 * imports of the mocked modules) — see
 * packages/plugins/lcyt-rtmp/test/stt-manager-rtmp.test.js for the pattern.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const SAMPLE_RATE = 22050;
const RTMP_WINDOW_SECONDS = 6;
const RTMP_WINDOW_BYTES = SAMPLE_RATE * RTMP_WINDOW_SECONDS * 2; // s16le mono

// ── Helpers — synthetic s16le PCM byte buffers ─────────────────────────────

function makeToneBuffer(freq, sampleRate, numSamples, amplitude = 32767 * 0.8) {
  const buf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

// ── Minimal fake child process ──────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {number|null} [opts.exitCode=null]  null = stays open (never emits 'close')
 */
function makeFakeProc({ exitCode = null } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = function () {
    this.killed = true;
    setImmediate(() => this.emit('close', 0));
  };
  if (exitCode !== null) {
    setImmediate(() => proc.emit('close', exitCode));
  }
  return proc;
}

// ── Top-level mock setup ────────────────────────────────────────────────────
// Must be BEFORE any dynamic import of modules that use child_process.

const spawnCalls = [];
let nextProcFactory = () => makeFakeProc();

await mock.module('node:child_process', {
  namedExports: {
    spawn: mock.fn((cmd, args, opts) => {
      const proc = nextProcFactory(cmd, args, opts);
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

// ── Mock collaborators ──────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MusicManager RTMP path', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    nextProcFactory = () => makeFakeProc({ exitCode: null });
  });

  test('spawns ffmpeg with RTMP input URL and expected PCM args', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await mgr.start('key1', { streamKey: 'mystream', audioSource: 'rtmp' });

    assert.equal(spawnCalls.length, 1);
    const call = spawnCalls[0];
    assert.equal(call.cmd, 'ffmpeg');
    const inputArg = call.args.find((a) => typeof a === 'string' && a.startsWith('rtmp://'));
    assert.ok(inputArg, 'expected an rtmp:// input URL');
    assert.ok(inputArg.includes('mystream'), `expected stream key in URL: ${inputArg}`);
    assert.ok(call.args.includes('-ac'));
    assert.ok(call.args.includes('1'));
    assert.ok(call.args.includes('-ar'));
    assert.ok(call.args.includes(String(SAMPLE_RATE)));
    assert.ok(call.args.includes('-f'));
    assert.ok(call.args.includes('s16le'));

    await mgr.stop('key1');
  });

  test('builds RTMP URL from HLS_LOCAL_RTMP + HLS_RTMP_APP env vars', async () => {
    const origRtmp = process.env.HLS_LOCAL_RTMP;
    const origApp = process.env.HLS_RTMP_APP;
    process.env.HLS_LOCAL_RTMP = 'rtmp://10.0.0.5:1935';
    process.env.HLS_RTMP_APP = 'myapp';

    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await mgr.start('key2', { streamKey: 'test', audioSource: 'rtmp' });

    if (origRtmp === undefined) delete process.env.HLS_LOCAL_RTMP;
    else process.env.HLS_LOCAL_RTMP = origRtmp;
    if (origApp === undefined) delete process.env.HLS_RTMP_APP;
    else process.env.HLS_RTMP_APP = origApp;

    const inputArg = spawnCalls
      .flatMap((c) => c.args ?? [])
      .find((a) => typeof a === 'string' && a.includes('10.0.0.5'));
    assert.ok(inputArg, `expected RTMP URL with custom host, got: ${spawnCalls.flatMap((c) => c.args ?? [])}`);
    assert.ok(inputArg.includes('myapp/test'), `expected app/stream in URL: ${inputArg}`);

    await mgr.stop('key2');
  });

  test('getStatus() reports audioSource "rtmp" while running', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await mgr.start('key3', { streamKey: 'x', audioSource: 'rtmp' });
    assert.equal(mgr.getStatus('key3').audioSource, 'rtmp');
    await mgr.stop('key3');
  });

  test('stop() kills the ffmpeg process', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await mgr.start('key4', { streamKey: 'x', audioSource: 'rtmp' });

    const call = spawnCalls[0];
    await mgr.stop('key4');
    assert.ok(call.proc.killed, 'ffmpeg process should be killed on stop()');
  });

  test('ffmpeg exiting with a non-zero code emits "error" and stops the session', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    let errEvt = null;
    mgr.on('error', (e) => { errEvt = e; });

    nextProcFactory = () => makeFakeProc({ exitCode: 1 });
    await mgr.start('key5', { streamKey: 'x', audioSource: 'rtmp' });

    // Allow the queued 'close' event to fire.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(errEvt, 'expected an error event');
    assert.equal(errEvt.apiKey, 'key5');
    assert.equal(mgr.isRunning('key5'), false);
  });

  test('throws on unsupported audioSource', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await assert.rejects(
      () => mgr.start('key6', { streamKey: 'x', audioSource: 'ftp' }),
      /unsupported audioSource/i
    );
  });

  test('PCM windowing: a partial window does not trigger classification', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    await mgr.start('key7', { streamKey: 'x', audioSource: 'rtmp' });

    const proc = spawnCalls[0].proc;
    const halfWindow = makeToneBuffer(220, SAMPLE_RATE, Math.floor(RTMP_WINDOW_BYTES / 2 / 2));
    proc.stdout.emit('data', halfWindow);

    const status = mgr.getStatus('key7');
    assert.equal(status.segmentsProcessed, 0, 'a partial window should not be processed yet');
    assert.equal(soundProcessor.calls.length, 0);

    await mgr.stop('key7');
  });

  test('PCM windowing: a full window triggers classification once threshold reached', async () => {
    const soundProcessor = makeSoundProcessor();
    const events = [];
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    mgr.on('label_change', (e) => events.push(e));
    await mgr.start('key8', { streamKey: 'x', audioSource: 'rtmp' });

    const proc = spawnCalls[0].proc;
    const numSamples = RTMP_WINDOW_BYTES / 2;
    const fullWindow = makeToneBuffer(220, SAMPLE_RATE, numSamples);

    // Two full windows are needed: default confirmSegments=2.
    proc.stdout.emit('data', fullWindow);
    proc.stdout.emit('data', fullWindow);

    const status = mgr.getStatus('key8');
    assert.equal(status.segmentsProcessed, 2);
    assert.equal(events.length, 1, 'label_change should fire exactly once for a sustained tone');
    assert.equal(events[0].label, 'music');
    assert.equal(soundProcessor.calls.length, 1);
    assert.match(soundProcessor.calls[0].text, /<!-- sound:music/);

    await mgr.stop('key8');
  });

  test('PCM windowing: accumulator carries leftover bytes across chunks', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    await mgr.start('key9', { streamKey: 'x', audioSource: 'rtmp' });

    const proc = spawnCalls[0].proc;
    const numSamples = RTMP_WINDOW_BYTES / 2;
    const fullWindow = makeToneBuffer(220, SAMPLE_RATE, numSamples);

    // Split one full window across two chunks; should still count as one segment.
    const splitPoint = Math.floor(fullWindow.length / 2);
    proc.stdout.emit('data', fullWindow.subarray(0, splitPoint));
    assert.equal(mgr.getStatus('key9').segmentsProcessed, 0);
    proc.stdout.emit('data', fullWindow.subarray(splitPoint));
    assert.equal(mgr.getStatus('key9').segmentsProcessed, 1);

    await mgr.stop('key9');
  });
});
