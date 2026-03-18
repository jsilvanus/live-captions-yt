/**
 * Tests for RtmpRelayManager and probeFfmpeg.
 *
 * node:child_process.spawn and spawnSync are mocked so no real ffmpeg runs.
 * Run with: node --experimental-test-module-mocks --test test/rtmp-manager.test.js
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Fake ChildProcess
// ---------------------------------------------------------------------------

function makeFakeProc({ errorOnKill = false } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    destroyed: false,
    _written: [],
    write(chunk) { this._written.push(chunk); return true; },
    end() { this.destroyed = true; },
  };
  proc.kill = (signal = 'SIGTERM') => {
    if (errorOnKill) throw new Error('kill failed');
    setImmediate(() => proc.emit('close', 0));
  };
  return proc;
}

// ---------------------------------------------------------------------------
// Module mocks — must be set up before dynamic import
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
    spawnSync: mock.fn((cmd, args) => {
      if (args && args[0] === '-version') {
        return { stdout: Buffer.from('ffmpeg version 6.0'), status: 0, error: null };
      }
      // Simulate encoders output for probeFfmpeg
      const out = 'ffmpeg version 6.0\nEncoders:\n libx264 H.264 (libx264)\n eia608 CEA-608/708\nDemuxers:\n subrip SubRip\n';
      return { stdout: Buffer.from(out), stderr: Buffer.from(out), status: 0, error: null };
    }),
  },
});

// Dynamically import after mocks are set up
const { RtmpRelayManager, probeFfmpeg } = await import('lcyt-rtmp/src/rtmp-manager.js');

// ---------------------------------------------------------------------------
// Helper: reset between tests
// ---------------------------------------------------------------------------

function resetCalls() {
  spawnCalls.length = 0;
}

const TEST_RELAYS = [
  { slot: 1, targetUrl: 'rtmp://live.example.com/app/key1', targetName: null, captionMode: 'http' },
];

// ---------------------------------------------------------------------------
// probeFfmpeg
// ---------------------------------------------------------------------------

describe('probeFfmpeg', () => {
  it('returns available=true when ffmpeg exists', () => {
    const caps = probeFfmpeg();
    assert.equal(caps.available, true);
  });

  it('returns hasLibx264=true when encoder is in output', () => {
    const caps = probeFfmpeg();
    assert.equal(caps.hasLibx264, true);
  });

  it('returns hasEia608=true when encoder is in output', () => {
    const caps = probeFfmpeg();
    assert.equal(caps.hasEia608, true);
  });

  it('returns hasSubrip=true when demuxer is in output', () => {
    const caps = probeFfmpeg();
    assert.equal(caps.hasSubrip, true);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — constructor / state queries
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — constructor', () => {
  it('isRunning() returns false initially', () => {
    const m = new RtmpRelayManager({});
    assert.equal(m.isRunning('anykey'), false);
  });

  it('runningSlots() returns [] when nothing running', () => {
    const m = new RtmpRelayManager({});
    assert.deepEqual(m.runningSlots('anykey'), []);
  });

  it('startedAt() returns null initially', () => {
    const m = new RtmpRelayManager({});
    assert.equal(m.startedAt('anykey'), null);
  });

  it('hasCea708() returns false initially', () => {
    const m = new RtmpRelayManager({});
    assert.equal(m.hasCea708('anykey'), false);
  });

  it('isPublishing() returns false initially', () => {
    const m = new RtmpRelayManager({});
    assert.equal(m.isPublishing('anykey'), false);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — publish tracking
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — publish tracking', () => {
  it('markPublishing / isPublishing / markNotPublishing', () => {
    const m = new RtmpRelayManager({});
    m.markPublishing('key1');
    assert.equal(m.isPublishing('key1'), true);
    m.markNotPublishing('key1');
    assert.equal(m.isPublishing('key1'), false);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — start()
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — start()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('resolves and marks key as running', async () => {
    const m = new RtmpRelayManager({});
    await m.start('key1', TEST_RELAYS);
    assert.equal(m.isRunning('key1'), true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].cmd, 'ffmpeg');
  });

  it('uses -c copy in simple stream copy mode', async () => {
    const m = new RtmpRelayManager({});
    await m.start('key1', TEST_RELAYS);
    const args = spawnCalls[0].args;
    assert.ok(args.includes('-c'), 'should pass -c');
    assert.ok(args.includes('copy'), 'should use copy codec');
    assert.ok(args.includes('-f'), 'should pass -f');
    assert.ok(args.includes('tee'), 'should use tee muxer');
  });

  it('includes the target URL in tee args', async () => {
    const m = new RtmpRelayManager({});
    await m.start('key1', TEST_RELAYS);
    const args = spawnCalls[0].args;
    const teeArg = args.find(a => String(a).includes('rtmp://live.example.com'));
    assert.ok(teeArg, 'tee muxer arg should include target URL');
  });

  it('stops any existing process before starting new one', async () => {
    const m = new RtmpRelayManager({});
    await m.start('dup', TEST_RELAYS);
    assert.equal(m.isRunning('dup'), true);
    // Start again — should spawn a second ffmpeg for the same key
    await m.start('dup', TEST_RELAYS);
    assert.equal(spawnCalls.length, 2);
    // Allow any pending close-event callbacks to settle
    await new Promise(r => setImmediate(r));
  });

  it('resolves immediately with no relays (stops existing proc)', async () => {
    const m = new RtmpRelayManager({});
    await m.start('empty', TEST_RELAYS);
    assert.equal(m.isRunning('empty'), true);
    await m.start('empty', []);
    assert.equal(m.isRunning('empty'), false);
  });

  it('rejects when ffmpegCaps.available is false', async () => {
    const m = new RtmpRelayManager({ ffmpegCaps: { available: false } });
    await assert.rejects(() => m.start('key1', TEST_RELAYS), /ffmpeg/i);
  });

  it('records startedAt after start()', async () => {
    const m = new RtmpRelayManager({});
    await m.start('k', TEST_RELAYS);
    assert.ok(m.startedAt('k') instanceof Date);
  });

  it('runningSlots() returns correct slot numbers', async () => {
    const m = new RtmpRelayManager({});
    const relays = [
      { slot: 1, targetUrl: 'rtmp://a.com/live/k1', captionMode: 'http' },
      { slot: 3, targetUrl: 'rtmp://a.com/live/k3', captionMode: 'http' },
    ];
    await m.start('k', relays);
    assert.deepEqual(m.runningSlots('k'), [1, 3]);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — stop() / stopKey() / stopAll()
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — stop()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('resolves immediately when key is not running', async () => {
    const m = new RtmpRelayManager({});
    await assert.doesNotReject(() => m.stop('notrunning'));
  });

  it('marks key as not running after stop()', async () => {
    const m = new RtmpRelayManager({});
    await m.start('k', TEST_RELAYS);
    assert.equal(m.isRunning('k'), true);
    await m.stop('k');
    assert.equal(m.isRunning('k'), false);
  });

  it('stopKey() is an alias for stop()', async () => {
    const m = new RtmpRelayManager({});
    await m.start('k', TEST_RELAYS);
    await m.stopKey('k');
    assert.equal(m.isRunning('k'), false);
  });

  it('stopAll() stops all running processes', async () => {
    const m = new RtmpRelayManager({});
    await m.start('a', TEST_RELAYS);
    await m.start('b', [{ slot: 1, targetUrl: 'rtmp://b.com/live/key', captionMode: 'http' }]);
    assert.equal(m.isRunning('a'), true);
    assert.equal(m.isRunning('b'), true);
    await m.stopAll();
    assert.equal(m.isRunning('a'), false);
    assert.equal(m.isRunning('b'), false);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — startAll() alias
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — startAll()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('startAll() is an alias for start()', async () => {
    const m = new RtmpRelayManager({});
    await m.startAll('k', TEST_RELAYS);
    assert.equal(m.isRunning('k'), true);
    assert.equal(spawnCalls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — isSlotRunning()
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — isSlotRunning()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('returns false when not running', () => {
    const m = new RtmpRelayManager({});
    assert.equal(m.isSlotRunning('k', 1), false);
  });

  it('returns true for running slot', async () => {
    const m = new RtmpRelayManager({});
    await m.start('k', TEST_RELAYS);
    assert.equal(m.isSlotRunning('k', 1), true);
    assert.equal(m.isSlotRunning('k', 2), false);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — writeCaption()
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — writeCaption()', () => {
  beforeEach(() => { resetCalls(); nextProcFactory = () => makeFakeProc(); });

  it('returns false when key is not running in CEA-708 mode', async () => {
    const m = new RtmpRelayManager({});
    // Not running
    assert.equal(m.writeCaption('k', 'Hello'), false);

    // Running but not CEA-708
    await m.start('k', TEST_RELAYS);
    assert.equal(m.writeCaption('k', 'Hello'), false);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager — dropPublisher()
// ---------------------------------------------------------------------------

describe('RtmpRelayManager — dropPublisher()', () => {
  it('is a no-op when RTMP_CONTROL_URL is not set', async () => {
    const m = new RtmpRelayManager({ rtmpControlUrl: null });
    // Should not throw
    await assert.doesNotReject(() => m.dropPublisher('anykey'));
  });
});
