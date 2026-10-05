/**
 * RtmpRelayManager unit test: start() awaits the runner's async startup, and
 * writeCaption() returns false when the process has no usable stdin/FIFO.
 *
 * Uses FFMPEG_WRAPPER pointing at a sleeping stand-in (helpers/fake-ffmpeg-env.js), so no real ffmpeg runs.
 */
import './helpers/fake-ffmpeg-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

test('start() awaits runner startup; writeCaption() is false without a FIFO/stdin', async () => {
  const mgr = new RtmpRelayManager({
    ffmpegCaps: { available: true, hasLibx264: true, hasEia608: true, hasSubrip: true },
  });
  const relays = [{ slot: 1, targetUrl: 'rtmp://example.com/x', targetName: 'k', captionMode: 'cea708' }];

  await mgr.start('apikey-test', relays, {});
  assert.ok(mgr.isRunning('apikey-test'));
  assert.ok(mgr.hasCea708('apikey-test'));

  // The relay's stdin is not a caption channel in this mode and no FIFO writer is
  // reading, so caption injection must report failure rather than throw.
  const ok = await mgr.writeCaption('apikey-test', 'hello', {});
  assert.equal(ok, false);

  await mgr.stop('apikey-test');
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!mgr.isRunning('apikey-test'));
});

test('writeCaption() is false for an unknown key', async () => {
  const mgr = new RtmpRelayManager();
  assert.equal(await mgr.writeCaption('nope', 'hello', {}), false);
});
