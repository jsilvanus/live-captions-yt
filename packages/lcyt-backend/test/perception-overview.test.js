import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { createPerceptionOverview } from '../src/perception-overview.js';

describe('perception overview', () => {
  const db = new Database(':memory:'); runMigrations(db);
  const ins = (id, name, label, key, owner, enabled) => db.prepare(`INSERT INTO prod_cameras (id, name, control_type, control_config, sort_order, label, camera_key, owner_api_key, perception_enabled)
    VALUES (?, ?, 'webcam', '{}', 0, ?, ?, ?, ?)`).run(id, name, label, key, owner, enabled);
  ins('a', 'Cam A', 'Choir', 'a-key', 'k1', 1);
  ins('b', 'Cam B', null, null, null, 0);
  ins('x', 'Foreign', null, 'x-key', 'k2', 1);
  const clock = 50000;
  const overview = createPerceptionOverview({
    db, now: () => clock,
    sceneState: { getState: () => ({ cameras: { a: { visible: true, lastSeenAt: clock - 800, framingScore: 0.7, framingNotes: ['tight'], subjects: [{ label: 'person', role: 'preacher' }, { label: 'person' }, { label: 'chair' }] } } }) },
    attributor: { status: () => ({ running: true, tag: { cameraId: 'a', method: 'mixer-signal' } }) },
    perceptionManager: { status: (id) => (id === 'a' ? { jobId: 'j' } : null), sharedFeedStatus: () => null },
    sharedAutostart: { get: () => true },
  });

  it("lists this project's cameras (and unowned ones) with job, switch, program and detector state", () => {
    const o = overview('k1');
    assert.deepEqual(o.cameras.map((c) => c.id), ['a', 'b']);
    const a = o.cameras[0];
    assert.equal(a.name, 'Choir'); assert.equal(a.hasFeed, true); assert.equal(a.perceptionEnabled, true);
    assert.equal(a.jobRunning, true); assert.equal(a.onProgram, true);
    assert.deepEqual(a.scene, { visible: true, people: 2, roles: ['preacher'], framingScore: 0.7, framingNotes: ['tight'], ageMs: 800 });
    const b = o.cameras[1];
    assert.equal(b.name, 'Cam B'); assert.equal(b.jobRunning, false); assert.equal(b.onProgram, false); assert.equal(b.scene, null);
  });

  it('carries the shared-feed job state and the attribution status', () => {
    const o = overview('k1');
    assert.deepEqual(o.shared, { running: false, auto: true });
    assert.equal(o.attribution.tag.method, 'mixer-signal');
  });
});
