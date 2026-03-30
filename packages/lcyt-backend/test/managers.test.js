/**
 * Tests for HlsManager, RadioManager, and PreviewManager.
 *
 * These managers spawn ffmpeg subprocesses. Tests use --experimental-test-module-mocks
 * to intercept node:child_process.spawn and node:fs, so no real ffmpeg or filesystem
 * operations occur.
 *
 * Run with:
 *   node --experimental-test-module-mocks --test test/managers.test.js
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Fake process factory
// ---------------------------------------------------------------------------

function makeFakeProc({ errorOnKill = false } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write() {}, end() {} };

  const signals = [];
  proc.kill = (signal = 'SIGTERM') => {
    if (errorOnKill) throw new Error('kill failed');
    signals.push(signal);
    setImmediate(() => proc.emit('close', 0));
  };
  proc._signals = signals;
  return proc;
}

// ---------------------------------------------------------------------------
// Module mocks — must be set up before dynamic import of the managers
// ---------------------------------------------------------------------------

const spawnCalls = [];
let nextProcFactory = () => makeFakeProc();

await mock.module('node:child_process', {
  namedExports: {
    spawn: mock.fn((cmd, args, opts) => {
      const proc = nextProcFactory();
      spawnCalls.push({ cmd, args, opts, proc });
      return proc;
    }),
    spawnSync: mock.fn(() => ({
      stdout: Buffer.from('ffmpeg version 6.0\nEncoders:\n libx264\nDemuxers:\n subrip\n'),
      status: 0,
    })),
  },
});

const mkdirCalls = [];
const rmCalls = [];

await mock.module('node:fs', {
  namedExports: {
    mkdirSync: mock.fn((dir, opts) => mkdirCalls.push({ dir, opts })),
    rmSync: mock.fn((dir, opts) => rmCalls.push({ dir, opts })),
    createReadStream: mock.fn(() => ({ pipe() {} })),
    existsSync: mock.fn(() => true),
    statSync: mock.fn(() => ({ mtime: new Date('2026-01-01T00:00:00Z') })),
  },
});

// Now dynamically import managers (they use the mocked modules)
const { HlsManager }     = await import('lcyt-rtmp/src/hls-manager.js');
const { RadioManager }   = await import('lcyt-rtmp/src/radio-manager.js');
const { PreviewManager } = await import('lcyt-rtmp/src/preview-manager.js');

// ---------------------------------------------------------------------------
// Helper: reset call counters between tests
// ---------------------------------------------------------------------------

function resetCalls() {
  spawnCalls.length = 0;
  mkdirCalls.length = 0;
  rmCalls.length = 0;
}

// ---------------------------------------------------------------------------
// HlsManager
// ---------------------------------------------------------------------------

describe('HlsManager — constructor', () => {
  it('uses provided options', () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://host:1935', rtmpApp: 'app' });
    assert.equal(m._hlsRoot, '/tmp/hls');
    assert.equal(m._local, 'rtmp://host:1935');
    assert.equal(m._app, 'app');
  });

  it('hlsDir() returns root/key path', () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls' });
    assert.ok(m.hlsDir('mykey').endsWith('mykey'));
    const p = path.normalize(m.hlsDir('mykey'));
    assert.ok(p.includes(path.normalize('/tmp/hls')));
  });

  it('isRunning() returns false initially', () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls' });
    assert.equal(m.isRunning('anykey'), false);
  });
});

describe('HlsManager — start()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('resolves and marks the key as running', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live' });
    await m.start('key1');
    assert.equal(m.isRunning('key1'), true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].cmd, 'ffmpeg');
  });

  it('creates the HLS output directory', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls' });
    await m.start('key2');
    assert.ok(mkdirCalls.some(c => String(c.dir).includes('key2')));
  });

  it('passes correct ffmpeg args (stream copy mode)', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live' });
    await m.start('mykey');
    const args = spawnCalls[0].args;
    assert.ok(args.includes('-c'));
    assert.ok(args.includes('copy'));
    assert.ok(args.includes('-f'));
    assert.ok(args.includes('hls'));
    assert.ok(args.some(a => String(a).includes('mykey')));
  });

  it('stops any existing process before starting a new one', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live' });
    await m.start('dupkey');
    assert.equal(m.isRunning('dupkey'), true);
    // Start again for the same key — should spawn a second ffmpeg
    await m.start('dupkey');
    // Two spawn calls confirm the restart happened
    assert.equal(spawnCalls.length, 2);
    // Allow any pending close-event callbacks to settle
    await new Promise(r => setImmediate(r));
  });

  it('rejects when the process emits an error (nextTick fires before setImmediate)', async () => {
    nextProcFactory = () => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write() {}, end() {} };
      proc.kill = () => {};
      // process.nextTick fires before setImmediate, so the error event
      // reaches the reject() handler before resolve() is called.
      process.nextTick(() => proc.emit('error', new Error('ENOENT')));
      return proc;
    };

    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live' });
    await assert.rejects(() => m.start('errkey'), /ENOENT/);
  });
});

describe('HlsManager — stop()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('resolves immediately when the key is not running', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls' });
    await assert.doesNotReject(() => m.stop('notrunning'));
  });

  it('kills the process and marks key as not running', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live' });
    await m.start('stopkey');
    assert.equal(m.isRunning('stopkey'), true);
    await m.stop('stopkey');
    assert.equal(m.isRunning('stopkey'), false);
  });
});

describe('HlsManager — stopAll()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('stops all running processes', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls', localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live' });
    await m.start('key-a');
    await m.start('key-b');
    assert.equal(m.isRunning('key-a'), true);
    assert.equal(m.isRunning('key-b'), true);
    await m.stopAll();
    assert.equal(m.isRunning('key-a'), false);
    assert.equal(m.isRunning('key-b'), false);
  });

  it('is a no-op when no processes are running', async () => {
    const m = new HlsManager({ hlsRoot: '/tmp/hls' });
    await assert.doesNotReject(() => m.stopAll());
  });
});

// ---------------------------------------------------------------------------
// RadioManager — MediaMTX-based (no ffmpeg, no hlsDir)
// ---------------------------------------------------------------------------

describe('RadioManager', () => {
  it('isRunning() returns false initially', () => {
    const m = new RadioManager();
    assert.equal(m.isRunning('rkey'), false);
  });

  it('start() marks key as running', async () => {
    const m = new RadioManager();
    await m.start('rkey');
    assert.equal(m.isRunning('rkey'), true);
  });

  it('stop() marks key as not running', async () => {
    const m = new RadioManager();
    await m.start('rkey');
    await m.stop('rkey');
    assert.equal(m.isRunning('rkey'), false);
  });

  it('stop() is a no-op for a key that is not running', async () => {
    const m = new RadioManager();
    await assert.doesNotReject(() => m.stop('never-started'));
  });

  it('stopAll() clears all keys', async () => {
    const m = new RadioManager();
    await m.start('r1');
    await m.start('r2');
    await m.stopAll();
    assert.equal(m.isRunning('r1'), false);
    assert.equal(m.isRunning('r2'), false);
  });

  it('getInternalHlsUrl() includes the radio key', () => {
    const m = new RadioManager();
    const url = m.getInternalHlsUrl('rkey');
    assert.ok(url.includes('rkey'));
  });

  it('getPublicHlsUrl() without nginx returns backend proxy URL', () => {
    const m = new RadioManager();
    const url = m.getPublicHlsUrl('rkey', 'https://example.com');
    assert.ok(url.includes('rkey'));
    assert.ok(url.includes('example.com'));
  });
});

// ---------------------------------------------------------------------------
// PreviewManager — MediaMTX-based (no ffmpeg, no previewPath)
// ---------------------------------------------------------------------------

describe('PreviewManager — constructor', () => {
  it('isRunning() returns false initially', () => {
    const m = new PreviewManager();
    assert.equal(m.isRunning('k'), false);
  });

  it('getWebRtcUrl() returns a URL containing the key', () => {
    const m = new PreviewManager({ webrtcBase: 'http://127.0.0.1:8889' });
    const url = m.getWebRtcUrl('mykey');
    assert.ok(url.includes('mykey'));
    assert.ok(url.includes('8889'));
  });
});

describe('PreviewManager — start() / stop() / stopAll()', () => {
  it('start() marks key as running', async () => {
    const m = new PreviewManager();
    await m.start('pkey');
    assert.equal(m.isRunning('pkey'), true);
  });

  it('stop() marks key as not running', async () => {
    const m = new PreviewManager();
    await m.start('pk');
    await m.stop('pk');
    assert.equal(m.isRunning('pk'), false);
  });

  it('stop() resolves when key is not running', async () => {
    const m = new PreviewManager();
    await assert.doesNotReject(() => m.stop('gone'));
  });

  it('stopAll() clears all keys', async () => {
    const m = new PreviewManager();
    await m.start('p1');
    await m.start('p2');
    await m.stopAll();
    assert.equal(m.isRunning('p1'), false);
    assert.equal(m.isRunning('p2'), false);
  });

  it('fetchThumbnail() returns null when no mediamtxClient configured', async () => {
    const m = new PreviewManager();
    const result = await m.fetchThumbnail('pkey');
    assert.equal(result, null);
  });
});
