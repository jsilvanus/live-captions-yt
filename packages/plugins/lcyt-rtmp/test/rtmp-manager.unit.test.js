import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

test('RtmpRelayManager awaits runner.start and writeCaption returns false when no fifo writer', async () => {
  // Monkeypatch the ffmpeg runner factory to return a fake runner
  const ffmpeg = await import('../../../lcyt-backend/src/ffmpeg/index.js');
  const rtmpMod = await import('../src/rtmp-manager.js');

  const fakeRunner = function(opts) {
    const e = new EventEmitter();
    e.stdout = null;
    e.stderr = null;
    e.start = async function() {
      // simulate async startup delay
      await new Promise(r => setTimeout(r, 20));
      return e;
    };
    e.stop = async function(timeoutMs = 3000) {
      // immediate stop
      e.emit('close', { code: 0, signal: null });
      return { timedOut: false, code: 0, signal: null };
    };
    return e;
  };

  const origFactory = ffmpeg.createFfmpegRunner;
  ffmpeg.createFfmpegRunner = (opts) => fakeRunner(opts);

  try {
    const { RtmpRelayManager } = rtmpMod;
    const mgr = new RtmpRelayManager();
    const relays = [{ slot: 1, targetUrl: 'rtmp://example/x', captionMode: 'cea708' }];

    // Start should await the runner.start() async work
    await mgr.start('apikey-test', relays, {});
    assert.ok(mgr.isRunning('apikey-test'));

    // no fifo writer created by fake runner -> writeCaption should return false
    const ok = await mgr.writeCaption('apikey-test', 'hello', {});
    assert.equal(ok, false);

    // stop should resolve
    await mgr.stop('apikey-test');
    assert.ok(!mgr.isRunning('apikey-test'));
  } finally {
    ffmpeg.createFfmpegRunner = origFactory;
  }
});
