import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { createVisionSourceResolver } from '../src/vision-source-resolver.js';

describe('vision source resolver', () => {
  const db = new Database(':memory:'); runMigrations(db);
  const ins = (id, extra) => db.prepare(`INSERT INTO prod_cameras (id, name, control_type, control_config, sort_order, label, zone, camera_key, owner_api_key, overlap_links)
    VALUES (?, ?, 'webcam', '{}', 0, ?, ?, ?, ?, ?)`).run(id, `n-${id}`, extra.label ?? null, extra.zone ?? null, extra.key ?? null, extra.owner ?? null, extra.links ?? '[]');
  ins('a', { label: 'Choir', zone: 'left', key: 'a-key', owner: 'k1', links: JSON.stringify([{ cameraId: 'b', kind: 'overlaps_with' }]) });
  ins('b', { label: 'Pulpit' });
  const attributor = { tagForCapture: () => 'tag-capture', tagForCamera: (id) => `tag-${id}` };
  const r = createVisionSourceResolver({ db, attributor });

  it('delegates tags to the attributor', () => {
    assert.equal(r.tagForCapture('k1', 1), 'tag-capture');
    assert.equal(r.tagForCamera('a'), 'tag-a');
  });
  it('feed key and ownership', () => {
    assert.equal(r.feedKeyFor('a'), 'a-key');
    assert.equal(r.feedKeyFor('b'), null);
    assert.equal(r.cameraAllowed('k1', 'a'), true);
    assert.equal(r.cameraAllowed('k2', 'a'), false);
    assert.equal(r.cameraAllowed('k2', 'b'), true); // legacy unowned
    assert.equal(r.cameraAllowed('k1', 'nope'), false);
  });
  it('prompt context names the camera, zone and overlaps; none for a foreign camera', () => {
    assert.equal(r.cameraContext('k1', 'a'), 'This frame is from camera "Choir" (placed left). Its view can overlap with: Pulpit.');
    assert.equal(r.cameraContext('k2', 'a'), null);
  });
});

describe('vision source resolver - detector hints', () => {
  const db = new Database(':memory:'); runMigrations(db);
  let clock = 100000;
  const cams = {};
  const sceneState = { getState: () => ({ cameras: cams }) };
  const labelled = [];
  const r = createVisionSourceResolver({
    db, attributor: {}, sceneState, now: () => clock, aggregator: { labelTrack: (...a) => { labelled.push(a); return true; } },
  });

  it('describes fresh subjects with place, track and role; framing notes for the tracker get the trackId request', () => {
    cams.c = { visible: true, lastSeenAt: clock - 1000, framingNotes: ['head cut off'],
      subjects: [{ trackId: 't1', label: 'person', bbox: { x: 0.05, y: 0.0, w: 0.2, h: 0.4 }, role: 'preacher' }, { trackId: 't2', label: 'person', bbox: { x: 0.75, y: 0.6, w: 0.2, h: 0.3 } }] };
    const d = r.detectorHints('k', 'c', 'describer');
    assert.match(d, /sees 2 people: track t1 \(top left, already identified as preacher\); track t2 \(bottom right\)/);
    assert.match(d, /Framing notes: head cut off/);
    assert.doesNotMatch(d, /trackId/);
    assert.match(r.detectorHints('k', 'c', 'tracker'), /include its "trackId"/);
  });

  it('says so when no people are seen, and gives nothing for stale or unknown cameras', () => {
    cams.c = { visible: true, lastSeenAt: clock, subjects: [] };
    assert.match(r.detectorHints('k', 'c', 'describer'), /sees no people/);
    cams.c = { visible: true, lastSeenAt: clock - 60000, subjects: [{ trackId: 't', label: 'person', bbox: { x: 0, y: 0, w: 1, h: 1 } }] };
    assert.equal(r.detectorHints('k', 'c', 'describer'), null);
    assert.deepEqual(r.subjectsFor('k', 'c'), []);
    assert.equal(r.detectorHints('k', 'unknown', 'describer'), null);
  });

  it('labelTrack delegates to the aggregator', () => {
    r.labelTrack('k', 'c', 't1', 'preacher', 0.9);
    assert.deepEqual(labelled[0], ['k', 'c', 't1', 'preacher', 0.9]);
  });
});
