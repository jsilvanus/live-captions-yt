import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCropFollowController } from '../src/crop-follow-controller.js';
import { targetCenter, xNormForCenter, createFollowSmoother } from '../../plugins/lcyt-rtmp/src/crop-follow.js';

const person = (x, extra = {}) => ({ label: 'person', bbox: { x, y: 0.2, w: 0.08, h: 0.6 }, confidence: 0.9, ...extra });

describe('crop follow controller', () => {
  let cfg, running, status, tag, applied, tapFn, clock, ctl;

  beforeEach(() => {
    cfg = { enabled: true, autoFollow: true };
    running = true;
    status = { running: true, inW: 1920, cropW: 608, xNorm: 0.5, yNorm: 0, activePresetId: null };
    tag = { cameraId: 'c1' };
    applied = []; clock = 1000;
    ctl = createCropFollowController({
      db: {}, eventBus: { tap: (fn) => { tapFn = fn; return () => {}; } },
      cropManager: { isRunning: () => running, getStatus: () => status, applyPosition: async (k, p) => { applied.push(p); } },
      attributor: { getTag: () => tag },
      getCropConfig: () => cfg,
      follow: { targetCenter, xNormForCenter, createFollowSmoother },
      preferRoles: ['preacher'], now: () => clock,
    });
  });

  const send = (data, projectId = 'k') => tapFn({ topic: 'camera.track_state', projectId, data: { cameraId: 'c1', visible: true, ...data } });
  const settle = () => new Promise((r) => setImmediate(r));

  it('moves the window toward a person on the camera on program', async () => {
    send({ subjects: [person(0.8)] });
    await settle();
    assert.equal(applied.length, 1);
    assert.ok(applied[0].xNorm > 0.8, `xNorm ${applied[0].xNorm}`);
    assert.equal(applied[0].activePresetId, null);
  });

  it('does nothing when off, not running, or for a camera that is not on program', async () => {
    cfg.autoFollow = false; send({ subjects: [person(0.8)] });
    cfg.autoFollow = true; running = false; send({ subjects: [person(0.8)] });
    running = true; tag = { cameraId: 'other' }; send({ subjects: [person(0.8)] });
    tag = { cameraId: null }; send({ subjects: [person(0.8)] });
    await settle();
    assert.equal(applied.length, 0);
  });

  it('leaves the window alone with nobody detected or a camera that is not visible', async () => {
    send({ subjects: [] });
    send({ subjects: [person(0.8)], visible: false });
    await settle();
    assert.equal(applied.length, 0);
  });

  it('ignores other event topics', async () => {
    tapFn({ topic: 'something.else', projectId: 'k', data: { cameraId: 'c1', visible: true, subjects: [person(0.8)] } });
    await settle();
    assert.equal(applied.length, 0);
  });

  it('a preferred role wins; a small drift inside the dead band does not move the window', async () => {
    send({ subjects: [person(0.05), person(0.8, { role: 'preacher' })] });
    await settle();
    assert.ok(applied[0].xNorm > 0.8);
    clock += 5000; status = { ...status, xNorm: applied[0].xNorm };
    send({ subjects: [person(0.805, { role: 'preacher' })] });
    await settle();
    assert.equal(applied.length, 1);
  });
});
