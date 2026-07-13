/**
 * Regression tests for RtmpRelayManager restart handling.
 *
 * 1. Restarting a relay (same API key) must not let the OLD process's async
 *    'close' event delete the NEW process's _procs/_meta entries.
 * 2. Reconfiguring a running MediaMTX plain relay must tear down the previous
 *    path config (delete) before registering the new one, so stale runOnPublish
 *    fan-out commands don't survive a target change.
 * 3. _upsertPath must fall back to patchPath when addPath fails because the
 *    path config already exists.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

const NO_CEA_CAPS = { available: true, hasLibx264: false, hasEia608: false, hasSubrip: false };

describe('RtmpRelayManager — restart race', () => {
  let server;
  const savedEnv = {};

  before(async () => {
    // Minimal mock worker daemon so FFMPEG_RUNNER=worker gives us a fully
    // controllable runner (no real ffmpeg spawn): WorkerFfmpegRunner emits
    // 'close' asynchronously from stop(), which is exactly the race window.
    await new Promise(resolve => {
      server = createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId: `j-${Date.now()}-${Math.random()}`, ok: true }));
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

  test('old process close event does not wipe the restarted relay state', async () => {
    const mgr = new RtmpRelayManager({ ffmpegCaps: NO_CEA_CAPS });
    const relays = [{ slot: 1, targetUrl: 'rtmp://a.example/live', targetName: 'k' }];

    await mgr.start('race-key', relays);
    assert.ok(mgr.isRunning('race-key'));

    // Restart under the same key — the old runner's stop() emits 'close'
    // after the new process has been registered.
    await mgr.start('race-key', relays);

    // Give the old runner's async DELETE + 'close' emission time to land.
    await new Promise(r => setTimeout(r, 150));

    assert.ok(mgr.isRunning('race-key'), 'restarted relay must stay registered after the old close event');
    assert.deepEqual(mgr.runningSlots('race-key'), [1]);

    await mgr.stop('race-key');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(!mgr.isRunning('race-key'));
  });
});

describe('RtmpRelayManager — MediaMTX plain relay lifecycle', () => {
  function makeFakeMtx({ failAdd = false } = {}) {
    const calls = [];
    return {
      calls,
      async addPath(name, cfg) {
        calls.push(['add', name, cfg]);
        if (failAdd) throw new Error('path already exists');
      },
      async patchPath(name, cfg) { calls.push(['patch', name, cfg]); },
      async deletePath(name)     { calls.push(['delete', name]); },
      async kickPath(name)       { calls.push(['kick', name]); },
    };
  }

  test('reconfiguring a running plain relay deletes the old path before re-adding', async () => {
    const mtx = makeFakeMtx();
    const ended = [];
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: NO_CEA_CAPS,
      onStreamEnded: (apiKey, slot) => ended.push(slot),
    });

    await mgr.start('key1', [{ slot: 1, targetUrl: 'rtmp://a.example/live', targetName: 'one' }]);
    assert.ok(mgr.isRunning('key1'));
    assert.equal(mtx.calls.filter(c => c[0] === 'add').length, 1);

    await mgr.start('key1', [{ slot: 2, targetUrl: 'rtmp://b.example/live', targetName: 'two' }]);

    const kinds = mtx.calls.map(c => c[0]);
    const deleteIdx = kinds.indexOf('delete');
    const secondAddIdx = kinds.lastIndexOf('add');
    assert.ok(deleteIdx !== -1, 'old path config must be deleted on reconfigure');
    assert.ok(deleteIdx < secondAddIdx, 'delete must happen before the new add');
    assert.deepEqual(ended, [1], 'end stats fired for the replaced relay slot');
    assert.deepEqual(mgr.runningSlots('key1'), [2]);

    await mgr.stop('key1');
    assert.ok(!mgr.isRunning('key1'));
  });

  test('setDskOverlay finds the slots of a MediaMTX-managed plain relay', async () => {
    const mtx = makeFakeMtx();
    const mgr = new RtmpRelayManager({ mediamtxClient: mtx, ffmpegCaps: NO_CEA_CAPS });

    await mgr.start('key2', [{ slot: 1, targetUrl: 'rtmp://a.example/live', targetName: 'one' }]);
    assert.ok(mgr.isRunning('key2'));

    // Restarting into DSK mode spawns a local ffmpeg; stub start() to capture
    // the restart arguments instead (the DSK ffmpeg path is covered elsewhere).
    const restarts = [];
    mgr.start = async (apiKey, slots, opts) => { restarts.push({ apiKey, slots, opts }); };

    await mgr.setDskOverlay('key2', ['lower3rd'], ['/tmp/does-not-matter.png']);

    assert.equal(restarts.length, 1, 'a running plain relay must be restarted on DSK update');
    assert.deepEqual(restarts[0].slots.map(s => s.slot), [1]);
  });

  test('_upsertPath falls back to patchPath when addPath reports an existing path', async () => {
    const mtx = makeFakeMtx({ failAdd: true });
    const mgr = new RtmpRelayManager({ mediamtxClient: mtx, ffmpegCaps: NO_CEA_CAPS });

    await mgr._upsertPath('p1', { runOnPublish: 'x' });

    assert.deepEqual(mtx.calls.map(c => c[0]), ['add', 'patch']);
    assert.equal(mtx.calls[1][1], 'p1');
  });
});
