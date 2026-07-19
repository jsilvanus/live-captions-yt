/**
 * RtmpRelayManager camera-sourced relay tests (plan_ingest_feeds.md §2c).
 *
 * Slots with sourceCameraKey set forward a named feed's own MediaMTX path
 * (a prod_cameras row's camera_key) instead of the raw per-key ingest, via
 * a MediaMTX runOnPublish hook on that path — mirrors the crop-view fan-out
 * mechanism in crop-manager.test.js, just keyed by camera instead of
 * hardcoded to the {key}-crop path, and grouped per distinct camera_key
 * since a project can relay from several named feeds at once.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

function makeFakeMtx() {
  const calls = [];
  return {
    calls,
    async addPath(name, cfg)   { calls.push(['add', name, cfg]); },
    async patchPath(name, cfg) { calls.push(['patch', name, cfg]); },
    async deletePath(name)     { calls.push(['delete', name]); },
    async kickPath(name)       { calls.push(['kick', name]); },
  };
}

describe('RtmpRelayManager — camera-sourced (named feed) slots', () => {
  test('a camera-sourced slot fans out from the camera_key path, not the raw per-key ingest', async () => {
    const mtx = makeFakeMtx();
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: { available: true, hasLibx264: false, hasEia608: false, hasSubrip: false },
    });

    await mgr.start('projectkey', [
      { slot: 1, targetUrl: 'rtmp://a.example/live', targetName: 'main', sourceView: 'program' },
      { slot: 2, targetUrl: 'rtmp://b.example/live', targetName: 'teams', sourceCameraKey: 'altar-cam' },
    ]);

    const adds = mtx.calls.filter(c => c[0] === 'add');
    const cameraAdd = adds.find(c => c[1] === 'altar-cam');
    const rawAdd    = adds.find(c => c[1] === 'projectkey');
    assert.ok(cameraAdd, 'camera-sourced fan-out registered on the camera_key path');
    assert.ok(rawAdd, 'program fan-out still registered on the raw path');
    assert.match(cameraAdd[2].runOnPublish, /altar-cam/);
    assert.match(cameraAdd[2].runOnPublish, /b\.example\/live\/teams/);
    assert.ok(!cameraAdd[2].runOnPublish.includes('a.example'), 'program target not in the camera fan-out');

    assert.deepEqual(mgr.runningSlots('projectkey'), [1, 2]);
    assert.ok(mgr.isSlotRunning('projectkey', 2));

    await mgr.stop('projectkey');
    assert.ok(!mgr.isRunning('projectkey'));
    const deletes = mtx.calls.filter(c => c[0] === 'delete').map(c => c[1]);
    assert.ok(deletes.includes('altar-cam'));
    assert.ok(deletes.includes('projectkey'));
  });

  test('two distinct named feeds each get their own fan-out registration', async () => {
    const mtx = makeFakeMtx();
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: { available: true },
    });

    await mgr.start('projectkey', [
      { slot: 1, targetUrl: 'rtmp://teams.example/live', targetName: 't', sourceCameraKey: 'altar-cam' },
      { slot: 2, targetUrl: 'rtmp://obs.example/live', targetName: 'o', sourceCameraKey: 'lobby-cam' },
    ]);

    const adds = mtx.calls.filter(c => c[0] === 'add').map(c => c[1]);
    assert.ok(adds.includes('altar-cam'));
    assert.ok(adds.includes('lobby-cam'));
    assert.ok(!adds.includes('projectkey'), 'no raw-path fan-out when all slots are camera-sourced');
    assert.deepEqual(mgr.runningSlots('projectkey'), [1, 2]);

    await mgr.stop('projectkey');
    const deletes = mtx.calls.filter(c => c[0] === 'delete').map(c => c[1]);
    assert.ok(deletes.includes('altar-cam'));
    assert.ok(deletes.includes('lobby-cam'));
  });

  test('camera-sourced-only slot set works without any program slots, and end stats fire on stop', async () => {
    const mtx = makeFakeMtx();
    const ended = [];
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: { available: true },
      onStreamEnded: (apiKey, slot) => ended.push(slot),
    });

    await mgr.start('camonly', [
      { slot: 1, targetUrl: 'rtmp://v.example/live', targetName: 'x', sourceCameraKey: 'altar-cam' },
    ]);
    assert.ok(mgr.isRunning('camonly'));
    assert.deepEqual(mgr.runningSlots('camonly'), [1]);
    assert.ok(!mtx.calls.some(c => c[0] === 'add' && c[1] === 'camonly'), 'no raw-path fan-out');

    await mgr.stop('camonly');
    assert.deepEqual(ended, [1], 'end stats fired for the camera-sourced slot');
  });

  test('sourceCameraKey takes priority over sourceView when both are present', async () => {
    const mtx = makeFakeMtx();
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: { available: true },
    });

    await mgr.start('projectkey', [
      { slot: 1, targetUrl: 'rtmp://x.example/live', targetName: 'x', sourceView: 'crop', sourceCameraKey: 'altar-cam' },
    ]);

    const adds = mtx.calls.filter(c => c[0] === 'add').map(c => c[1]);
    assert.ok(adds.includes('altar-cam'));
    assert.ok(!adds.includes('projectkey-crop'), 'crop fan-out not registered — sourceCameraKey wins');

    await mgr.stop('projectkey');
  });

  test('with no MediaMTX client configured, camera-sourced slots are skipped (logged, not thrown)', async () => {
    const mgr = new RtmpRelayManager({
      ffmpegCaps: { available: true },
    });
    await assert.doesNotReject(mgr.start('projectkey', [
      { slot: 1, targetUrl: 'rtmp://x.example/live', targetName: 'x', sourceCameraKey: 'altar-cam' },
    ]));
  });
});
