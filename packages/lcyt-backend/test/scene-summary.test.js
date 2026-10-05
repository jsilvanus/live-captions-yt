import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { createSceneSummary } from '../src/scene-summary.js';

describe('scene summary', () => {
  const db = new Database(':memory:'); runMigrations(db);
  const ins = (id, name, label) => db.prepare(`INSERT INTO prod_cameras (id, name, control_type, control_config, sort_order, label) VALUES (?, ?, 'webcam', '{}', 0, ?)`).run(id, name, label);
  ins('c1', 'Cam 1', 'Choir'); ins('c2', 'Cam 2', null);
  let clock = 100000;
  const cameras = {};
  const tag = { cameraId: 'c1', method: 'mixer-signal', confidence: 1 };
  const summarise = createSceneSummary({ db, sceneState: { getState: () => ({ cameras }) }, attributor: { getTag: () => tag }, now: () => clock });

  it('returns null when nothing is known', () => {
    const empty = createSceneSummary({ db, sceneState: { getState: () => ({ cameras: {} }) }, now: () => clock });
    assert.equal(empty('k'), null);
  });

  it('names the camera on program and lists fresh cameras with people, roles and framing', () => {
    cameras.c1 = { visible: true, lastSeenAt: clock - 1000, framingScore: 0.72, framingNotes: ['head close to edge'],
      subjects: [{ label: 'person', bbox: { x: 0.05, y: 0.4, w: 0.2, h: 0.5 }, role: 'preacher' }, { label: 'person', bbox: { x: 0.75, y: 0.4, w: 0.2, h: 0.5 } }] };
    cameras.c2 = { visible: false, lastSeenAt: clock - 2000, subjects: [] };
    cameras.old = { visible: true, lastSeenAt: clock - 120000, subjects: [] };
    const text = summarise('k');
    assert.match(text, /^On program: camera "Choir" \(identified by mixer-signal, confidence 100%\)\./);
    assert.match(text, /- "Choir" \(on program\): 2 people \(middle left, preacher; middle right\), framing 0\.72 \[head close to edge\]/);
    assert.match(text, /- "Cam 2": no people seen/);
    assert.doesNotMatch(text, /old/);
  });
});
