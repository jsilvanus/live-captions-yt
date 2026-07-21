/**
 * Unit tests for perception-manager.js (plan_video_perception.md Phase 2
 * Stream B, lcyt-production half): job dispatch to the orchestrator or a
 * directly-configured worker daemon, mirroring FFMPEG_RUNNER=worker's own
 * two-knob config surface.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPerceptionManager, isPerceptionDispatchAvailable, SHARED_FEED_CAMERA_ID } from '../src/perception-manager.js';

const CAMERA = { id: 'cam-1', cameraKey: 'feed-abc' };

describe('isPerceptionDispatchAvailable', () => {
  it('false when neither ORCHESTRATOR_URL nor WORKER_DAEMON_URL is set', () => {
    assert.equal(isPerceptionDispatchAvailable({}), false);
  });
  it('true when either is set', () => {
    assert.equal(isPerceptionDispatchAvailable({ ORCHESTRATOR_URL: 'http://o' }), true);
    assert.equal(isPerceptionDispatchAvailable({ WORKER_DAEMON_URL: 'http://w' }), true);
  });
});

describe('createPerceptionManager', () => {
  it('start() throws NOT_CONFIGURED when no dispatch target is set', async () => {
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env: {} });
    await assert.rejects(() => mgr.start('key1', CAMERA), (err) => err.code === 'NOT_CONFIGURED');
  });

  it('start() throws NO_FEED for a camera with no cameraKey', async () => {
    const mgr = createPerceptionManager({
      previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
      env: { WORKER_DAEMON_URL: 'http://worker' },
    });
    await assert.rejects(() => mgr.start('key1', { id: 'cam-2', cameraKey: null }), (err) => err.code === 'NO_FEED');
  });

  it('dispatches directly to WORKER_DAEMON_URL/jobs when no orchestrator is configured', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ jobId: 'x' }) };
    };
    const mgr = createPerceptionManager({
      previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
      env: { WORKER_DAEMON_URL: 'http://worker', BACKEND_INTERNAL_TOKEN: 'tok' },
      fetchImpl,
    });

    const { jobId } = await mgr.start('key1', CAMERA, { emitIntervalMs: 500 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://worker/jobs');
    assert.equal(calls[0].init.headers['X-Worker-Auth'], 'tok');
    const plan = JSON.parse(calls[0].init.body);
    assert.equal(plan.type, 'perception');
    assert.equal(plan.apiKey, 'key1');
    assert.equal(plan.cameraId, 'cam-1');
    assert.equal(plan.frameUrl, 'http://backend/preview/feed-abc/incoming');
    assert.equal(plan.callbackUrl, 'http://backend/production/perception/ingest');
    assert.equal(plan.internalToken, 'tok');
    assert.equal(plan.emitIntervalMs, 500);
    assert.equal(mgr.status('cam-1').jobId, jobId);
  });

  it('prefers ORCHESTRATOR_URL/compute/jobs when both are configured', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
    const mgr = createPerceptionManager({
      previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
      env: { ORCHESTRATOR_URL: 'http://orch', WORKER_DAEMON_URL: 'http://worker', ORCHESTRATOR_INTERNAL_TOKEN: 'orch-tok' },
      fetchImpl,
    });

    await mgr.start('key1', CAMERA);
    assert.equal(calls[0].url, 'http://orch/compute/jobs');
    assert.equal(calls[0].init.headers['X-Internal-Auth'], 'orch-tok');
  });

  it('start() throws when the dispatch call is not ok', async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, text: async () => 'bad gateway' });
    const mgr = createPerceptionManager({
      previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
      env: { WORKER_DAEMON_URL: 'http://worker' },
      fetchImpl,
    });
    await assert.rejects(() => mgr.start('key1', CAMERA), /perception dispatch failed: 502/);
  });

  it('stop() is a no-op (returns false) for a camera with no running job, and deletes on the right path otherwise', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
    const mgr = createPerceptionManager({
      previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
      env: { WORKER_DAEMON_URL: 'http://worker' },
      fetchImpl,
    });

    assert.equal(await mgr.stop('cam-1'), false);

    const { jobId } = await mgr.start('key1', CAMERA);
    calls.length = 0;
    assert.equal(await mgr.stop('cam-1'), true);
    assert.equal(calls[0].url, `http://worker/jobs/${jobId}`);
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(mgr.status('cam-1'), null);
  });

  describe('shared-feed dispatch (Phase 3)', () => {
    it('startSharedFeed() dispatches a job keyed by apiKey, not a camera', async () => {
      const calls = [];
      const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
      const mgr = createPerceptionManager({
        previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
        env: { WORKER_DAEMON_URL: 'http://worker' },
        fetchImpl,
      });

      const { jobId } = await mgr.startSharedFeed('key1', { emitIntervalMs: 300 });
      const plan = JSON.parse(calls[0].init.body);
      assert.equal(plan.cameraId, SHARED_FEED_CAMERA_ID);
      assert.equal(plan.frameUrl, 'http://backend/preview/key1/incoming');
      assert.equal(plan.emitIntervalMs, 300);
      assert.deepEqual(mgr.sharedFeedStatus('key1'), { jobId, apiKey: 'key1', startedAt: mgr.sharedFeedStatus('key1').startedAt });
    });

    it('does not require a camera / cameraKey at all', async () => {
      const mgr = createPerceptionManager({
        previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
        env: { WORKER_DAEMON_URL: 'http://worker' },
        fetchImpl: async () => ({ ok: true }),
      });
      await assert.doesNotReject(() => mgr.startSharedFeed('key1'));
    });

    it("shared-feed and a dedicated camera's job don't collide even if the apiKey and camera id happen to look similar", async () => {
      const mgr = createPerceptionManager({
        previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
        env: { WORKER_DAEMON_URL: 'http://worker' },
        fetchImpl: async () => ({ ok: true }),
      });
      await mgr.start('key1', { id: 'key1', cameraKey: 'feed-x' });
      await mgr.startSharedFeed('key1');
      assert.ok(mgr.status('key1'));
      assert.ok(mgr.sharedFeedStatus('key1'));
    });

    it('stopSharedFeed() deletes the shared job and clears status', async () => {
      const calls = [];
      const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
      const mgr = createPerceptionManager({
        previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend',
        env: { WORKER_DAEMON_URL: 'http://worker' },
        fetchImpl,
      });
      const { jobId } = await mgr.startSharedFeed('key1');
      calls.length = 0;
      assert.equal(await mgr.stopSharedFeed('key1'), true);
      assert.equal(calls[0].url, `http://worker/jobs/${jobId}`);
      assert.equal(mgr.sharedFeedStatus('key1'), null);
    });
  });
});
