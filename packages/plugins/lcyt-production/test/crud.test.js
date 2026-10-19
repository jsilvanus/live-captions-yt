/**
 * Unit tests for the plain camera/mixer CRUD helpers (src/crud.js) — the
 * in-process counterpart to routes/cameras.js and routes/mixers.js, used by
 * packages/lcyt-tools (plan/mcp's shared tool-schema module).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import { runMigrations } from '../src/db.js';
import {
  listCameras, getCameraById, createCamera, updateCamera, deleteCamera,
  listMixers, getMixerById, createMixer, updateMixer, deleteMixer,
} from '../src/crud.js';

const openDbs = [];
async function makeDb() {
  const db = await initDb(':memory:');
  openDbs.push(db);
  return db;
}

after(async () => { for (const d of openDbs) await d.close(); });

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
  it('createCamera validates name and controlType', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    assert.equal((await createCamera(db, registry, { controlType: 'none' })).ok, false);
    assert.equal((await createCamera(db, registry, { name: 'Cam', controlType: 'bogus' })).ok, false);
  });

  it('creates, lists, updates, and deletes a camera', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const created = await createCamera(db, registry, { name: 'Cam 1', controlType: 'none' });
    assert.equal(created.ok, true);
    assert.equal(created.camera.name, 'Cam 1');
    assert.ok(registry.calls.some(([fn, id]) => fn === 'reloadCamera' && id === created.camera.id));

    assert.equal((await listCameras(db)).length, 1);
    assert.equal((await getCameraById(db, created.camera.id)).name, 'Cam 1');

    const updated = await updateCamera(db, registry, created.camera.id, { name: 'Cam 1 Renamed' });
    assert.equal(updated.ok, true);
    assert.equal(updated.camera.name, 'Cam 1 Renamed');

    const del = await deleteCamera(db, registry, created.camera.id);
    assert.equal(del.ok, true);
    assert.equal(await getCameraById(db, created.camera.id), null);
    assert.ok(registry.calls.some(([fn]) => fn === 'removeCamera'));
  });

  it('updateCamera/deleteCamera 404 for unknown id', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    assert.equal((await updateCamera(db, registry, 'no-such-id', { name: 'X' })).status, 404);
    assert.equal((await deleteCamera(db, registry, 'no-such-id')).status, 404);
  });

  it('updateCamera rejects an invalid controlType', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const created = await createCamera(db, registry, { name: 'Cam', controlType: 'none' });
    const res = await updateCamera(db, registry, created.camera.id, { controlType: 'bogus' });
    assert.equal(res.ok, false);
  });

  it("refuses controlType 'rtmp' (the type is gone: a pushed feed is a feed linked to a camera)", async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const res = await createCamera(db, registry, { name: 'Altar', controlType: 'rtmp' });
    assert.equal(res.ok, false);
    assert.match(res.error, /controlType must be one of/);
  });

  it('refuses a cameraKey on create and update: the key is a feed now (feeds-and-devices PR 7)', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const res = await createCamera(db, registry, { name: 'Altar', controlType: 'none', cameraKey: 'altar-cam' });
    assert.equal(res.ok, false);
    assert.match(res.error, /cameraKey is no longer stored on cameras/);
    const created = await createCamera(db, registry, { name: 'Altar', controlType: 'none' });
    const upd = await updateCamera(db, registry, created.camera.id, { cameraKey: 'altar-cam' });
    assert.equal(upd.ok, false);
    assert.match(upd.error, /cameraKey is no longer stored on cameras/);
  });

  it('a camera reads its cameraKey from its linked feed, and deleting the camera unlinks the feed', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const created = await createCamera(db, registry, { name: 'Altar', controlType: 'none' });
    await db.prepare(`INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport, kind, device_type, device_id, sort_order)
      VALUES ('f-altar', 'proj', 'Altar', 'altar-cam', 'rtmp', 'camera', 'camera', ?, 0)`).run(created.camera.id);
    assert.equal((await getCameraById(db, created.camera.id)).cameraKey, 'altar-cam');
    await deleteCamera(db, registry, created.camera.id);
    const feed = await db.prod_feeds.findUnique({ where: { id: 'f-altar' } });
    assert.equal(feed.feed_key, 'altar-cam', 'the feed stays');
    assert.equal(feed.device_id, null, 'and is unlinked from the deleted camera');
  });

  it('createCamera stamps ownerApiKey when provided, and defaults to unowned (legacy) otherwise', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const owned = await createCamera(db, registry, { name: 'Owned', controlType: 'none', ownerApiKey: 'proj-a' });
    assert.equal(owned.camera.isOwned, true);

    const legacy = await createCamera(db, registry, { name: 'Legacy', controlType: 'none' });
    assert.equal(legacy.camera.isOwned, false);
  });

  it('accepts and persists label, zone, overlapLinks fields (plan_video_perception.md Phase 1)', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const overlapLinksData = [
      { cameraId: 'cam-2', kind: 'overlaps_with' },
      { cameraId: 'cam-3', presetId: 'wide', kind: 'alternate_for' },
    ];
    const created = await createCamera(db, registry, {
      name: 'Pulpit',
      controlType: 'none',
      label: 'pulpit',
      zone: 'front',
      overlapLinks: overlapLinksData,
    });
    assert.equal(created.ok, true);
    assert.equal(created.camera.label, 'pulpit');
    assert.equal(created.camera.zone, 'front');
    assert.deepEqual(created.camera.overlapLinks, overlapLinksData);

    const updated = await updateCamera(db, registry, created.camera.id, { label: 'pulpit-cam' });
    assert.equal(updated.ok, true);
    assert.equal(updated.camera.label, 'pulpit-cam');
    assert.equal(updated.camera.zone, 'front');
    assert.deepEqual(updated.camera.overlapLinks, overlapLinksData);
  });

  it('migrations are idempotent — running them twice does not error', async () => {
    const db = await makeDb();
    // runMigrations is a no-op now (tables come from the backend schema); calling it must stay harmless
    await runMigrations(db);
    const result = await createCamera(db, makeRegistryStub(), { name: 'Test', controlType: 'none', label: 'test' });
    assert.equal(result.ok, true);
  });
});

describe('mixer CRUD', () => {
  it('createMixer validates name and type', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    assert.equal((await createMixer(db, registry, { type: 'lcyt' })).ok, false);
    assert.equal((await createMixer(db, registry, { name: 'Mix', type: 'bogus' })).ok, false);
  });

  it('creates, lists, updates, and deletes a mixer', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const created = await createMixer(db, registry, { name: 'Mixer 1', type: 'lcyt' });
    assert.equal(created.ok, true);
    assert.equal(created.mixer.name, 'Mixer 1');
    assert.equal(created.mixer.connected, false);

    assert.equal((await listMixers(db, registry)).length, 1);
    assert.equal((await getMixerById(db, registry, created.mixer.id)).name, 'Mixer 1');

    const updated = await updateMixer(db, registry, created.mixer.id, { name: 'Mixer 1 Renamed' });
    assert.equal(updated.ok, true);
    assert.equal(updated.mixer.name, 'Mixer 1 Renamed');

    const del = await deleteMixer(db, registry, created.mixer.id);
    assert.equal(del.ok, true);
    assert.equal(await getMixerById(db, registry, created.mixer.id), null);
  });

  it('updateMixer/deleteMixer 404 for unknown id', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    assert.equal((await updateMixer(db, registry, 'no-such-id', { name: 'X' })).status, 404);
    assert.equal((await deleteMixer(db, registry, 'no-such-id')).status, 404);
  });

  it('createMixer stamps ownerApiKey when provided, and defaults to unowned (legacy) otherwise', async () => {
    const db = await makeDb();
    const registry = makeRegistryStub();
    const owned = await createMixer(db, registry, { name: 'Owned', type: 'lcyt', ownerApiKey: 'proj-a' });
    assert.equal(owned.mixer.isOwned, true);

    const legacy = await createMixer(db, registry, { name: 'Legacy', type: 'lcyt' });
    assert.equal(legacy.mixer.isOwned, false);
  });
});
