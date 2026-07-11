/**
 * Route tests for DSK public slug resolution and reserved viewport names
 * (plan_dsk_viewport_settings Phase 2).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db.js';
import { createDskRouter } from '../src/routes/dsk.js';
import { createDskViewportsRouter, RESERVED_VIEWPORT_NAMES, sanitizeDisplaySettings, publicDisplaySettings } from '../src/routes/dsk-viewports.js';
import { viewportStreamName, parseStreamName, isViewportStream } from '../src/stream-names.js';
import { createDskRtmpRouter } from '../src/routes/dsk-rtmp.js';
import { upsertViewport } from '../src/db/viewports.js';

let server, baseUrl, db;

// Minimal auth stub: trusts an x-api-key header, sets req.session.apiKey.
function stubAuth(req, _res, next) {
  const k = req.headers['x-api-key'];
  if (k) req.session = { apiKey: k };
  next();
}

const stubBus = { addDskSubscriber() {}, removeDskSubscriber() {} };

before(() => new Promise(resolve => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, api_key TEXT, filename TEXT,
      size_bytes INTEGER, type TEXT, format TEXT, created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE api_keys (
      key TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1,
      public_slug TEXT UNIQUE, ingest_stream_key TEXT
    )
  `);
  runMigrations(db);

  const app = express();
  app.use(express.json());
  app.use('/dsk', createDskRouter(db, stubBus));
  app.use('/dsk', createDskViewportsRouter(db, stubAuth));

  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));

after(() => new Promise(resolve => { db.close(); server.close(resolve); }));

beforeEach(() => {
  db.prepare('DELETE FROM dsk_viewports').run();
  db.prepare('DELETE FROM api_keys').run();
});

function makeKey(key, slug = null) {
  db.prepare('INSERT INTO api_keys (key, active, public_slug) VALUES (?, 1, ?)').run(key, slug);
}

describe('DSK public route slug resolution', () => {
  it('resolves a project public slug to its data', async () => {
    makeKey('secret-api-key', 'sunday-service');
    upsertViewport(db, 'secret-api-key', { name: 'vertical-left', viewportType: 'vertical', width: 1080, height: 1920 });

    const res = await fetch(`${baseUrl}/dsk/sunday-service/viewports/public`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.projectSlug, 'sunday-service');
    assert.equal(data.viewports.length, 1);
    assert.equal(data.viewports[0].name, 'vertical-left');
  });

  it('still resolves the raw api key (legacy URLs)', async () => {
    makeKey('secret-api-key', 'sunday-service');
    upsertViewport(db, 'secret-api-key', { name: 'v1', viewportType: 'vertical' });

    const res = await fetch(`${baseUrl}/dsk/secret-api-key/viewports/public`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.viewports.length, 1);
  });

  it('404s an unknown segment', async () => {
    makeKey('secret-api-key', 'sunday-service');
    const res = await fetch(`${baseUrl}/dsk/no-such-slug/viewports/public`);
    assert.equal(res.status, 404);
  });

  it('serves a shorter cache TTL so settings edits propagate', async () => {
    makeKey('k', 's');
    const res = await fetch(`${baseUrl}/dsk/s/viewports/public`);
    assert.match(res.headers.get('cache-control'), /max-age=60/);
  });

  it('exposes projectSlug null on the authed viewports listing when unset', async () => {
    makeKey('plain-key', null);
    const res = await fetch(`${baseUrl}/dsk/plain-key/viewports`, { headers: { 'x-api-key': 'plain-key' } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.projectSlug, null);
  });

  it('returns projectSlug on the authed viewports listing when set', async () => {
    makeKey('plain-key', 'my-slug');
    const res = await fetch(`${baseUrl}/dsk/plain-key/viewports`, { headers: { 'x-api-key': 'plain-key' } });
    const data = await res.json();
    assert.equal(data.projectSlug, 'my-slug');
  });
});

describe('reserved viewport names', () => {
  it('blocklist includes the sibling route segments', () => {
    for (const name of ['events', 'images', 'viewports', 'templates', 'public', 'broadcast', 'renderer']) {
      assert.ok(RESERVED_VIEWPORT_NAMES.has(name), `${name} should be reserved`);
    }
  });

  it('rejects creating a viewport named after a sibling route', async () => {
    makeKey('k1');
    const res = await fetch(`${baseUrl}/dsk/k1/viewports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'k1' },
      body: JSON.stringify({ name: 'events', viewportType: 'vertical' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /reserved/i);
  });

  it('allows a normal viewport name', async () => {
    makeKey('k2');
    const res = await fetch(`${baseUrl}/dsk/k2/viewports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'k2' },
      body: JSON.stringify({ name: 'vertical-left', viewportType: 'vertical' }),
    });
    assert.equal(res.status, 201);
  });
});

describe('sanitizeDisplaySettings', () => {
  it('whitelists and clamps fields, drops junk', () => {
    const out = sanitizeDisplaySettings({
      background: '  transparent ', ccMode: 1,
      ccStyle: { fontSize: '999', position: 'top', color: '#fff', bogus: 'x' },
      evil: '<script>',
    });
    assert.equal(out.background, 'transparent');
    assert.equal(out.ccMode, true);
    assert.equal(out.ccStyle.fontSize, 200); // clamped
    assert.equal(out.ccStyle.position, 'top');
    assert.equal(out.ccStyle.color, '#fff');
    assert.ok(!('bogus' in out.ccStyle));
    assert.ok(!('evil' in out));
  });

  it('returns null for empty/invalid input', () => {
    assert.equal(sanitizeDisplaySettings(null), null);
    assert.equal(sanitizeDisplaySettings({}), null);
    assert.equal(sanitizeDisplaySettings({ ccStyle: { position: 'sideways' } }), null);
  });
});

describe('viewport display settings persistence', () => {
  it('round-trips display settings through create and the public endpoint', async () => {
    makeKey('ds1', 'ds-slug');
    const create = await fetch(`${baseUrl}/dsk/ds1/viewports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'ds1' },
      body: JSON.stringify({
        name: 'v1', viewportType: 'vertical',
        displaySettings: { background: 'transparent', ccMode: true, ccStyle: { fontSize: 40, position: 'top' } },
      }),
    });
    assert.equal(create.status, 201);
    assert.equal((await create.json()).viewport.displaySettings.background, 'transparent');

    const pub = await fetch(`${baseUrl}/dsk/ds-slug/viewports/public`);
    const vp = (await pub.json()).viewports.find(v => v.name === 'v1');
    assert.equal(vp.displaySettings.background, 'transparent');
    assert.equal(vp.displaySettings.ccMode, true);
    assert.equal(vp.displaySettings.ccStyle.fontSize, 40);
  });

  it('a text-layers-only PUT does not wipe display settings (and vice versa)', async () => {
    makeKey('ds2');
    await fetch(`${baseUrl}/dsk/ds2/viewports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ds2' },
      body: JSON.stringify({ name: 'v1', viewportType: 'vertical', displaySettings: { background: 'transparent' } }),
    });
    // Update only text layers
    await fetch(`${baseUrl}/dsk/ds2/viewports/v1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ds2' },
      body: JSON.stringify({ textLayers: [{ id: 'a', binding: 'section' }] }),
    });
    let list = await (await fetch(`${baseUrl}/dsk/ds2/viewports`, { headers: { 'x-api-key': 'ds2' } })).json();
    let vp = list.viewports.find(v => v.name === 'v1');
    assert.equal(vp.displaySettings.background, 'transparent', 'display settings survived a text-layers PUT');
    assert.equal(vp.textLayers.length, 1);

    // Update only display settings
    await fetch(`${baseUrl}/dsk/ds2/viewports/v1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ds2' },
      body: JSON.stringify({ displaySettings: { ccMode: true } }),
    });
    list = await (await fetch(`${baseUrl}/dsk/ds2/viewports`, { headers: { 'x-api-key': 'ds2' } })).json();
    vp = list.viewports.find(v => v.name === 'v1');
    assert.equal(vp.textLayers.length, 1, 'text layers survived a display-settings PUT');
    assert.equal(vp.displaySettings.ccMode, true);
  });

  it('clears display settings when PUT sends null', async () => {
    makeKey('ds3');
    await fetch(`${baseUrl}/dsk/ds3/viewports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ds3' },
      body: JSON.stringify({ name: 'v1', viewportType: 'vertical', displaySettings: { background: 'transparent' } }),
    });
    await fetch(`${baseUrl}/dsk/ds3/viewports/v1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ds3' },
      body: JSON.stringify({ displaySettings: null }),
    });
    const list = await (await fetch(`${baseUrl}/dsk/ds3/viewports`, { headers: { 'x-api-key': 'ds3' } })).json();
    assert.equal(list.viewports.find(v => v.name === 'v1').displaySettings, null);
  });
});

// ── Phase 4: stream config, composite invariant, RTMP naming ────────────────

describe('stream config sanitize + public stripping', () => {
  it('whitelists stream fields and rejects non-rtmp push urls', () => {
    const out = sanitizeDisplaySettings({
      stream: {
        enabled: 1, mode: 'composite',
        pushUrls: [
          { url: 'rtmp://a.example/live/key1', enabled: true },
          { url: 'https://evil.example/x' },       // not rtmp → dropped
          { url: 'rtmps://b.example/live/key2', enabled: false },
        ],
        chromaKey: { enabled: true, color: '#00B140', similarity: 5, blend: -1 },
      },
    });
    assert.equal(out.stream.enabled, true);
    assert.equal(out.stream.mode, 'composite');
    assert.equal(out.stream.pushUrls.length, 2);
    assert.equal(out.stream.pushUrls[1].enabled, false);
    assert.equal(out.stream.chromaKey.similarity, 1); // clamped
    assert.equal(out.stream.chromaKey.blend, 0);       // clamped
  });

  it('publicDisplaySettings strips the whole stream sub-object', () => {
    const full = { background: 'transparent', stream: { pushUrls: [{ url: 'rtmp://x/y/secretkey' }] } };
    const pub = publicDisplaySettings(full);
    assert.equal(pub.background, 'transparent');
    assert.ok(!('stream' in pub));
  });

  it('never exposes pushUrls on the public viewports endpoint', async () => {
    makeKey('st1', 'st-slug');
    await fetch(`${baseUrl}/dsk/st1/viewports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'st1' },
      body: JSON.stringify({
        name: 'vert', viewportType: 'vertical',
        displaySettings: { background: 'transparent', stream: { enabled: true, mode: 'standalone', pushUrls: [{ url: 'rtmp://ingest/app/SECRET' }] } },
      }),
    });
    const pub = await (await fetch(`${baseUrl}/dsk/st-slug/viewports/public`)).json();
    const vp = pub.viewports.find(v => v.name === 'vert');
    assert.equal(vp.displaySettings.background, 'transparent');
    assert.ok(!vp.displaySettings.stream, 'stream config must not appear publicly');
    assert.ok(!JSON.stringify(pub).includes('SECRET'), 'push stream key must never leak');
  });
});

describe('single-composite invariant', () => {
  it('demotes a prior composite viewport when a new one becomes composite', async () => {
    makeKey('ci1');
    const mk = (name) => fetch(`${baseUrl}/dsk/ci1/viewports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ci1' },
      body: JSON.stringify({ name, viewportType: 'landscape', displaySettings: { stream: { enabled: true, mode: 'composite' } } }),
    });
    await mk('prog-a');
    await mk('prog-b'); // second composite → first must demote to standalone

    const list = await (await fetch(`${baseUrl}/dsk/ci1/viewports`, { headers: { 'x-api-key': 'ci1' } })).json();
    const a = list.viewports.find(v => v.name === 'prog-a');
    const b = list.viewports.find(v => v.name === 'prog-b');
    assert.equal(a.displaySettings.stream.mode, 'standalone');
    assert.equal(b.displaySettings.stream.mode, 'composite');
  });

  it('rejects viewport names containing the __ delimiter', async () => {
    makeKey('ci2');
    const res = await fetch(`${baseUrl}/dsk/ci2/viewports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ci2' },
      body: JSON.stringify({ name: 'foo__bar', viewportType: 'vertical' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /__/);
  });
});

describe('stream-name convention', () => {
  it('builds and parses viewport stream names', () => {
    assert.equal(viewportStreamName('abc-123', 'vertical-left'), 'abc-123__vertical-left');
    assert.deepEqual(parseStreamName('abc-123__vertical-left'), { apiKey: 'abc-123', viewport: 'vertical-left' });
    assert.deepEqual(parseStreamName('abc-123'), { apiKey: 'abc-123', viewport: null });
    assert.equal(isViewportStream('abc-123__v'), true);
    assert.equal(isViewportStream('abc-123'), false);
  });
});

describe('dsk-rtmp composite exclusion', () => {
  let rtmpServer, rtmpBase, calls;
  before(() => new Promise(resolve => {
    calls = [];
    const relayManager = { setDskRtmpSource: async (k, url) => { calls.push({ k, url }); } };
    const app = express();
    app.use('/dsk-rtmp', createDskRtmpRouter(db, relayManager));
    rtmpServer = createServer(app);
    rtmpServer.listen(0, () => { rtmpBase = `http://127.0.0.1:${rtmpServer.address().port}`; resolve(); });
  }));
  after(() => new Promise(resolve => rtmpServer.close(resolve)));

  it('triggers the program composite for a bare-key publish', async () => {
    calls.length = 0;
    const res = await fetch(`${rtmpBase}/dsk-rtmp/on_publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=progkey123',
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url);
  });

  it('does NOT trigger the composite for a viewport stream (__)', async () => {
    calls.length = 0;
    const res = await fetch(`${rtmpBase}/dsk-rtmp/on_publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=progkey123__vertical-left',
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 0, 'viewport stream must not restart the program relay');
  });
});
