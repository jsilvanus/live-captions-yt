/**
 * DB-helper tests for src/db/crop.js — config, preset sets (incl. clone),
 * presets, source map, and follow-resolution specificity.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import {
  getCropConfig, setCropConfig,
  listCropSets, createCropSet, updateCropSet, deleteCropSet,
  listCropPresets, getCropPreset, createCropPreset, updateCropPreset, deleteCropPreset,
  listCropSourceMap, createCropSourceMapEntry, deleteCropSourceMapEntry,
  resolveCropPresetForSource, resolveCameraIdForMixerInput,
} from '../src/db/crop.js';

const KEY = 'testkey1';
let db;

beforeEach(async () => {
  db = await initDb(':memory:');
});

afterEach(async () => {
  await db.close();
});

describe('crop_config', () => {
  test('defaults when no row exists', async () => {
    const cfg = await getCropConfig(db, KEY);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.aspectW, 9);
    assert.equal(cfg.aspectH, 16);
    assert.equal(cfg.followProgram, true);
    assert.equal(cfg.transitionMs, 0);
    assert.equal(cfg.activeSetId, null);
    assert.equal(cfg.autoFollow, false);
  });

  test('autoFollow is opt-in and persists', async () => {
    assert.equal((await setCropConfig(db, KEY, { autoFollow: true })).config.autoFollow, true);
    assert.equal((await setCropConfig(db, KEY, { transitionMs: 100 })).config.autoFollow, true);
    assert.equal((await setCropConfig(db, KEY, { autoFollow: false })).config.autoFollow, false);
  });

  test('partial updates preserve other fields', async () => {
    assert.equal((await setCropConfig(db, KEY, { enabled: true, transitionMs: 300 })).ok, true);
    const r2 = await setCropConfig(db, KEY, { videoBitrate: '4500k' });
    assert.equal(r2.ok, true);
    assert.equal(r2.config.enabled, true);
    assert.equal(r2.config.transitionMs, 300);
    assert.equal(r2.config.videoBitrate, '4500k');
  });

  test('rejects invalid values', async () => {
    assert.equal((await setCropConfig(db, KEY, { aspectW: 0 })).ok, false);
    assert.equal((await setCropConfig(db, KEY, { transitionMs: -5 })).ok, false);
    assert.equal((await setCropConfig(db, KEY, { videoBitrate: '; rm -rf /' })).ok, false);
    assert.equal((await setCropConfig(db, KEY, { activeSetId: 'nope' })).ok, false);
  });
});

describe('preset sets', () => {
  test('create, list, rename, unique names', async () => {
    const a = await createCropSet(db, KEY, { name: 'Sermon' });
    assert.equal(a.ok, true);
    assert.equal((await createCropSet(db, KEY, { name: 'Sermon' })).ok, false);
    const b = await createCropSet(db, KEY, { name: 'Concert', sortOrder: 1 });
    assert.equal(b.ok, true);
    assert.deepEqual((await listCropSets(db, KEY)).map(s => s.name), ['Sermon', 'Concert']);

    const renamed = await updateCropSet(db, KEY, a.set.id, { name: 'Sunday' });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.set.name, 'Sunday');
  });

  test('clone copies presets and their source-map rows', async () => {
    const a = await createCropSet(db, KEY, { name: 'A' });
    const p = await createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.2, setId: a.set.id });
    await createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: p.preset.id });

    const b = await createCropSet(db, KEY, { name: 'B', cloneFromSetId: a.set.id });
    assert.equal(b.ok, true);
    const clonedPresets = await listCropPresets(db, KEY, { setId: b.set.id });
    assert.equal(clonedPresets.length, 1);
    assert.equal(clonedPresets[0].name, 'lectern');
    assert.equal(clonedPresets[0].xNorm, 0.2);
    assert.notEqual(clonedPresets[0].id, p.preset.id);

    const maps = await listCropSourceMap(db, KEY);
    assert.equal(maps.length, 2);
    assert.ok(maps.some(m => m.presetId === clonedPresets[0].id));
  });

  test('delete cascades presets, source-map rows, and clears active_set_id', async () => {
    const a = await createCropSet(db, KEY, { name: 'A' });
    const p = await createCropPreset(db, KEY, { name: 'x', setId: a.set.id });
    await createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: p.preset.id });
    await setCropConfig(db, KEY, { activeSetId: a.set.id });

    assert.equal(await deleteCropSet(db, KEY, a.set.id), true);
    assert.equal((await listCropSets(db, KEY)).length, 0);
    assert.equal((await listCropPresets(db, KEY, { setId: a.set.id })).length, 0);
    assert.equal((await listCropSourceMap(db, KEY)).length, 0);
    assert.equal((await getCropConfig(db, KEY)).activeSetId, null);
  });

  test('sets are scoped per api_key', async () => {
    await createCropSet(db, KEY, { name: 'Mine' });
    assert.equal((await listCropSets(db, 'otherkey')).length, 0);
    assert.equal((await createCropSet(db, 'otherkey', { name: 'Mine' })).ok, true);
  });
});

describe('presets', () => {
  test('CRUD with clamped normalised positions', async () => {
    const created = await createCropPreset(db, KEY, { name: 'wide', xNorm: 1.7, yNorm: -0.2 });
    assert.equal(created.ok, true);
    assert.equal(created.preset.xNorm, 1);
    assert.equal(created.preset.yNorm, 0);
    assert.equal(created.preset.setId, null);

    const updated = await updateCropPreset(db, KEY, created.preset.id, { xNorm: 0.25 });
    assert.equal(updated.preset.xNorm, 0.25);
    assert.equal(updated.preset.name, 'wide');

    assert.equal(await deleteCropPreset(db, KEY, created.preset.id), true);
    assert.equal(await getCropPreset(db, KEY, created.preset.id), null);
  });

  test('listCropPresets defaults to the ACTIVE set', async () => {
    const a = await createCropSet(db, KEY, { name: 'A' });
    await createCropPreset(db, KEY, { name: 'default-set-preset' });          // set_id NULL
    await createCropPreset(db, KEY, { name: 'a-preset', setId: a.set.id });

    // No active set → implicit default set (NULL)
    assert.deepEqual((await listCropPresets(db, KEY)).map(p => p.name), ['default-set-preset']);

    await setCropConfig(db, KEY, { activeSetId: a.set.id });
    assert.deepEqual((await listCropPresets(db, KEY)).map(p => p.name), ['a-preset']);
  });

  test('duplicate name in the same set rejected; same name across sets fine', async () => {
    const a = await createCropSet(db, KEY, { name: 'A' });
    assert.equal((await createCropPreset(db, KEY, { name: 'p', setId: a.set.id })).ok, true);
    assert.equal((await createCropPreset(db, KEY, { name: 'p', setId: a.set.id })).ok, false);
    assert.equal((await createCropPreset(db, KEY, { name: 'p' })).ok, true); // default set
  });

  test('deleting a preset removes its source-map rows', async () => {
    const p = await createCropPreset(db, KEY, { name: 'p' });
    await createCropSourceMapEntry(db, KEY, { mixerInput: 3, presetId: p.preset.id });
    await deleteCropPreset(db, KEY, p.preset.id);
    assert.equal((await listCropSourceMap(db, KEY)).length, 0);
  });
});

describe('source map + resolution', () => {
  test('requires a preset and at least one source selector', async () => {
    assert.equal((await createCropSourceMapEntry(db, KEY, { mixerInput: 1 })).ok, false);
    const p = await createCropPreset(db, KEY, { name: 'p' });
    assert.equal((await createCropSourceMapEntry(db, KEY, { presetId: p.preset.id })).ok, false);
    assert.equal((await createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: p.preset.id })).ok, true);
  });

  test('camera 1/preset 1 → camera 2 → camera 1/preset 2 each resolve their own crop', async () => {
    const posA = (await createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.1 })).preset;
    const posB = (await createCropPreset(db, KEY, { name: 'centre',  xNorm: 0.5 })).preset;
    const posC = (await createCropPreset(db, KEY, { name: 'piano',   xNorm: 0.9 })).preset;

    await createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 1, presetId: posA.id });
    await createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: posB.id });                    // camera 2's input
    await createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 2, presetId: posC.id });

    assert.equal((await resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 1 }))?.id, posA.id);
    assert.equal((await resolveCropPresetForSource(db, KEY, { mixerInput: 2 }))?.id, posB.id);
    assert.equal((await resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 2 }))?.id, posC.id);
    assert.equal(await resolveCropPresetForSource(db, KEY, { cameraId: 'cam9' }), null);
  });

  test('camera+preset beats camera-only beats mixer-input rows', async () => {
    const low  = (await createCropPreset(db, KEY, { name: 'low' })).preset;
    const mid  = (await createCropPreset(db, KEY, { name: 'mid' })).preset;
    const high = (await createCropPreset(db, KEY, { name: 'high' })).preset;

    await createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: low.id });
    await createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', presetId: mid.id });
    await createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 4, presetId: high.id });

    const resolved = await resolveCropPresetForSource(db, KEY, { mixerInput: 1, cameraId: 'cam1', cameraPreset: 4 });
    assert.equal(resolved?.id, high.id);

    const noPtz = await resolveCropPresetForSource(db, KEY, { mixerInput: 1, cameraId: 'cam1', cameraPreset: 9 });
    assert.equal(noPtz?.id, mid.id);

    const otherCam = await resolveCropPresetForSource(db, KEY, { mixerInput: 1, cameraId: 'cam2' });
    assert.equal(otherCam?.id, low.id);
  });

  test('resolution is scoped to the ACTIVE set', async () => {
    const setA = (await createCropSet(db, KEY, { name: 'A' })).set;
    const inA   = (await createCropPreset(db, KEY, { name: 'p', setId: setA.id, xNorm: 0.3 })).preset;
    const inDef = (await createCropPreset(db, KEY, { name: 'p', xNorm: 0.7 })).preset;
    await createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: inA.id });
    await createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: inDef.id });

    // Default set active → only the default-set preset's row matches
    assert.equal((await resolveCropPresetForSource(db, KEY, { mixerInput: 1 }))?.id, inDef.id);

    await setCropConfig(db, KEY, { activeSetId: setA.id });
    assert.equal((await resolveCropPresetForSource(db, KEY, { mixerInput: 1 }))?.id, inA.id);
  });

  test('delete entry', async () => {
    const p = await createCropPreset(db, KEY, { name: 'p' });
    const e = await createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: p.preset.id });
    assert.equal(await deleteCropSourceMapEntry(db, KEY, e.entry.id), true);
    assert.equal(await deleteCropSourceMapEntry(db, KEY, e.entry.id), false);
  });

  test('string-typed numeric values (JSON bodies) are coerced on insert and resolve', async () => {
    const p = await createCropPreset(db, KEY, { name: 'p' });

    // mixerInput is normalised to an integer; cameraPreset is an opaque string
    const e = await createCropSourceMapEntry(db, KEY, { mixerInput: '2', cameraId: 'cam1', cameraPreset: '3', presetId: p.preset.id });
    assert.equal(e.ok, true);
    assert.equal(e.entry.mixerInput, 2);
    assert.equal(e.entry.cameraPreset, '3');

    // Queried as strings → still resolves
    assert.equal((await resolveCropPresetForSource(db, KEY, { mixerInput: '2', cameraId: 'cam1', cameraPreset: '3' }))?.id, p.preset.id);
    // Queried as numbers against string-inserted rows → still resolves
    assert.equal((await resolveCropPresetForSource(db, KEY, { mixerInput: 2, cameraId: 'cam1', cameraPreset: 3 }))?.id, p.preset.id);
  });

  test('non-integer mixerInput is rejected on insert', async () => {
    const p = await createCropPreset(db, KEY, { name: 'p' });
    assert.equal((await createCropSourceMapEntry(db, KEY, { mixerInput: 'abc', presetId: p.preset.id })).ok, false);
  });

  test('cameraPreset accepts any opaque identifier', async () => {
    const p = await createCropPreset(db, KEY, { name: 'p' });
    // cameraPreset is the camera's own presetId (lcyt-production's
    // prod_cameras.control_config.presets[].id — 'wide', 'close', a UUID),
    // not a universal numeric PTZ preset number — any non-empty value is a
    // valid opaque identifier, including a non-integer-looking one.
    const r = await createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 'wide-shot', presetId: p.preset.id });
    assert.equal(r.ok, true);
    assert.equal(r.entry.cameraPreset, 'wide-shot');
    assert.equal((await resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 'wide-shot' }))?.id, p.preset.id);
  });

  test('a numeric-looking cameraPreset still resolves via string comparison', async () => {
    // A preset whose id looks like a number is stored as its string form
    // (camera_preset is TEXT) — resolution must match both the string and the
    // number query, so the number/string equivalence holds.
    const p = await createCropPreset(db, KEY, { name: 'p' });
    const e = await createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 2, presetId: p.preset.id });
    assert.equal(e.ok, true);
    assert.equal(e.entry.cameraPreset, '2');
    assert.equal((await resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: '2' }))?.id, p.preset.id);
    assert.equal((await resolveCropPresetForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 2 }))?.id, p.preset.id);
  });
});

describe('resolveCameraIdForMixerInput', () => {
  test('null when no camera is wired to the input', async () => {
    assert.equal(await resolveCameraIdForMixerInput(db, 1), null);
  });

  test('resolves a camera by mixer_input; null when no match', async () => {
    await db.prepare("INSERT INTO prod_cameras (id, name, mixer_input) VALUES ('cam-altar', 'Altar', 1)").run();
    await db.prepare("INSERT INTO prod_cameras (id, name, mixer_input) VALUES ('cam-pulpit', 'Pulpit', 2)").run();
    await db.prepare("INSERT INTO prod_cameras (id, name, mixer_input) VALUES ('cam-overview', 'Overview', NULL)").run();

    assert.equal(await resolveCameraIdForMixerInput(db, 1), 'cam-altar');
    assert.equal(await resolveCameraIdForMixerInput(db, 2), 'cam-pulpit');
    assert.equal(await resolveCameraIdForMixerInput(db, 3), null, 'no camera on that input');
    assert.equal(await resolveCameraIdForMixerInput(db, null), null);
  });
});
