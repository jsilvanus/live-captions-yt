/**
 * Unit tests for camera-thumbnail.js: capture (both paths), disk write, and
 * best-effort delete. Mocks global.fetch the same way
 * packages/plugins/lcyt-agent/test/vision-frame-fetcher.test.js does.
 */

import { test, describe, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseCamera } from '../src/registry.js';
import { withCameraFeedKeys } from '../src/camera-feeds.js';
import {
  captureCameraThumbnail,
  deleteCameraThumbnailFile,
  thumbnailPath,
} from '../src/camera-thumbnail.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const openDbs = [];
async function makeDb() {
  const db = await initDb(':memory:');
  openDbs.push(db);
  return db;
}

after(async () => { for (const d of openDbs) await d.close(); });

async function insertCamera(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  await db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Cam 1',
    overrides.mixer_input ?? null,
    overrides.control_type ?? 'webcam',
    JSON.stringify(overrides.control_config ?? {}),
    overrides.sort_order ?? 0,
  );
  // The camera's stream key is its linked feed (prod_feeds): WHIP for webcam/mobile, RTMP otherwise.
  const key = overrides.camera_key ?? null;
  const control = overrides.control_type ?? 'webcam';
  if (key) {
    const transport = ['webcam', 'mobile'].includes(control) ? 'whip' : 'rtmp';
    await db.prepare(`INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport, kind, device_type, device_id, sort_order)
      VALUES (?, 'proj', 'Feed', ?, ?, 'camera', 'camera', ?, 0)`).run(randomUUID(), key, transport, id);
  }
  const [camera] = await withCameraFeedKeys(db, [parseCamera(await db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id))]);
  return camera;
}

async function insertMixer(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  await db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config)
    VALUES (?, ?, ?, ?)
  `).run(id, overrides.name ?? 'Mixer 1', overrides.type ?? 'lcyt', JSON.stringify(overrides.connection_config ?? {}));
  return id;
}

function makeRegistryStub(activeSourceByMixer = {}) {
  return { getActiveSource: (mixerId) => activeSourceByMixer[mixerId] ?? null };
}

function makeTmpDir() {
  return fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
}

describe('captureCameraThumbnail — Path A (independent feed, camera_key)', () => {
  test('no camera_key and no apiKey -> 400', async () => {
    const db = await makeDb();
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, { thumbnailsDir: makeTmpDir() });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('preview 404 -> 409 (not live)', async () => {
    global.fetch = async () => ({ ok: false, status: 404 });
    const db = await makeDb();
    const camera = await insertCamera(db, { camera_key: 'cam-key-1' });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      thumbnailsDir: makeTmpDir(), previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  });

  test('preview non-ok non-404 -> 502', async () => {
    global.fetch = async () => ({ ok: false, status: 500 });
    const db = await makeDb();
    const camera = await insertCamera(db, { camera_key: 'cam-key-1' });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      thumbnailsDir: makeTmpDir(), previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
  });

  test('fetch throw -> 502', async () => {
    global.fetch = async () => { throw new Error('network down'); };
    const db = await makeDb();
    const camera = await insertCamera(db, { camera_key: 'cam-key-1' });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      thumbnailsDir: makeTmpDir(), previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.match(result.error, /network down/);
  });

  test('success: writes file, updates DB, returns sizeBytes', async () => {
    global.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('jpeg-bytes') });
    const db = await makeDb();
    const camera = await insertCamera(db, { camera_key: 'cam-key-1' });
    const registry = makeRegistryStub();
    const thumbnailsDir = makeTmpDir();

    const result = await captureCameraThumbnail(db, camera, registry, {
      thumbnailsDir, previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, true);
    assert.equal(result.sizeBytes, Buffer.from('jpeg-bytes').length);
    assert.ok(result.thumbnailCapturedAt);

    const filepath = thumbnailPath(camera.id, thumbnailsDir);
    assert.equal(fs.readFileSync(filepath, 'utf8'), 'jpeg-bytes');

    const row = await db.prepare('SELECT thumbnail_captured_at FROM prod_cameras WHERE id = ?').get(camera.id);
    assert.equal(row.thumbnail_captured_at, result.thumbnailCapturedAt);
  });
});

describe('captureCameraThumbnail — Path B (program-feed capture, no camera_key)', () => {
  test('no mixer_input -> 400', async () => {
    const db = await makeDb();
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: null });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('no mixer configured -> 400', async () => {
    const db = await makeDb();
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 1 });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('multiple mixers with no mixerId given -> 400 asking to disambiguate', async () => {
    const db = await makeDb();
    await insertMixer(db);
    await insertMixer(db);
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 1 });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /mixerId/);
  });

  test('camera not currently the active mixer source -> 409', async () => {
    const db = await makeDb();
    const mixerId = await insertMixer(db);
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 2 });
    const registry = makeRegistryStub({ [mixerId]: 1 }); // active source is input 1, camera is input 2
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  });

  test('success: auto-resolves the single mixer, fetches by apiKey, writes + updates DB', async () => {
    let requestedUrl = null;
    global.fetch = async (url) => {
      requestedUrl = url;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('program-frame') };
    };
    const db = await makeDb();
    const mixerId = await insertMixer(db);
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 2 });
    const registry = makeRegistryStub({ [mixerId]: 2 }); // camera 2 is live
    const thumbnailsDir = makeTmpDir();

    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir, previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, 'http://x/preview/proj-key/incoming');

    const filepath = thumbnailPath(camera.id, thumbnailsDir);
    assert.equal(fs.readFileSync(filepath, 'utf8'), 'program-frame');
  });

  test('explicit mixerId is honored over auto-resolution', async () => {
    global.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') });
    const db = await makeDb();
    const mixerA = await insertMixer(db);
    const mixerB = await insertMixer(db);
    const camera = await insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 3 });
    const registry = makeRegistryStub({ [mixerA]: 999, [mixerB]: 3 });

    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', mixerId: mixerB, thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, true);
  });
});

describe('deleteCameraThumbnailFile', () => {
  test('removes an existing file and is a no-op when absent', async () => {
    const thumbnailsDir = makeTmpDir();
    const cameraId = randomUUID();
    const filepath = thumbnailPath(cameraId, thumbnailsDir);
    fs.writeFileSync(filepath, 'bytes');
    assert.ok(fs.existsSync(filepath));

    deleteCameraThumbnailFile(cameraId, thumbnailsDir);
    assert.equal(fs.existsSync(filepath), false);

    // Second call (already deleted) must not throw
    assert.doesNotThrow(() => deleteCameraThumbnailFile(cameraId, thumbnailsDir));
  });
});
