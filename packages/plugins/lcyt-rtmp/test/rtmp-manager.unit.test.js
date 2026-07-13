/**
 * RtmpRelayManager unit test: start() awaits the runner's async startup, and
 * writeCaption() returns false when the process has no usable stdin/FIFO.
 *
 * Uses FFMPEG_RUNNER=worker against a mock worker daemon (no real ffmpeg) —
 * the previous version of this test tried to monkeypatch the frozen ESM
 * namespace of the runner factory, which throws and never actually ran.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

let server;
const savedEnv = {};

before(async () => {
  await new Promise(resolve => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: `j-${Math.random()}`, ok: true }));
    }).listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['FFMPEG_RUNNER', 'WORKER_DAEMON_URL', 'COMPUTE_ORCHESTRATOR_URL', 'MEDIAMTX_API_URL']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.FFMPEG_RUNNER = 'worker';
  process.env.WORKER_DAEMON_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  server.close(resolve);
}));

test('start() awaits runner startup; writeCaption() is false without a FIFO/stdin', async () => {
  const mgr = new RtmpRelayManager({
    ffmpegCaps: { available: true, hasLibx264: true, hasEia608: true, hasSubrip: true },
  });
  const relays = [{ slot: 1, targetUrl: 'rtmp://example.com/x', targetName: 'k', captionMode: 'cea708' }];

  await mgr.start('apikey-test', relays, {});
  assert.ok(mgr.isRunning('apikey-test'));
  assert.ok(mgr.hasCea708('apikey-test'));

  // WorkerFfmpegRunner exposes no stdin stream and no FIFO writer was created,
  // so caption injection must report failure rather than throw.
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
