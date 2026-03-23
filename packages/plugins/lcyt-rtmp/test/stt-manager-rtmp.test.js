/**
 * SttManager Phase 3 tests — RTMP / WHEP ffmpeg pipe path + probeFfmpegVersion
 *
 * Uses --experimental-test-module-mocks to mock node:child_process.spawn
 * so no real ffmpeg is needed.
 *
 * IMPORTANT: mock.module() must be called at the top level (before any imports
 * of the mocked modules), using a mutable nextProcFactory variable for per-test
 * customisation. See packages/lcyt-backend/test/managers.test.js for the pattern.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Minimal fake child process ────────────────────────────────────────────────

/**
 * Creates a fake child_process-like EventEmitter.
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

// ── Top-level mock setup ──────────────────────────────────────────────────────
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

await mock.module('../src/hls-segment-fetcher.js', {
  namedExports: {
    HlsSegmentFetcher: class extends EventEmitter {
      start() {}
      stop() {}
    },
  },
});

// Import the real module once after mocks are wired up
const { SttManager, probeFfmpegVersion } = await import('../src/stt-manager.js');

// ── probeFfmpegVersion ────────────────────────────────────────────────────────

describe('probeFfmpegVersion', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  test('returns { major, minor } when ffmpeg is present', async () => {
    nextProcFactory = () => {
      const proc = makeFakeProc({ exitCode: null });
      // Emit data first, then close inside the next turn so data is accumulated
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ffmpeg version 7.1.0-static https://johnvansickle.com/ffmpeg'));
        setImmediate(() => proc.emit('close', 0));
      });
      return proc;
    };

    const v = await probeFfmpegVersion();
    assert.ok(v, 'should return a version object');
    assert.strictEqual(v.major, 7);
    assert.strictEqual(v.minor, 1);
  });

  test('returns null when ffmpeg is not found (spawn throws)', async () => {
    nextProcFactory = () => { throw new Error('ENOENT'); };
    const v = await probeFfmpegVersion();
    assert.strictEqual(v, null);
  });
});

// ── SttManager — RTMP / WHEP audio sources ───────────────────────────────────

describe('SttManager RTMP path', () => {
  let savedGoogleKey;

  beforeEach(() => {
    spawnCalls.length = 0;
    // Provide a fake Google STT API key so GoogleSttAdapter.start() passes the
    // credential check — without this it throws before reaching audioSource logic.
    savedGoogleKey = process.env.GOOGLE_STT_KEY;
    process.env.GOOGLE_STT_KEY = 'fake-key-for-test';
    // Default factory: proc stays open (simulates a running ffmpeg process)
    nextProcFactory = () => makeFakeProc({ exitCode: null });
  });

  afterEach(() => {
    if (savedGoogleKey === undefined) delete process.env.GOOGLE_STT_KEY;
    else process.env.GOOGLE_STT_KEY = savedGoogleKey;
  });

  test('spawns ffmpeg with RTMP input URL', async () => {
    const mgr = new SttManager(null);
    await mgr.start('key1', { provider: 'google', audioSource: 'rtmp', streamKey: 'mystream' });

    const rtmpCall = spawnCalls.find(c =>
      c.args?.some(v => typeof v === 'string' && v.startsWith('rtmp://'))
    );
    assert.ok(rtmpCall, 'ffmpeg should be spawned with rtmp:// input URL');
    assert.ok(rtmpCall.args.includes('-f'), 's16le output format flag expected');
    assert.ok(rtmpCall.args.includes('s16le'), 's16le format value expected');
    assert.ok(rtmpCall.args.includes('-ar'), 'sample-rate flag expected');
    assert.ok(rtmpCall.args.includes('16000'), '16 kHz sample rate expected');

    await mgr.stopAll();
  });

  test('builds RTMP URL from HLS_LOCAL_RTMP + HLS_RTMP_APP env vars', async () => {
    const origRtmp = process.env.HLS_LOCAL_RTMP;
    const origApp  = process.env.HLS_RTMP_APP;
    process.env.HLS_LOCAL_RTMP = 'rtmp://10.0.0.5:1935';
    process.env.HLS_RTMP_APP   = 'myapp';

    const mgr = new SttManager(null);
    await mgr.start('key2', { provider: 'google', audioSource: 'rtmp', streamKey: 'test' });

    if (origRtmp === undefined) delete process.env.HLS_LOCAL_RTMP;
    else process.env.HLS_LOCAL_RTMP = origRtmp;
    if (origApp === undefined) delete process.env.HLS_RTMP_APP;
    else process.env.HLS_RTMP_APP = origApp;

    const inputArg = spawnCalls
      .flatMap(c => c.args ?? [])
      .find(a => typeof a === 'string' && a.includes('10.0.0.5'));
    assert.ok(inputArg, `expected RTMP URL with custom host, got: ${spawnCalls.flatMap(c => c.args ?? [])}`);
    assert.ok(inputArg.includes('myapp/test'), `expected app/stream in URL: ${inputArg}`);

    await mgr.stopAll();
  });

  test('stop() kills the ffmpeg process', async () => {
    const mgr = new SttManager(null);
    await mgr.start('key3', { provider: 'google', audioSource: 'rtmp', streamKey: 'x' });

    // Find the RTMP spawn call (args contain rtmp://)
    const rtmpCall = spawnCalls.find(c =>
      c.args?.some(v => typeof v === 'string' && v.startsWith('rtmp://'))
    );
    assert.ok(rtmpCall, 'expected an RTMP spawn call');

    await mgr.stop('key3');
    assert.ok(rtmpCall.proc.killed, 'ffmpeg process should be killed on stop()');
  });

  test('whep uses mediamtx /whep URL', async () => {
    const origBase = process.env.MEDIAMTX_HLS_BASE_URL;
    process.env.MEDIAMTX_HLS_BASE_URL = 'http://127.0.0.1:8888';

    const mgr = new SttManager(null);
    await mgr.start('key4', { provider: 'google', audioSource: 'whep', streamKey: 'mypath' });

    if (origBase === undefined) delete process.env.MEDIAMTX_HLS_BASE_URL;
    else process.env.MEDIAMTX_HLS_BASE_URL = origBase;

    const inputArg = spawnCalls
      .flatMap(c => c.args ?? [])
      .find(a => typeof a === 'string' && a.includes('/whep'));
    assert.ok(inputArg, `expected WHEP URL, got: ${spawnCalls.flatMap(c => c.args ?? [])}`);
    assert.ok(inputArg.includes('mypath/whep'), `expected stream key in WHEP URL: ${inputArg}`);

    await mgr.stopAll();
  });

  test('getStatus includes ffmpegVersion and whepAvailable', () => {
    const mgr = new SttManager(null);
    mgr.ffmpegVersion = { major: 7, minor: 0 };

    const status = mgr.getStatus('nonexistent');
    assert.strictEqual(status.running, false);
    assert.deepStrictEqual(status.ffmpegVersion, { major: 7, minor: 0 });
    assert.strictEqual(status.whepAvailable, true);
  });

  test('whepAvailable is false when ffmpeg < 6.1', () => {
    const mgr = new SttManager(null);
    mgr.ffmpegVersion = { major: 5, minor: 1 };

    const status = mgr.getStatus('x');
    assert.strictEqual(status.whepAvailable, false);
  });

  test('whepAvailable is false when ffmpegVersion is null', () => {
    const mgr = new SttManager(null);
    mgr.ffmpegVersion = null;

    const status = mgr.getStatus('x');
    assert.strictEqual(status.whepAvailable, false);
  });

  test('throws on unsupported audioSource', async () => {
    const mgr = new SttManager(null);
    await assert.rejects(
      () => mgr.start('key5', { provider: 'google', audioSource: 'ftp', streamKey: 'x' }),
      /unsupported audioSource/i
    );
  });
});
