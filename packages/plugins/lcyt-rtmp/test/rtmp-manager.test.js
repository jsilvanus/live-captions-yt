import test from 'node:test';
import assert from 'node:assert/strict';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

test('writeCaption drops when FIFO writer.write times out', async () => {
  const manager = new RtmpRelayManager();

  const apiKey = 'deadbeef';
  const now = new Date();

  // Prepare meta to simulate a running CEA-708 relay with fifo writer
  manager._meta.set(apiKey, {
    hasCea708: true,
    startedAt: now,
    srtSeq: 0,
    captionsSent: 0,
    cea708DelayMs: 0,
    _fifoWriter: {
      write: async (cue) => {
        // Simulate timeout/drop
        return false;
      }
    }
  });

  // Provide a dummy proc so the code doesn't bail early.
  manager._procs.set(apiKey, { stdin: { destroyed: false } });

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  try {
    const ok = await manager.writeCaption(apiKey, 'hello world', { timestamp: Date.now() });
    assert.strictEqual(ok, false, 'writeCaption should return false when writer.write times out');
    assert.ok(warnings.some(s => s.includes('FIFO write timed out')), 'should log FIFO write timed out');
  } finally {
    console.warn = origWarn;
  }
});
