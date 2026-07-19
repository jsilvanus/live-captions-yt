/**
 * Route-level tests for the camera thumbnail capture/serve endpoints added to
 * routes/cameras.js: POST /:id/thumbnail/capture, GET /:id/thumbnail(.jpg),
 * DELETE /:id (thumbnail-file cleanup), and the thumbnailUrl field on
 * GET / and GET /:id. First route-level test file for this router.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createCamerasRouter } from '../src/routes/cameras.js';

const realFetch = global.fetch;

let server, baseUrl, db, thumbnailsDir;

function makeRegistryStub(activeSourceByMixer = {}) {
  return {
    reloadCamera: async () => {},
    removeCamera: async () => {},
    getActiveSource: (mixerId) => activeSourceByMixer[mixerId] ?? null,
  };
}

function insertCamera(overrides = {}) {
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
  return id;
}

function insertMixer(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config)
    VALUES (?, ?, ?, ?)
  `).run(id, overrides.name ?? 'Mixer 1', overrides.type ?? 'lcyt', JSON.stringify({}));
  return id;
}

// global.fetch is shared with the test's own calls to the local test server —
// only intercept the capture module's internal preview fetch, pass everything else through.
function mockPreview(jpegBytes = 'jpeg-bytes') {
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('/production/cameras')) return realFetch(url, init);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(jpegBytes) };
  };
}

function startApp(registry, mediamtxClient = null) {
  const app = express();
  app.use(express.json());
  app.use('/production/cameras', createCamerasRouter(db, registry, null, { cameraThumbnail: { thumbnailsDir }, mediamtxClient }));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());

afterEach(() => {
  global.fetch = realFetch;
  if (server) { server.close(); server = null; }
});

describe('camera thumbnail routes', () => {
  it('capture on unknown camera id -> 404', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const res = await fetch(`${baseUrl}/production/cameras/does-not-exist/thumbnail/capture`, { method: 'POST' });
    assert.equal(res.status, 404);
  });

  it('capture with no camera_key and no apiKey -> 400', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ control_type: 'amx', camera_key: null });
    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 400);
  });

  it('GET .../thumbnail before any capture -> 404', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera();
    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail`);
    assert.equal(res.status, 404);
  });

  it('capture happy path (webcam camera_key) then GET .../thumbnail serves the JPEG', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-1' });

    mockPreview();

    const captureRes = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, { method: 'POST' });
    assert.equal(captureRes.status, 200);
    const captureBody = await captureRes.json();
    assert.equal(captureBody.ok, true);
    assert.ok(captureBody.thumbnailCapturedAt);

    const getRes = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await getRes.arrayBuffer());
    assert.equal(bytes.toString(), 'jpeg-bytes');
  });

  it('program-feed capture (amx camera) requires the camera to be the active mixer source', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const mixerId = insertMixer();
    const id = insertCamera({ control_type: 'amx', camera_key: null, mixer_input: 2 });
    await startApp(makeRegistryStub({ [mixerId]: 1 })); // input 1 is live, camera is input 2

    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'proj-key' }),
    });
    assert.equal(res.status, 409);
  });

  it('DELETE /:id removes the thumbnail file from disk', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-1' });

    mockPreview();
    const captureRes = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, { method: 'POST' });
    assert.equal(captureRes.status, 200);

    const filepath = join(thumbnailsDir, `${id}.jpg`);
    assert.ok(fs.existsSync(filepath));

    const delRes = await fetch(`${baseUrl}/production/cameras/${id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);
    assert.equal(fs.existsSync(filepath), false);
  });

  it('GET / shows thumbnailUrl: null before capture and a URL after', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-1' });

    const beforeRes = await fetch(`${baseUrl}/production/cameras`);
    const beforeList = await beforeRes.json();
    const beforeCam = beforeList.find(c => c.id === id);
    assert.equal(beforeCam.thumbnailUrl, null);

    mockPreview();
    await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, { method: 'POST' });

    const afterRes = await fetch(`${baseUrl}/production/cameras`);
    const afterList = await afterRes.json();
    const afterCam = afterList.find(c => c.id === id);
    assert.equal(afterCam.thumbnailUrl, `${baseUrl}/production/cameras/${id}/thumbnail`);
  });

  it('GET / and GET /:id show live: null with no mediamtxClient configured', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-2' });

    const listRes = await fetch(`${baseUrl}/production/cameras`);
    const list = await listRes.json();
    assert.equal(list.find(c => c.id === id).live, null);

    const oneRes = await fetch(`${baseUrl}/production/cameras/${id}`);
    assert.equal((await oneRes.json()).live, null);
  });

  it("GET / and GET /:id reflect live status for camera_key-bearing cameras (plan_ingest_feeds.md §2b)", async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const mtx = { isPathPublishing: async (key) => key === 'live-cam' };
    await startApp(makeRegistryStub(), mtx);
    const liveId = insertCamera({ camera_key: 'live-cam', control_type: 'rtmp' });
    const offlineId = insertCamera({ camera_key: 'offline-cam', control_type: 'rtmp' });
    const noKeyId = insertCamera({ camera_key: null, control_type: 'none' });

    const list = await (await fetch(`${baseUrl}/production/cameras`)).json();
    assert.equal(list.find(c => c.id === liveId).live, true);
    assert.equal(list.find(c => c.id === offlineId).live, false);
    assert.equal(list.find(c => c.id === noKeyId).live, null);

    const one = await (await fetch(`${baseUrl}/production/cameras/${liveId}`)).json();
    assert.equal(one.live, true);
  });
});
