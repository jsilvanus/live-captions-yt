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

let db;

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());

function insertCamera(id, mixerInput, mixerId = null) {
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order, mixer_id)
    VALUES (?, ?, ?, 'visca-ip', '{}', 0, ?)
  `).run(id, `Cam ${id}`, mixerInput, mixerId);
}

function insertMixer(id) {
  db.prepare(`
    INSERT OR IGNORE INTO prod_mixers (id, name, type) VALUES (?, ?, 'lcyt')
  `).run(id, `Mixer ${id}`);
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
  it('isSharedFeedDetection() identifies detections by feedKind, not a sentinel cameraId', () => {
    const resolver = createSharedFeedResolver({ db, registry: makeFakeRegistry(), aggregator: { ingest: () => {} } });
    assert.equal(resolver.isSharedFeedDetection({ cameraId: null, feedKind: 'shared' }), true);
    assert.equal(resolver.isSharedFeedDetection({ cameraId: 'cam-1', feedKind: 'dedicated' }), false);
  });

  it('tagSharedDetection() returns null (drop) before any program-changed event has fired', () => {
    const resolver = createSharedFeedResolver({ db, registry: makeFakeRegistry(), aggregator: { ingest: () => {} } });
    assert.equal(resolver.tagSharedDetection('key1', { cameraId: null, feedKind: 'shared', objects: [] }), null);
  });

  it('resolves the active camera from onProgramChanged via mixer_input, and re-tags subsequent detections', () => {
    const camId = randomUUID();
    insertCamera(camId, 3);
    const registry = makeFakeRegistry();
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: () => {} } });

    registry.notifyProgramChanged({ apiKey: 'key1', mixerId: 'm1', inputNumber: 3 });

    assert.equal(resolver.activeCameraFor('key1'), camId);
    const tagged = resolver.tagSharedDetection('key1', { cameraId: null, feedKind: 'shared', objects: [{ label: 'x', confidence: 0.5 }] });
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

  it('does not cross-resolve to a different mixer\'s camera sharing the same inputNumber (code-review regression)', () => {
    insertMixer('mixer-a');
    insertMixer('mixer-b');
    const camOnMixerA = randomUUID();
    const camOnMixerB = randomUUID();
    insertCamera(camOnMixerA, 9, 'mixer-a');
    insertCamera(camOnMixerB, 9, 'mixer-b');
    const registry = makeFakeRegistry();
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: () => {} } });

    registry.notifyProgramChanged({ apiKey: 'proj-a', mixerId: 'mixer-a', inputNumber: 9 });
    assert.equal(resolver.activeCameraFor('proj-a'), camOnMixerA);

    registry.notifyProgramChanged({ apiKey: 'proj-b', mixerId: 'mixer-b', inputNumber: 9 });
    assert.equal(resolver.activeCameraFor('proj-b'), camOnMixerB);
    // proj-a's resolution must not have been disturbed by proj-b's event.
    assert.equal(resolver.activeCameraFor('proj-a'), camOnMixerA);
  });

  it('falls back to an unscoped (mixer_id IS NULL) legacy camera only when no mixer_id-scoped match exists', () => {
    insertMixer('mixer-x');
    insertMixer('mixer-y');
    const legacyCam = randomUUID();
    const scopedCam = randomUUID();
    insertCamera(legacyCam, 11, null);
    insertCamera(scopedCam, 11, 'mixer-x');
    const registry = makeFakeRegistry();
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: () => {} } });

    // A project whose mixer has an explicitly-scoped camera on this input
    // must resolve to that camera, never the unrelated legacy one.
    registry.notifyProgramChanged({ apiKey: 'proj-scoped', mixerId: 'mixer-x', inputNumber: 11 });
    assert.equal(resolver.activeCameraFor('proj-scoped'), scopedCam);

    // A different mixer with no scoped camera on this input falls back to
    // the legacy (mixer_id IS NULL) camera.
    registry.notifyProgramChanged({ apiKey: 'proj-legacy', mixerId: 'mixer-y', inputNumber: 11 });
    assert.equal(resolver.activeCameraFor('proj-legacy'), legacyCam);
  });
});
