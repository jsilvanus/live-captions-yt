import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import { createPerceptionAutostart, setSharedAutostart, getSharedAutostart } from '../src/perception-autostart.js';

function fakeManager() {
  const jobs = new Map();
  const calls = [];
  return {
    calls,
    status: (id) => jobs.get(String(id)) ?? null,
    sharedFeedStatus: (k) => jobs.get(`shared:${k}`) ?? null,
    async start(apiKey, cam) { calls.push(['start', apiKey, String(cam.id)]); jobs.set(String(cam.id), { jobId: 'j' }); return { jobId: 'j' }; },
    async stop(id) { calls.push(['stop', String(id)]); return jobs.delete(String(id)); },
    async startSharedFeed(k) { calls.push(['startShared', k]); jobs.set(`shared:${k}`, { jobId: 's' }); return { jobId: 's' }; },
    async stopSharedFeed(k) { calls.push(['stopShared', k]); return jobs.delete(`shared:${k}`); },
  };
}

describe('perception auto-start', () => {
  let db, manager, live, autostart;
  const mediamtx = { isPathPublishing: async (p) => { if (live instanceof Error) throw live; return !!live[p]; } };

  function addCamera(id, key, owner, enabled = 1) {
    db.prepare(`INSERT INTO prod_cameras (id, name, control_type, control_config, sort_order, camera_key, owner_api_key, perception_enabled)
      VALUES (?, ?, 'webcam', '{}', 0, ?, ?, ?)`).run(id, id, key, owner, enabled);
  }

  beforeEach(() => {
    db = new Database(':memory:'); runMigrations(db);
    manager = fakeManager(); live = {};
    autostart = createPerceptionAutostart({ db, manager, mediamtxClient: mediamtx, graceCycles: 2, log: () => {} });
  });

  it('starts a job when the feed goes live and stops it after the grace cycles', async () => {
    addCamera('c1', 'c1-key', 'k1');
    await autostart.tick();
    assert.deepEqual(manager.calls, []); // not live yet
    live['c1-key'] = true;
    await autostart.tick();
    assert.deepEqual(manager.calls, [['start', 'k1', 'c1']]);
    await autostart.tick();
    assert.equal(manager.calls.length, 1); // already running: no duplicate
    live['c1-key'] = false;
    await autostart.tick(); // 1st quiet cycle: grace
    assert.equal(manager.calls.length, 1);
    await autostart.tick(); // 2nd: stop
    assert.deepEqual(manager.calls[1], ['stop', 'c1']);
  });

  it('a short dropout inside the grace period does not stop the job', async () => {
    addCamera('c1', 'c1-key', 'k1');
    live['c1-key'] = true; await autostart.tick();
    live['c1-key'] = false; await autostart.tick();
    live['c1-key'] = true; await autostart.tick();
    live['c1-key'] = false; await autostart.tick();
    assert.equal(manager.calls.filter((c) => c[0] === 'stop').length, 0);
  });

  it('does nothing when liveness cannot be determined', async () => {
    addCamera('c1', 'c1-key', 'k1');
    live = new Error('media server down');
    await autostart.tick();
    assert.deepEqual(manager.calls, []);
  });

  it('ignores cameras that are not switched on, or that have no owning project', async () => {
    addCamera('c1', 'c1-key', 'k1', 0);
    addCamera('c2', 'c2-key', null, 1);
    live['c1-key'] = true; live['c2-key'] = true;
    await autostart.tick();
    assert.deepEqual(manager.calls, []);
  });

  it('a job started by hand for a camera that was never switched on is left alone', async () => {
    addCamera('c1', 'c1-key', 'k1', 0);
    await manager.start('k1', { id: 'c1' });
    await autostart.tick(); await autostart.tick(); await autostart.tick();
    assert.equal(manager.calls.filter((c) => c[0] === 'stop').length, 0);
  });

  it('switching a camera off stops the job the reconciler started', async () => {
    addCamera('c1', 'c1-key', 'k1');
    live['c1-key'] = true; await autostart.tick();
    db.prepare('UPDATE prod_cameras SET perception_enabled = 0 WHERE id = ?').run('c1');
    await autostart.tick();
    assert.deepEqual(manager.calls[manager.calls.length - 1], ['stop', 'c1']);
  });

  it('shared feed follows the project switch and the program feed', async () => {
    assert.equal(getSharedAutostart(db, 'k1'), false);
    setSharedAutostart(db, 'k1', true);
    assert.equal(getSharedAutostart(db, 'k1'), true);
    live.k1 = true;
    await autostart.tick();
    assert.deepEqual(manager.calls, [['startShared', 'k1']]);
    setSharedAutostart(db, 'k1', false);
    await autostart.tick();
    assert.deepEqual(manager.calls[1], ['stopShared', 'k1']);
  });
});
