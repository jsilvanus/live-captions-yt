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
