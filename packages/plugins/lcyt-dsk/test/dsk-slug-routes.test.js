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
import { createDskViewportsRouter, RESERVED_VIEWPORT_NAMES } from '../src/routes/dsk-viewports.js';
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
      key TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1, public_slug TEXT UNIQUE
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
