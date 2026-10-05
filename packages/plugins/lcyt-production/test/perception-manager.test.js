/**
 * Unit tests for perception-manager.js (plan_video_perception.md Phase 2
 * Stream B, lcyt-production half): perception jobs are dispatched to an
 * fffleet fleet (`FFFLEET_URL`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPerceptionManager, isPerceptionDispatchAvailable } from '../src/perception-manager.js';

const CAMERA = { id: 'cam-1', cameraKey: 'feed-abc' };

function fakeFleet() {
  const submitted = [];
  const fleet = {
    submitted,
    async submit(spec) {
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      const job = { id: spec.id, done, cancelled: false, cancelError: null, async cancel() { if (job.cancelError) throw job.cancelError; job.cancelled = true; finish({ state: 'cancelled' }); } };
      submitted.push({ spec, job });
      return job;
    },
  };
  return fleet;
}
const FLEET_ENV = { FFFLEET_URL: 'http://fleet', BACKEND_INTERNAL_TOKEN: 'tok' };
const mk = (fleet, extra = {}) => createPerceptionManager({
  previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env: FLEET_ENV, getFleetImpl: async () => fleet, ...extra,
});

describe('isPerceptionDispatchAvailable', () => {
  it('needs FFFLEET_URL (the orchestrator and worker daemon are gone)', () => {
    assert.equal(isPerceptionDispatchAvailable({}), false);
    assert.equal(isPerceptionDispatchAvailable({ ORCHESTRATOR_URL: 'http://o', WORKER_DAEMON_URL: 'http://w' }), false);
    assert.equal(isPerceptionDispatchAvailable({ FFFLEET_URL: 'http://fleet' }), true);
  });
});

describe('createPerceptionManager', () => {
  it('start() throws NOT_CONFIGURED when FFFLEET_URL is not set', async () => {
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env: {} });
    await assert.rejects(() => mgr.start('key1', CAMERA), (err) => err.code === 'NOT_CONFIGURED');
  });

  it('start() throws NO_FEED for a camera with no cameraKey', async () => {
    const mgr = mk(fakeFleet());
    await assert.rejects(() => mgr.start('key1', { id: 'cam-2', cameraKey: null }), (err) => err.code === 'NO_FEED');
  });

  it('stop() returns false for a camera with no running job', async () => {
    assert.equal(await mk(fakeFleet()).stop('cam-1'), false);
  });

  it('stop() keeps the job tracked and returns false when the cancel fails (code-review fix)', async () => {
    const fleet = fakeFleet();
    const mgr = mk(fleet);
    const { jobId } = await mgr.start('key1', CAMERA);
    fleet.submitted[0].job.cancelError = new Error('fleet unreachable');
    assert.equal(await mgr.stop('cam-1'), false, 'a failed remote stop must not report success');
    assert.equal(mgr.status('cam-1').jobId, jobId, 'the job stays tracked so it can be retried');
    fleet.submitted[0].job.cancelError = null;
    assert.equal(await mgr.stop('cam-1'), true);
    assert.equal(mgr.status('cam-1'), null);
  });

  it('start() is idempotent: a second start for the same camera submits no new job', async () => {
    const fleet = fakeFleet();
    const mgr = mk(fleet);
    const first = await mgr.start('key1', CAMERA);
    const second = await mgr.start('key1', CAMERA);
    assert.equal(fleet.submitted.length, 1);
    assert.equal(second.jobId, first.jobId);
    assert.equal(second.alreadyRunning, true);
  });

  describe('shared-feed dispatch (Phase 3)', () => {
    it('startSharedFeed() submits a job keyed by apiKey, not a camera', async () => {
      const fleet = fakeFleet();
      const mgr = mk(fleet);
      const { jobId } = await mgr.startSharedFeed('key1', { emitIntervalMs: 300 });
      const { perception } = fleet.submitted[0].spec;
      assert.equal(perception.cameraId, null);
      assert.equal(perception.feedKind, 'shared');
      assert.equal(perception.frameUrl, 'http://backend/preview/key1/incoming');
      assert.equal(perception.emitIntervalMs, 300);
      assert.equal(mgr.sharedFeedStatus('key1').jobId, jobId);
    });

    it("shared-feed and a dedicated camera's job don't collide even if the apiKey and camera id look alike", async () => {
      const mgr = mk(fakeFleet());
      await mgr.start('key1', { id: 'key1', cameraKey: 'feed-x' });
      await mgr.startSharedFeed('key1');
      assert.ok(mgr.status('key1'));
      assert.ok(mgr.sharedFeedStatus('key1'));
    });

    it('stopSharedFeed() cancels the shared job and clears status', async () => {
      const fleet = fakeFleet();
      const mgr = mk(fleet);
      await mgr.startSharedFeed('key1');
      assert.equal(await mgr.stopSharedFeed('key1'), true);
      assert.equal(fleet.submitted[0].job.cancelled, true);
      assert.equal(mgr.sharedFeedStatus('key1'), null);
    });
  });
});

describe('createPerceptionManager with FFFLEET_URL', () => {
  function fakeFleet() { // eslint-disable-line no-shadow
    const submitted = [];
    const fleet = {
      submitted,
      async submit(spec) {
        let finish;
        const done = new Promise((resolve) => { finish = resolve; });
        const job = { id: spec.id, done, cancelled: false, async cancel() { job.cancelled = true; finish({ state: 'cancelled' }); } };
        submitted.push({ spec, job });
        return job;
      },
    };
    return fleet;
  }
  const env = { FFFLEET_URL: 'http://fleet', BACKEND_INTERNAL_TOKEN: 'tok' };

  it('counts as available', () => {
    assert.equal(isPerceptionDispatchAvailable({ FFFLEET_URL: 'http://fleet' }), true);
  });

  it('submits a perception stream job and cancels it on stop()', async () => {
    const fleet = fakeFleet();
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env, getFleetImpl: async () => fleet });
    const { jobId } = await mgr.start('key1', CAMERA, { emitIntervalMs: 500 });
    const { spec, job } = fleet.submitted[0];
    assert.equal(spec.id, jobId);
    assert.equal(spec.kind, 'stream');
    assert.equal(spec.type, 'perception');
    assert.equal(spec.owner, 'key1');
    assert.equal(spec.perception.frameUrl, 'http://backend/preview/feed-abc/incoming');
    assert.equal(spec.perception.callbackUrl, 'http://backend/production/perception/ingest');
    assert.equal(spec.perception.internalToken, 'tok');
    assert.equal(spec.perception.emitIntervalMs, 500);
    assert.equal(spec.perception.type, undefined);
    assert.deepEqual(await mgr.start('key1', CAMERA), { jobId, alreadyRunning: true });
    assert.equal(await mgr.stop('cam-1'), true);
    assert.equal(job.cancelled, true);
    assert.equal(mgr.status('cam-1'), null);
  });

  it('forgets a job that ends by itself', async () => {
    const fleet = fakeFleet();
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env, getFleetImpl: async () => fleet });
    await mgr.start('key1', CAMERA);
    await fleet.submitted[0].job.cancel();
    await new Promise((r) => setImmediate(r));
    assert.equal(mgr.status('cam-1'), null);
  });
});

describe('createPerceptionManager stream url', () => {
  function fakeFleet() {
    const submitted = [];
    return {
      submitted,
      async submit(spec) {
        const job = { id: spec.id, done: new Promise(() => {}), async cancel() {} };
        submitted.push({ spec, job });
        return job;
      },
    };
  }
  const base = { FFFLEET_URL: 'http://fleet', BACKEND_INTERNAL_TOKEN: 'tok' };

  it('without PERCEPTION_STREAM_BASE_URL the job polls the snapshot only, at the slow default rate', async () => {
    const fleet = fakeFleet();
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env: base, getFleetImpl: async () => fleet });
    await mgr.start('key1', CAMERA);
    const { perception } = fleet.submitted[0].spec;
    assert.equal(perception.streamUrl, undefined);
    assert.equal(perception.emitIntervalMs, 1000);
  });

  it('with PERCEPTION_STREAM_BASE_URL a camera job reads its own stream and runs at 5 detections/s', async () => {
    const fleet = fakeFleet();
    const env = { ...base, PERCEPTION_STREAM_BASE_URL: 'rtsp://mediamtx:8554/', PERCEPTION_DETECT_FPS: '8' };
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env, getFleetImpl: async () => fleet });
    await mgr.start('key1', CAMERA);
    const { perception } = fleet.submitted[0].spec;
    assert.equal(perception.streamUrl, 'rtsp://mediamtx:8554/feed-abc');
    assert.equal(perception.detectFps, 8);
    assert.equal(perception.emitIntervalMs, 200);
    assert.equal(perception.frameUrl, 'http://backend/preview/feed-abc/incoming');
  });

  it('the shared-feed job reads the project stream', async () => {
    const fleet = fakeFleet();
    const env = { ...base, PERCEPTION_STREAM_BASE_URL: 'rtsp://mediamtx:8554' };
    const mgr = createPerceptionManager({ previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend', env, getFleetImpl: async () => fleet });
    await mgr.startSharedFeed('key1');
    assert.equal(fleet.submitted[0].spec.perception.streamUrl, 'rtsp://mediamtx:8554/key1');
  });
});

describe('createPerceptionManager — per-job token, persistence, re-adoption', () => {
  const base = { previewBaseUrl: 'http://backend', callbackBaseUrl: 'http://backend' };

  function fakeFleet() {
    const submitted = [];
    const jobs = new Map();
    return {
      submitted,
      async submit(spec) {
        submitted.push(spec);
        let h = jobs.get(spec.id);
        if (!h) {
          let resolve; let reject;
          const done = new Promise((res, rej) => { resolve = res; reject = rej; });
          done.catch(() => {});
          h = { id: spec.id, done, resolve, reject, cancel: async () => { h.resolve({ state: 'cancelled' }); } };
          jobs.set(spec.id, h);
        }
        return h;
      },
      jobs,
    };
  }

  async function newDb() {
    const { default: Database } = await import('better-sqlite3');
    const { runMigrations } = await import('../src/db.js');
    const db = new Database(':memory:'); runMigrations(db); return db;
  }

  it('mints a token scoped to this job and verifyIngest checks it', async () => {
    const fleet = fakeFleet();
    const mgr = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet' }, tokenSecret: 'sek', getFleetImpl: async () => fleet });
    await mgr.start('key1', CAMERA);
    const plan = fleet.submitted[0].perception;
    assert.ok(plan.internalToken && plan.internalToken.length >= 32);
    const scope = { apiKey: 'key1', cameraId: 'cam-1', feedKind: 'dedicated', jobId: plan.jobId };
    assert.equal(mgr.verifyIngest(scope, plan.internalToken), true);
    assert.equal(mgr.verifyIngest({ ...scope, cameraId: 'cam-2' }, plan.internalToken), false);
    assert.equal(mgr.verifyIngest({ ...scope, apiKey: 'other' }, plan.internalToken), false);
    assert.equal(mgr.verifyIngest(scope, 'nope'), false);
  });

  it('without a secret the shared token is used and verifyIngest is false', async () => {
    const fleet = fakeFleet();
    const mgr = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet', BACKEND_INTERNAL_TOKEN: 'shared' }, tokenSecret: null, getFleetImpl: async () => fleet });
    await mgr.start('key1', CAMERA);
    assert.equal(fleet.submitted[0].perception.internalToken, 'shared');
    assert.equal(mgr.verifyIngest({ apiKey: 'key1', jobId: 'x' }, 'shared'), false);
  });

  it('fleet jobs are recorded, forgotten on stop, and the spec carries jobId', async () => {
    const db = await newDb(); const fleet = fakeFleet();
    const mgr = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet' }, getFleetImpl: async () => fleet, db });
    const { jobId } = await mgr.start('key1', CAMERA);
    assert.equal(fleet.submitted[0].perception.jobId, jobId);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prod_perception_jobs').get().n, 1);
    assert.equal(await mgr.stop('cam-1'), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prod_perception_jobs').get().n, 0);
  });

  it('adopt() after a restart re-attaches with the same id: no duplicate job, no new id', async () => {
    const db = await newDb(); const fleet = fakeFleet();
    const first = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet' }, getFleetImpl: async () => fleet, db });
    const { jobId } = await first.start('key1', CAMERA);
    // "restart": a new manager over the same db and the same (still running) fleet
    const second = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet' }, getFleetImpl: async () => fleet, db });
    assert.equal(second.status('cam-1'), null);
    assert.deepEqual(await second.adopt(), { adopted: 1, dropped: 0 });
    assert.equal(second.status('cam-1').jobId, jobId);
    assert.equal(fleet.jobs.size, 1); // same job id, one job on the fleet
    // starting again is idempotent
    assert.equal((await second.start('key1', CAMERA)).alreadyRunning, true);
  });

  it('losing track of a job (shutdown) keeps its record; a job that ends by itself drops it', async () => {
    const db = await newDb(); const fleet = fakeFleet();
    const mgr = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet' }, getFleetImpl: async () => fleet, db });
    const { jobId } = await mgr.start('key1', CAMERA);
    fleet.jobs.get(jobId).reject(new Error('stopped following'));
    fleet.jobs.delete(jobId); // the fleet hands out a fresh follower when we re-attach
    await new Promise((r) => setImmediate(r));
    assert.equal(mgr.status('cam-1'), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prod_perception_jobs').get().n, 1);

    await mgr.adopt();
    fleet.jobs.get(jobId).resolve({ state: 'done' });
    await new Promise((r) => setImmediate(r));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prod_perception_jobs').get().n, 0);
  });

  it("adopt() drops records left by the retired orchestrator/worker daemon (mode 'legacy')", async () => {
    const db = await newDb(); const fleet = fakeFleet();
    db.prepare(`INSERT INTO prod_perception_jobs (job_key, api_key, job_id, mode, spec, started_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('cam-1', 'key1', 'old-job', 'legacy', '{}', new Date().toISOString());
    const mgr = createPerceptionManager({ ...base, env: { FFFLEET_URL: 'http://fleet' }, getFleetImpl: async () => fleet, db });
    assert.deepEqual(await mgr.adopt(), { adopted: 0, dropped: 1 });
    assert.equal(fleet.submitted.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prod_perception_jobs').get().n, 0);
  });
});
