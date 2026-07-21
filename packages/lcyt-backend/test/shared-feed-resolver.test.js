/**
 * Tests for createSharedFeedResolver (plan_video_perception.md Phase 3):
 * DeviceRegistry's onProgramChanged/onCameraPresetRecalled signals ->
 * feed -> active-camera tagging for shared/mixer-only cameras.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { createSharedFeedResolver } from '../src/shared-feed-resolver.js';
import { SHARED_FEED_CAMERA_ID } from 'lcyt-production';

let db;

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());

function insertCamera(id, mixerInput) {
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order)
    VALUES (?, ?, ?, 'visca-ip', '{}', 0)
  `).run(id, `Cam ${id}`, mixerInput);
}

function makeFakeRegistry() {
  const programChangedListeners = [];
  const presetRecalledListeners = [];
  return {
    onProgramChanged(cb) { programChangedListeners.push(cb); return () => {}; },
    onCameraPresetRecalled(cb) { presetRecalledListeners.push(cb); return () => {}; },
    notifyProgramChanged(data) { for (const cb of programChangedListeners) cb(data); },
    notifyCameraPresetRecalled(data) { for (const cb of presetRecalledListeners) cb(data); },
  };
}

describe('createSharedFeedResolver', () => {
  it('isSharedFeedDetection() identifies the sentinel cameraId', () => {
    const resolver = createSharedFeedResolver({ db, registry: makeFakeRegistry(), aggregator: { ingest: () => {} } });
    assert.equal(resolver.isSharedFeedDetection({ cameraId: SHARED_FEED_CAMERA_ID }), true);
    assert.equal(resolver.isSharedFeedDetection({ cameraId: 'cam-1' }), false);
  });

  it('tagSharedDetection() returns null (drop) before any program-changed event has fired', () => {
    const resolver = createSharedFeedResolver({ db, registry: makeFakeRegistry(), aggregator: { ingest: () => {} } });
    assert.equal(resolver.tagSharedDetection('key1', { cameraId: SHARED_FEED_CAMERA_ID, objects: [] }), null);
  });

  it('resolves the active camera from onProgramChanged via mixer_input, and re-tags subsequent detections', () => {
    const camId = randomUUID();
    insertCamera(camId, 3);
    const registry = makeFakeRegistry();
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: () => {} } });

    registry.notifyProgramChanged({ apiKey: 'key1', mixerId: 'm1', inputNumber: 3 });

    assert.equal(resolver.activeCameraFor('key1'), camId);
    const tagged = resolver.tagSharedDetection('key1', { cameraId: SHARED_FEED_CAMERA_ID, objects: [{ label: 'x', confidence: 0.5 }] });
    assert.equal(tagged.cameraId, camId);
    assert.deepEqual(tagged.objects, [{ label: 'x', confidence: 0.5 }]);
  });

  it('resolves the active camera directly from onCameraPresetRecalled', () => {
    const camId = randomUUID();
    const registry = makeFakeRegistry();
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: () => {} } });

    registry.notifyCameraPresetRecalled({ apiKey: 'key2', cameraId: camId, preset: 0 });

    assert.equal(resolver.activeCameraFor('key2'), camId);
  });

  it('emits a synthetic visible:false for the outgoing camera when the active camera changes', () => {
    const camA = randomUUID();
    const camB = randomUUID();
    insertCamera(camA, 1);
    insertCamera(camB, 2);
    const registry = makeFakeRegistry();
    const ingested = [];
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: (apiKey, detection) => ingested.push({ apiKey, detection }) } });

    registry.notifyProgramChanged({ apiKey: 'key3', mixerId: 'm1', inputNumber: 1 });
    assert.equal(ingested.length, 0, 'no outgoing-camera emission on the very first resolution');

    registry.notifyProgramChanged({ apiKey: 'key3', mixerId: 'm1', inputNumber: 2 });
    assert.equal(ingested.length, 1);
    assert.equal(ingested[0].apiKey, 'key3');
    assert.equal(ingested[0].detection.cameraId, camA);
    assert.equal(ingested[0].detection.visible, false);
    assert.equal(resolver.activeCameraFor('key3'), camB);
  });

  it('does not re-emit or change state when the program switches to the same input twice', () => {
    const camId = randomUUID();
    insertCamera(camId, 5);
    const registry = makeFakeRegistry();
    const ingested = [];
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: (apiKey, detection) => ingested.push({ apiKey, detection }) } });

    registry.notifyProgramChanged({ apiKey: 'key4', mixerId: 'm1', inputNumber: 5 });
    registry.notifyProgramChanged({ apiKey: 'key4', mixerId: 'm1', inputNumber: 5 });
    assert.equal(ingested.length, 0);
  });

  it('keeps per-project state isolated', () => {
    const camA = randomUUID();
    insertCamera(camA, 7);
    const registry = makeFakeRegistry();
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: () => {} } });

    registry.notifyProgramChanged({ apiKey: 'proj-a', mixerId: 'm1', inputNumber: 7 });
    assert.equal(resolver.activeCameraFor('proj-a'), camA);
    assert.equal(resolver.activeCameraFor('proj-b'), null);
  });
});
