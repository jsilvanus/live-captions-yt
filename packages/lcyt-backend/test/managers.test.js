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

describe('HlsManager', () => {
  beforeEach(() => resetCalls());

  it('isRunning() returns false initially', () => {
    const m = new HlsManager();
    assert.equal(m.isRunning('anykey'), false);
  });

  it('start() marks the key as running and spawns no ffmpeg', async () => {
    const m = new HlsManager();
    await m.start('key1');
    assert.equal(m.isRunning('key1'), true);
    assert.equal(spawnCalls.length, 0);
    assert.equal(mkdirCalls.length, 0);
  });

  it('start() registers the path in MediaMTX when a client is given', async () => {
    const added = [];
    const m = new HlsManager({ mediamtxClient: { addPath: async (key, opts) => { added.push([key, opts]); } } });
    await m.start('key2');
    assert.deepEqual(added, [['key2', { source: 'publisher' }]]);
  });

  it('start() still activates the key when MediaMTX addPath fails', async () => {
    const m = new HlsManager({ mediamtxClient: { addPath: async () => { throw new Error('down'); } } });
    await assert.doesNotReject(() => m.start('key3'));
    assert.equal(m.isRunning('key3'), true);
  });

  it('start() twice for the same key keeps it running', async () => {
    const m = new HlsManager();
    await m.start('dupkey');
    await m.start('dupkey');
    assert.equal(m.isRunning('dupkey'), true);
  });

  it('stop() is a no-op when the key is not running', async () => {
    const m = new HlsManager();
    await assert.doesNotReject(() => m.stop('notrunning'));
  });

  it('stop() marks the key as not running and removes no files', async () => {
    const m = new HlsManager();
    await m.start('stopkey');
    await m.stop('stopkey');
    assert.equal(m.isRunning('stopkey'), false);
    assert.equal(rmCalls.length, 0);
  });

  it('stopAll() stops every running key', async () => {
    const m = new HlsManager();
    await m.start('key-a');
    await m.start('key-b');
    await m.stopAll();
    assert.equal(m.isRunning('key-a'), false);
    assert.equal(m.isRunning('key-b'), false);
  });

  it('stopAll() is a no-op when nothing is running', async () => {
    const m = new HlsManager();
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
