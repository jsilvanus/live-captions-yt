/**
 * FanoutSupervisor: hook mode keeps the legacy runOnPublish registration; runner mode starts the
 * same ffmpeg command through the runner factory while the MediaMTX path is ready.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FanoutSupervisor } from '../src/fanout-supervisor.js';

function settings(map = {}) {
  return { get: (k) => map[k] };
}

function fakeMtx(initial = {}) {
  const state = { ready: initial.ready ?? false, readyTime: '2026-10-13T10:00:00Z', fail: false };
  const calls = [];
  return {
    state,
    calls,
    async addPath(n, c) { calls.push(['add', n, c]); },
    async patchPath(n, c) { calls.push(['patch', n, c]); },
    async deletePath(n) { calls.push(['delete', n]); },
    async kickPath(n) { calls.push(['kick', n]); },
    async getPath() {
      if (state.fail) throw new Error('down');
      return { ready: state.ready, readyTime: state.readyTime };
    },
  };
}

function fakeFactory() {
  const runners = [];
  const factory = (opts) => {
    const r = Object.assign(new EventEmitter(), { opts, started: false, stopped: false, where: 'w1', jobId: opts.jobId });
    r.start = async () => { r.started = true; return r; };
    r.stop = async () => { r.stopped = true; r.emit('close', { code: null, signal: 'SIGTERM' }); return {}; };
    runners.push(r);
    return r;
  };
  return { factory, runners };
}

const SPEC = { sourcePath: 'key1', tee: '[f=flv]rtmp://a.example/live/k', apiKey: 'key1', label: 'plain' };
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('FanoutSupervisor hook mode', () => {
  test('registers runOnPublish exactly like the old inline code and kicks on request', async () => {
    const mtx = fakeMtx();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings({ 'mediamtx.rtsp_base_url': 'rtsp://mtx:8554/' }) });
    assert.equal(sup.mode, 'hook');
    await sup.set('key1', { ...SPEC, kick: true });
    assert.deepEqual(mtx.calls[0], ['add', 'key1', {
      runOnPublish: 'ffmpeg -re -i rtsp://mtx:8554/key1 -c copy -f tee "[f=flv]rtmp://a.example/live/k"',
      runOnPublishRestart: true,
    }]);
    assert.deepEqual(mtx.calls[1], ['kick', 'key1']);
    await sup.clear('key1');
    assert.deepEqual(mtx.calls.at(-1), ['delete', 'key1']);
  });

  test('single flv target uses -f flv', async () => {
    const mtx = fakeMtx();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings({}) });
    await sup.set('k-t0', { sourcePath: 'k-t0', flvUrl: 'rtmp://a.example/live/x' });
    assert.match(mtx.calls[0][2].runOnPublish, /-c copy -f flv rtmp:\/\/a\.example\/live\/x$/);
    assert.equal(mtx.calls.some(c => c[0] === 'kick'), false);
  });

  test('falls back to patchPath when addPath fails', async () => {
    const mtx = fakeMtx();
    mtx.addPath = async () => { throw new Error('exists'); };
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings({}) });
    await sup.set('key1', SPEC);
    assert.equal(mtx.calls[0][0], 'patch');
  });
});

describe('FanoutSupervisor runner mode', () => {
  const cfg = {
    'mediamtx.fanout_mode': 'runner',
    'mediamtx.rtsp_base_url': 'rtsp://127.0.0.1:8554',
    'mediamtx.rtsp_fleet_base_url': 'rtsp://10.0.0.5:8554',
    'mediamtx.fleet_requires': 'net:mediamtx, filter:ass',
    'compute.ffmpeg_runner': 'fleet',
    'mediamtx.hook_secret': 'x',
  };

  test('starts a runner only while the path is ready, with fleet url, tcp, requires and a stable job id', async () => {
    const mtx = fakeMtx({ ready: false });
    const { factory, runners } = fakeFactory();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings(cfg), runnerFactory: factory });
    await sup.set('key1', SPEC);
    assert.equal(runners.length, 0, 'path not ready yet');
    assert.equal(mtx.calls.length, 0, 'no MediaMTX path config or kick in runner mode');

    mtx.state.ready = true;
    assert.equal(await sup.onPathEvent('key1', true), true);
    assert.equal(runners.length, 1);
    const o = runners[0].opts;
    assert.equal(o.runner, 'fleet');
    assert.equal(o.purpose, 'relay');
    assert.equal(o.class, 'stream');
    assert.deepEqual(o.requires, ['net:mediamtx', 'filter:ass']);
    assert.deepEqual(o.args, ['-rtsp_transport', 'tcp', '-re', '-i', 'rtsp://10.0.0.5:8554/key1', '-c', 'copy', '-f', 'tee', SPEC.tee]);
    assert.match(o.jobId, /^fanout-[0-9a-f]{16}-0$/);

    await sup.onPathEvent('key1', true); // duplicate hook: no second runner
    assert.equal(runners.length, 1);

    mtx.state.ready = false;
    await sup.onPathEvent('key1', false);
    assert.equal(runners[0].stopped, true);
    assert.deepEqual(sup.status().map(s => s.running), [false]);
    await sup.stopAll();
  });

  test('same path, targets and publish episode give the same job id on another supervisor', async () => {
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const mtx = fakeMtx({ ready: true });
      const { factory, runners } = fakeFactory();
      const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings(cfg), runnerFactory: factory });
      await sup.set('key1', SPEC);
      ids.push(runners[0].opts.jobId);
      await sup.stopAll();
    }
    assert.equal(ids[0], ids[1]);
  });

  test('changing the targets stops the old runner before starting the new one', async () => {
    const mtx = fakeMtx({ ready: true });
    const { factory, runners } = fakeFactory();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings(cfg), runnerFactory: factory });
    await sup.set('key1', SPEC);
    await sup.set('key1', { ...SPEC, tee: '[f=flv]rtmp://b.example/live/z' });
    assert.equal(runners.length, 2);
    assert.equal(runners[0].stopped, true);
    assert.match(runners[1].opts.args.at(-1), /b\.example/);
    await sup.stopAll();
  });

  test('restarts with backoff when ffmpeg dies while the path is still ready, and not after clear', async () => {
    const mtx = fakeMtx({ ready: true });
    const { factory, runners } = fakeFactory();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings(cfg), runnerFactory: factory });
    await sup.set('key1', SPEC);
    runners[0].emit('close', { code: 1 });
    await tick(1200);
    assert.equal(runners.length, 2);
    assert.match(runners[1].opts.jobId, /-1$/);

    await sup.clear('key1');
    assert.equal(runners[1].stopped, true);
    runners[1].emit('close', { code: 1 });
    await tick(50);
    assert.equal(runners.length, 2);
    await sup.stopAll();
  });

  test('a path that went away while ffmpeg was down is not restarted', async () => {
    const mtx = fakeMtx({ ready: true });
    const { factory, runners } = fakeFactory();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings(cfg), runnerFactory: factory });
    await sup.set('key1', SPEC);
    mtx.state.ready = false;
    runners[0].emit('close', { code: 1 });
    await tick(1200);
    assert.equal(runners.length, 1);
    await sup.stopAll();
  });

  test('reconcile starts a fan-out whose hook was missed; an unreachable MediaMTX changes nothing', async () => {
    const mtx = fakeMtx({ ready: false });
    const { factory, runners } = fakeFactory();
    const sup = new FanoutSupervisor({ mediamtx: mtx, settings: settings(cfg), runnerFactory: factory });
    await sup.set('key1', SPEC);
    mtx.state.ready = true;
    await sup.reconcile();
    assert.equal(runners.length, 1);
    mtx.state.fail = true;
    await sup.reconcile();
    assert.equal(runners[0].stopped, false);
    await sup.stopAll();
  });

  test('onPathEvent ignores paths without a fan-out', async () => {
    const sup = new FanoutSupervisor({ mediamtx: fakeMtx(), settings: settings(cfg), runnerFactory: fakeFactory().factory });
    assert.equal(await sup.onPathEvent('nope', true), false);
  });

  test('poll interval: fast without hook secret, slow with one', () => {
    const a = new FanoutSupervisor({ mediamtx: fakeMtx(), settings: settings({}) });
    const b = new FanoutSupervisor({ mediamtx: fakeMtx(), settings: settings({ 'mediamtx.hook_secret': 's' }) });
    assert.equal(a._pollMs(), 2000);
    assert.equal(b._pollMs(), 30000);
  });
});
