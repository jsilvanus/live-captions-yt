/**
 * Unit tests for camera-thumbnail.js: capture (both paths), disk write, and
 * best-effort delete. Mocks global.fetch the same way
 * packages/plugins/lcyt-agent/test/vision-frame-fetcher.test.js does.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/db.js';
import { parseCamera } from '../src/registry.js';
import {
  captureCameraThumbnail,
  deleteCameraThumbnailFile,
  thumbnailPath,
} from '../src/camera-thumbnail.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertCamera(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order, camera_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Cam 1',
    overrides.mixer_input ?? null,
    overrides.control_type ?? 'webcam',
    JSON.stringify(overrides.control_config ?? {}),
    overrides.sort_order ?? 0,
    overrides.camera_key ?? null,
  );
  return parseCamera(db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id));
}

function insertMixer(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
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
    const db = makeDb();
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, { thumbnailsDir: makeTmpDir() });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('preview 404 -> 409 (not live)', async () => {
    global.fetch = async () => ({ ok: false, status: 404 });
    const db = makeDb();
    const camera = insertCamera(db, { camera_key: 'cam-key-1' });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      thumbnailsDir: makeTmpDir(), previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  });

  test('preview non-ok non-404 -> 502', async () => {
    global.fetch = async () => ({ ok: false, status: 500 });
    const db = makeDb();
    const camera = insertCamera(db, { camera_key: 'cam-key-1' });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      thumbnailsDir: makeTmpDir(), previewBaseUrl: 'http://x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
  });

  test('fetch throw -> 502', async () => {
    global.fetch = async () => { throw new Error('network down'); };
    const db = makeDb();
    const camera = insertCamera(db, { camera_key: 'cam-key-1' });
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
    const db = makeDb();
    const camera = insertCamera(db, { camera_key: 'cam-key-1' });
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

    const row = db.prepare('SELECT thumbnail_captured_at FROM prod_cameras WHERE id = ?').get(camera.id);
    assert.equal(row.thumbnail_captured_at, result.thumbnailCapturedAt);
  });
});

describe('captureCameraThumbnail — Path B (program-feed capture, no camera_key)', () => {
  test('no mixer_input -> 400', async () => {
    const db = makeDb();
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: null });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('no mixer configured -> 400', async () => {
    const db = makeDb();
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 1 });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('multiple mixers with no mixerId given -> 400 asking to disambiguate', async () => {
    const db = makeDb();
    insertMixer(db);
    insertMixer(db);
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 1 });
    const registry = makeRegistryStub();
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /mixerId/);
  });

  test('camera not currently the active mixer source -> 409', async () => {
    const db = makeDb();
    const mixerId = insertMixer(db);
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 2 });
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
    const db = makeDb();
    const mixerId = insertMixer(db);
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 2 });
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
    const db = makeDb();
    const mixerA = insertMixer(db);
    const mixerB = insertMixer(db);
    const camera = insertCamera(db, { control_type: 'amx', camera_key: null, mixer_input: 3 });
    const registry = makeRegistryStub({ [mixerA]: 999, [mixerB]: 3 });

    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey: 'proj-key', mixerId: mixerB, thumbnailsDir: makeTmpDir(),
    });
    assert.equal(result.ok, true);
  });
});

describe('deleteCameraThumbnailFile', () => {
  test('removes an existing file and is a no-op when absent', () => {
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
