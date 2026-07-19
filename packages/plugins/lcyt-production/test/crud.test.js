/**
 * Unit tests for the plain camera/mixer CRUD helpers (src/crud.js) — the
 * in-process counterpart to routes/cameras.js and routes/mixers.js, used by
 * packages/lcyt-tools (plan/mcp's shared tool-schema module).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db.js';
import {
  listCameras, getCameraById, createCamera, updateCamera, deleteCamera,
  listMixers, getMixerById, createMixer, updateMixer, deleteMixer,
} from '../src/crud.js';

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

/** Minimal registry stub — reload/remove are fire-and-forget in crud.js. */
function makeRegistryStub() {
  const calls = [];
  return {
    calls,
    reloadCamera: async (id) => { calls.push(['reloadCamera', id]); },
    reloadMixer: async (id) => { calls.push(['reloadMixer', id]); },
    removeCamera: async (id) => { calls.push(['removeCamera', id]); },
    removeMixer: async (id) => { calls.push(['removeMixer', id]); },
    isMixerConnected: () => false,
    getActiveSource: () => null,
  };
}

describe('camera CRUD', () => {
  it('createCamera validates name and controlType', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    assert.equal(createCamera(db, registry, { controlType: 'none' }).ok, false);
    assert.equal(createCamera(db, registry, { name: 'Cam', controlType: 'bogus' }).ok, false);
  });

  it('creates, lists, updates, and deletes a camera', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const created = createCamera(db, registry, { name: 'Cam 1', controlType: 'none' });
    assert.equal(created.ok, true);
    assert.equal(created.camera.name, 'Cam 1');
    assert.ok(registry.calls.some(([fn, id]) => fn === 'reloadCamera' && id === created.camera.id));

    assert.equal(listCameras(db).length, 1);
    assert.equal(getCameraById(db, created.camera.id).name, 'Cam 1');

    const updated = updateCamera(db, registry, created.camera.id, { name: 'Cam 1 Renamed' });
    assert.equal(updated.ok, true);
    assert.equal(updated.camera.name, 'Cam 1 Renamed');

    const del = deleteCamera(db, registry, created.camera.id);
    assert.equal(del.ok, true);
    assert.equal(getCameraById(db, created.camera.id), null);
    assert.ok(registry.calls.some(([fn]) => fn === 'removeCamera'));
  });

  it('updateCamera/deleteCamera 404 for unknown id', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    assert.equal(updateCamera(db, registry, 'no-such-id', { name: 'X' }).status, 404);
    assert.equal(deleteCamera(db, registry, 'no-such-id').status, 404);
  });

  it('updateCamera rejects an invalid controlType', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const created = createCamera(db, registry, { name: 'Cam', controlType: 'none' });
    const res = updateCamera(db, registry, created.camera.id, { controlType: 'bogus' });
    assert.equal(res.ok, false);
  });

  it("accepts controlType 'rtmp' with a camera_key (plan_ingest_feeds.md §1a)", () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const created = createCamera(db, registry, { name: 'Altar', controlType: 'rtmp', cameraKey: 'altar-cam' });
    assert.equal(created.ok, true);
    assert.equal(created.camera.controlType, 'rtmp');
    assert.equal(created.camera.cameraKey, 'altar-cam');
  });

  it('createCamera rejects a camera_key with unsafe characters (code-review follow-up)', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const res = createCamera(db, registry, { name: 'Altar', controlType: 'rtmp', cameraKey: 'altar cam; rm -rf' });
    assert.equal(res.ok, false);
    assert.match(res.error, /letters, digits, underscore, and hyphen/);
  });

  it('updateCamera rejects a camera_key with unsafe characters (code-review follow-up)', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const created = createCamera(db, registry, { name: 'Altar', controlType: 'rtmp', cameraKey: 'altar-cam' });
    const res = updateCamera(db, registry, created.camera.id, { cameraKey: '$(evil)' });
    assert.equal(res.ok, false);
    assert.match(res.error, /letters, digits, underscore, and hyphen/);
    // Unchanged in the DB — the malformed value must not have been persisted.
    assert.equal(getCameraById(db, created.camera.id).cameraKey, 'altar-cam');
  });

  it('createCamera stamps ownerApiKey when provided, and defaults to unowned (legacy) otherwise', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const owned = createCamera(db, registry, { name: 'Owned', controlType: 'none', ownerApiKey: 'proj-a' });
    assert.equal(owned.camera.isOwned, true);

    const legacy = createCamera(db, registry, { name: 'Legacy', controlType: 'none' });
    assert.equal(legacy.camera.isOwned, false);
  });
});

describe('mixer CRUD', () => {
  it('createMixer validates name and type', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    assert.equal(createMixer(db, registry, { type: 'lcyt' }).ok, false);
    assert.equal(createMixer(db, registry, { name: 'Mix', type: 'bogus' }).ok, false);
  });

  it('creates, lists, updates, and deletes a mixer', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    const created = createMixer(db, registry, { name: 'Mixer 1', type: 'lcyt' });
    assert.equal(created.ok, true);
    assert.equal(created.mixer.name, 'Mixer 1');
    assert.equal(created.mixer.connected, false);

    assert.equal(listMixers(db, registry).length, 1);
    assert.equal(getMixerById(db, registry, created.mixer.id).name, 'Mixer 1');

    const updated = updateMixer(db, registry, created.mixer.id, { name: 'Mixer 1 Renamed' });
    assert.equal(updated.ok, true);
    assert.equal(updated.mixer.name, 'Mixer 1 Renamed');

    const del = deleteMixer(db, registry, created.mixer.id);
    assert.equal(del.ok, true);
    assert.equal(getMixerById(db, registry, created.mixer.id), null);
  });

  it('updateMixer/deleteMixer 404 for unknown id', () => {
    const db = makeDb();
    const registry = makeRegistryStub();
    assert.equal(updateMixer(db, registry, 'no-such-id', { name: 'X' }).status, 404);
    assert.equal(deleteMixer(db, registry, 'no-such-id').status, 404);
  });
});
