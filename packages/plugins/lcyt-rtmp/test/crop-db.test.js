/**
 * DB-helper tests for src/db/crop.js — config, preset sets (incl. clone),
 * presets, source map, and follow-resolution specificity.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  runCropMigrations,
  getCropConfig, setCropConfig,
  listCropSets, createCropSet, updateCropSet, deleteCropSet,
  listCropPresets, getCropPreset, createCropPreset, updateCropPreset, deleteCropPreset,
  listCropSourceMap, createCropSourceMapEntry, deleteCropSourceMapEntry,
  resolveCropPresetForSource,
} from '../src/db/crop.js';

const KEY = 'testkey1';
let db;

beforeEach(() => {
  db = new Database(':memory:');
  runCropMigrations(db);
});

describe('crop_config', () => {
  test('defaults when no row exists', () => {
    const cfg = getCropConfig(db, KEY);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.aspectW, 9);
    assert.equal(cfg.aspectH, 16);
    assert.equal(cfg.followProgram, true);
    assert.equal(cfg.transitionMs, 0);
    assert.equal(cfg.activeSetId, null);
  });

  test('partial updates preserve other fields', () => {
    assert.equal(setCropConfig(db, KEY, { enabled: true, transitionMs: 300 }).ok, true);
    const r2 = setCropConfig(db, KEY, { videoBitrate: '4500k' });
    assert.equal(r2.ok, true);
    assert.equal(r2.config.enabled, true);
    assert.equal(r2.config.transitionMs, 300);
    assert.equal(r2.config.videoBitrate, '4500k');
  });

  test('rejects invalid values', () => {
    assert.equal(setCropConfig(db, KEY, { aspectW: 0 }).ok, false);
    assert.equal(setCropConfig(db, KEY, { transitionMs: -5 }).ok, false);
    assert.equal(setCropConfig(db, KEY, { videoBitrate: '; rm -rf /' }).ok, false);
    assert.equal(setCropConfig(db, KEY, { activeSetId: 'nope' }).ok, false);
  });
});

describe('preset sets', () => {
  test('create, list, rename, unique names', () => {
    const a = createCropSet(db, KEY, { name: 'Sermon' });
    assert.equal(a.ok, true);
    assert.equal(createCropSet(db, KEY, { name: 'Sermon' }).ok, false);
    const b = createCropSet(db, KEY, { name: 'Concert', sortOrder: 1 });
    assert.equal(b.ok, true);
    assert.deepEqual(listCropSets(db, KEY).map(s => s.name), ['Sermon', 'Concert']);

    const renamed = updateCropSet(db, KEY, a.set.id, { name: 'Sunday' });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.set.name, 'Sunday');
  });

  test('clone copies presets and their source-map rows', () => {
    const a = createCropSet(db, KEY, { name: 'A' });
    const p = createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.2, setId: a.set.id });
    createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: p.preset.id });

    const b = createCropSet(db, KEY, { name: 'B', cloneFromSetId: a.set.id });
    assert.equal(b.ok, true);
    const clonedPresets = listCropPresets(db, KEY, { setId: b.set.id });
    assert.equal(clonedPresets.length, 1);
    assert.equal(clonedPresets[0].name, 'lectern');
    assert.equal(clonedPresets[0].xNorm, 0.2);
    assert.notEqual(clonedPresets[0].id, p.preset.id);

    const maps = listCropSourceMap(db, KEY);
    assert.equal(maps.length, 2);
    assert.ok(maps.some(m => m.presetId === clonedPresets[0].id));
  });

  test('delete cascades presets, source-map rows, and clears active_set_id', () => {
    const a = createCropSet(db, KEY, { name: 'A' });
    const p = createCropPreset(db, KEY, { name: 'x', setId: a.set.id });
    createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: p.preset.id });
    setCropConfig(db, KEY, { activeSetId: a.set.id });

    assert.equal(deleteCropSet(db, KEY, a.set.id), true);
    assert.equal(listCropSets(db, KEY).length, 0);
    assert.equal(listCropPresets(db, KEY, { setId: a.set.id }).length, 0);
    assert.equal(listCropSourceMap(db, KEY).length, 0);
    assert.equal(getCropConfig(db, KEY).activeSetId, null);
  });

  test('sets are scoped per api_key', () => {
    createCropSet(db, KEY, { name: 'Mine' });
    assert.equal(listCropSets(db, 'otherkey').length, 0);
    assert.equal(createCropSet(db, 'otherkey', { name: 'Mine' }).ok, true);
  });
});

describe('presets', () => {
  test('CRUD with clamped normalised positions', () => {
    const created = createCropPreset(db, KEY, { name: 'wide', xNorm: 1.7, yNorm: -0.2 });
    assert.equal(created.ok, true);
    assert.equal(created.preset.xNorm, 1);
    assert.equal(created.preset.yNorm, 0);
    assert.equal(created.preset.setId, null);

    const updated = updateCropPreset(db, KEY, created.preset.id, { xNorm: 0.25 });
    assert.equal(updated.preset.xNorm, 0.25);
    assert.equal(updated.preset.name, 'wide');

    assert.equal(deleteCropPreset(db, KEY, created.preset.id), true);
    assert.equal(getCropPreset(db, KEY, created.preset.id), null);
  });

  test('listCropPresets defaults to the ACTIVE set', () => {
    const a = createCropSet(db, KEY, { name: 'A' });
    createCropPreset(db, KEY, { name: 'default-set-preset' });          // set_id NULL
    createCropPreset(db, KEY, { name: 'a-preset', setId: a.set.id });

    // No active set → implicit default set (NULL)
    assert.deepEqual(listCropPresets(db, KEY).map(p => p.name), ['default-set-preset']);

    setCropConfig(db, KEY, { activeSetId: a.set.id });
    assert.deepEqual(listCropPresets(db, KEY).map(p => p.name), ['a-preset']);
  });

  test('duplicate name in the same set rejected; same name across sets fine', () => {
    const a = createCropSet(db, KEY, { name: 'A' });
    assert.equal(createCropPreset(db, KEY, { name: 'p', setId: a.set.id }).ok, true);
    assert.equal(createCropPreset(db, KEY, { name: 'p', setId: a.set.id }).ok, false);
    assert.equal(createCropPreset(db, KEY, { name: 'p' }).ok, true); // default set
  });

  test('deleting a preset removes its source-map rows', () => {
    const p = createCropPreset(db, KEY, { name: 'p' });
    createCropSourceMapEntry(db, KEY, { mixerInput: 3, presetId: p.preset.id });
    deleteCropPreset(db, KEY, p.preset.id);
    assert.equal(listCropSourceMap(db, KEY).length, 0);
  });
});

describe('source map + resolution', () => {
  test('requires a preset and at least one source selector', () => {
    assert.equal(createCropSourceMapEntry(db, KEY, { mixerInput: 1 }).ok, false);
    const p = createCropPreset(db, KEY, { name: 'p' });
    assert.equal(createCropSourceMapEntry(db, KEY, { presetId: p.preset.id }).ok, false);
    assert.equal(createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: p.preset.id }).ok, true);
  });

  test('camera 1/preset 1 → camera 2 → camera 1/preset 2 each resolve their own crop', () => {
    const posA = createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.1 }).preset;
    const posB = createCropPreset(db, KEY, { name: 'centre',  xNorm: 0.5 }).preset;
    const posC = createCropPreset(db, KEY, { name: 'piano',   xNorm: 0.9 }).preset;

    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 1, presetId: posA.id });
    createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: posB.id });                    // camera 2's input
    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 2, presetId: posC.id });

    assert.equal(resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 1 })?.id, posA.id);
    assert.equal(resolveCropPresetForSource(db, KEY, { mixerInput: 2 })?.id, posB.id);
    assert.equal(resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 2 })?.id, posC.id);
    assert.equal(resolveCropPresetForSource(db, KEY, { cameraId: 'cam9' }), null);
  });

  test('camera+preset beats camera-only beats mixer-input rows', () => {
    const low  = createCropPreset(db, KEY, { name: 'low' }).preset;
    const mid  = createCropPreset(db, KEY, { name: 'mid' }).preset;
    const high = createCropPreset(db, KEY, { name: 'high' }).preset;

    createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: low.id });
    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', presetId: mid.id });
    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 4, presetId: high.id });

    const resolved = resolveCropPresetForSource(db, KEY, { mixerInput: 1, cameraId: 'cam1', cameraPreset: 4 });
    assert.equal(resolved?.id, high.id);

    const noPtz = resolveCropPresetForSource(db, KEY, { mixerInput: 1, cameraId: 'cam1', cameraPreset: 9 });
    assert.equal(noPtz?.id, mid.id);

    const otherCam = resolveCropPresetForSource(db, KEY, { mixerInput: 1, cameraId: 'cam2' });
    assert.equal(otherCam?.id, low.id);
  });

  test('resolution is scoped to the ACTIVE set', () => {
    const setA = createCropSet(db, KEY, { name: 'A' }).set;
    const inA   = createCropPreset(db, KEY, { name: 'p', setId: setA.id, xNorm: 0.3 }).preset;
    const inDef = createCropPreset(db, KEY, { name: 'p', xNorm: 0.7 }).preset;
    createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: inA.id });
    createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: inDef.id });

    // Default set active → only the default-set preset's row matches
    assert.equal(resolveCropPresetForSource(db, KEY, { mixerInput: 1 })?.id, inDef.id);

    setCropConfig(db, KEY, { activeSetId: setA.id });
    assert.equal(resolveCropPresetForSource(db, KEY, { mixerInput: 1 })?.id, inA.id);
  });

  test('delete entry', () => {
    const p = createCropPreset(db, KEY, { name: 'p' });
    const e = createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: p.preset.id });
    assert.equal(deleteCropSourceMapEntry(db, KEY, e.entry.id), true);
    assert.equal(deleteCropSourceMapEntry(db, KEY, e.entry.id), false);
  });

  test('string-typed numeric values (JSON bodies) are coerced on insert and resolve', () => {
    const p = createCropPreset(db, KEY, { name: 'p' });

    // Stored as strings → normalised to integers
    const e = createCropSourceMapEntry(db, KEY, { mixerInput: '2', cameraId: 'cam1', cameraPreset: '3', presetId: p.preset.id });
    assert.equal(e.ok, true);
    assert.equal(e.entry.mixerInput, 2);
    assert.equal(e.entry.cameraPreset, 3);

    // Queried as strings → still resolves
    assert.equal(resolveCropPresetForSource(db, KEY, { mixerInput: '2', cameraId: 'cam1', cameraPreset: '3' })?.id, p.preset.id);
    // Queried as numbers against string-inserted rows → still resolves
    assert.equal(resolveCropPresetForSource(db, KEY, { mixerInput: 2, cameraId: 'cam1', cameraPreset: 3 })?.id, p.preset.id);
  });

  test('non-integer mixerInput/cameraPreset are rejected on insert', () => {
    const p = createCropPreset(db, KEY, { name: 'p' });
    assert.equal(createCropSourceMapEntry(db, KEY, { mixerInput: 'abc', presetId: p.preset.id }).ok, false);
    assert.equal(createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 1.5, presetId: p.preset.id }).ok, false);
  });
});
