/**
 * Tests for the /ingestion/config router (plan/selfservice_config_backend §2/§2a).
 *
 * Nested { video, dsk } shape per the Setup Hub's IngestionSection.jsx contract:
 *   GET   /ingestion/config
 *   PATCH /ingestion/config   { video?: { enabled? }, dsk?: { enabled? } }
 *   POST  /ingestion/config/rotate
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { runMigrations } from 'lcyt-rtmp/src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createIngestionRouter } from 'lcyt-rtmp/src/routes/ingestion.js';
import { RtmpRelayManager } from 'lcyt-rtmp/src/rtmp-manager.js';

const JWT_SECRET = 'test-ingestion-secret';

function initTestDb() { const db = initDb(':memory:'); runMigrations(db); return db; }

let server, baseUrl, db, relayManager;

before(() => new Promise((resolve) => {
  db = initTestDb();
  relayManager = new RtmpRelayManager();
  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/ingestion', createIngestionRouter(db, auth, relayManager));
  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

afterEach(() => {
  delete process.env.FEATURE_GATE_ENFORCE;
  delete process.env.RTMP_HOST;
  delete process.env.RTMP_APPLICATION;
  delete process.env.RTMP_APP;
  delete process.env.DSK_RTMP_APP;
});

function tokenFor(apiKey) {
  return jwt.sign({ sessionId: 'ingest-session', apiKey }, JWT_SECRET, { expiresIn: '1h' });
}

function bearer(tok) {
  return { Authorization: `Bearer ${tok}` };
}

async function get(apiKey) {
  return fetch(`${baseUrl}/ingestion/config`, { headers: bearer(tokenFor(apiKey)) });
}

async function patch(apiKey, body) {
  return fetch(`${baseUrl}/ingestion/config`, {
    method: 'PATCH',
    headers: { ...bearer(tokenFor(apiKey)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function rotate(apiKey) {
  return fetch(`${baseUrl}/ingestion/config/rotate`, {
    method: 'POST',
    headers: bearer(tokenFor(apiKey)),
  });
}

describe('GET /ingestion/config', () => {
  it('rejects missing auth', async () => {
    const res = await fetch(`${baseUrl}/ingestion/config`);
    assert.equal(res.status, 401);
  });

  it('returns the nested { video, dsk } shape with defaults', async () => {
    const k = createKey(db, { owner: 'Fresh' });
    const res = await get(k.key);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.video.enabled, false);
    assert.equal(body.video.active, false);
    assert.equal(body.video.streamKey, k.key, 'streamKey defaults to the literal api_key when not rotated');
    assert.equal(body.video.rotatable, true);
    assert.equal(body.video.live, false);
    assert.match(body.video.ingestUrl, /^rtmp:\/\//);
    assert.ok(body.video.ingestUrl.includes(k.key));

    assert.equal(body.dsk.enabled, false);
    assert.equal(body.dsk.live, null, 'dsk.live is unknown (null), not false, until publish-tracking exists');
    assert.match(body.dsk.ingestUrl, /^rtmp:\/\//);
    assert.ok(body.dsk.ingestUrl.includes(k.key));
  });

  it('reflects relay_allowed/relay_active/graphics_enabled from the key row', async () => {
    const k = createKey(db, { owner: 'Flags', relay_allowed: true, graphics_enabled: true });
    const res = await get(k.key);
    const body = await res.json();
    assert.equal(body.video.enabled, true);
    assert.equal(body.dsk.enabled, true);
  });

  it('video.live reflects relayManager.isPublishing()', async () => {
    const k = createKey(db, { owner: 'Publishing', relay_allowed: true });
    relayManager.markPublishing(k.key);
    try {
      const res = await get(k.key);
      const body = await res.json();
      assert.equal(body.video.live, true);
    } finally {
      relayManager.markNotPublishing(k.key);
    }
  });

  it('ingestUrl uses RTMP_HOST/RTMP_APPLICATION/DSK_RTMP_APP env overrides', async () => {
    process.env.RTMP_HOST = 'ingest.example.com';
    process.env.RTMP_APPLICATION = 'custom-app';
    process.env.DSK_RTMP_APP = 'custom-dsk';
    const k = createKey(db, { owner: 'EnvOverride' });
    const res = await get(k.key);
    const body = await res.json();
    assert.equal(body.video.ingestUrl, `rtmp://ingest.example.com/custom-app/${k.key}`);
    assert.equal(body.dsk.ingestUrl, `rtmp://ingest.example.com/custom-dsk/${k.key}`);
  });

  it('video.streamKey/ingestUrl uses the rotated ingest_stream_key once set', async () => {
    const k = createKey(db, { owner: 'Rotated' });
    db.prepare('UPDATE api_keys SET ingest_stream_key = ? WHERE key = ?').run('my-rotated-key', k.key);
    const res = await get(k.key);
    const body = await res.json();
    assert.equal(body.video.streamKey, 'my-rotated-key');
    assert.ok(body.video.ingestUrl.endsWith('/my-rotated-key'));
  });
});

describe('PATCH /ingestion/config', () => {
  it('flips video.enabled (relay_allowed) and returns the updated nested shape', async () => {
    const k = createKey(db, { owner: 'ToggleVideo' });
    const res = await patch(k.key, { video: { enabled: true } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.video.enabled, true);

    const res2 = await patch(k.key, { video: { enabled: false } });
    const body2 = await res2.json();
    assert.equal(body2.video.enabled, false);
  });

  it('rejects a non-boolean video.enabled', async () => {
    const k = createKey(db, { owner: 'BadVideoType' });
    const res = await patch(k.key, { video: { enabled: 'yes' } });
    assert.equal(res.status, 400);
  });

  it('returns 501 for dsk.enabled — no real gate exists to flip yet', async () => {
    const k = createKey(db, { owner: 'ToggleDsk' });
    const res = await patch(k.key, { dsk: { enabled: true } });
    assert.equal(res.status, 501);
  });

  it('applies video.enabled even in a combined request that also 501s on dsk.enabled', async () => {
    const k = createKey(db, { owner: 'CombinedVideoDsk' });
    const res = await patch(k.key, { video: { enabled: true }, dsk: { enabled: true } });
    assert.equal(res.status, 501);

    // The video change must have been applied despite the overall 501 response.
    const getBody = await (await get(k.key)).json();
    assert.equal(getBody.video.enabled, true);
  });

  it('is a no-op (200, unchanged) when neither video nor dsk enabled fields are present', async () => {
    const k = createKey(db, { owner: 'EmptyPatch', relay_allowed: true });
    const res = await patch(k.key, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.video.enabled, true);
  });

  describe('feature-gate enforcement (FEATURE_GATE_ENFORCE=1)', () => {
    it('rejects video.enabled when the ingest feature is not enabled for the project', async () => {
      process.env.FEATURE_GATE_ENFORCE = '1';
      const k = createKey(db, { owner: 'GatedNoFeature' });
      const res = await patch(k.key, { video: { enabled: true } });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.feature, 'ingest');
    });

    it('allows video.enabled when the ingest feature IS enabled for the project', async () => {
      process.env.FEATURE_GATE_ENFORCE = '1';
      const k = createKey(db, { owner: 'GatedWithFeature' });
      db.prepare(`
        INSERT INTO project_features (api_key, feature_code, enabled) VALUES (?, 'ingest', 1)
      `).run(k.key);
      const res = await patch(k.key, { video: { enabled: true } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.video.enabled, true);
    });
  });
});

describe('POST /ingestion/config/rotate', () => {
  it('rejects missing auth', async () => {
    const res = await fetch(`${baseUrl}/ingestion/config/rotate`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('generates a new streamKey distinct from the api_key and persists it', async () => {
    const k = createKey(db, { owner: 'Rotator' });
    const res = await rotate(k.key);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.streamKey);
    assert.notEqual(body.streamKey, k.key);
    assert.ok(body.ingestUrl.endsWith(`/${body.streamKey}`));

    // GET /ingestion/config should now reflect the rotated key
    const getRes = await get(k.key);
    const getBody = await getRes.json();
    assert.equal(getBody.video.streamKey, body.streamKey);
  });

  it('rotating twice replaces the previous stream key', async () => {
    const k = createKey(db, { owner: 'DoubleRotate' });
    const first = await (await rotate(k.key)).json();
    const second = await (await rotate(k.key)).json();
    assert.notEqual(first.streamKey, second.streamKey);

    const getBody = await (await get(k.key)).json();
    assert.equal(getBody.video.streamKey, second.streamKey);
  });
});
