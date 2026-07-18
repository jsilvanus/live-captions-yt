import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { createRadioRouter } from '../src/routes/radio.js';
import { runRadioMigrations } from '../src/db/radio.js';

/**
 * Mock RadioManager for testing.
 */
class MockRadioManager {
  constructor() {
    this._running = new Set();
    this.isNginxEnabled = false;
  }

  isRunning(key) {
    return this._running.has(key);
  }

  setRunning(key, running) {
    if (running) {
      this._running.add(key);
    } else {
      this._running.delete(key);
    }
  }

  getPublicHlsUrl(key, backendOrigin) {
    return `${backendOrigin}/radio/${key}/index.m3u8`;
  }

  getSlug(key) {
    return `slug-${key}`;
  }

  getInternalHlsUrl(key) {
    return `http://mediamtx:8080/hlsVariant/${key}`;
  }
}

/**
 * Set up a test database with the radio_config table and an api_keys table.
 */
function setupTestDb() {
  const db = new Database(':memory:');

  // Create api_keys table with radio_enabled flag
  db.exec(`
    CREATE TABLE api_keys (
      key TEXT PRIMARY KEY,
      radio_enabled INTEGER NOT NULL DEFAULT 0,
      embed_cors TEXT DEFAULT '*'
    );
  `);

  // Run radio migrations
  runRadioMigrations(db);

  return db;
}

let db, server, baseUrl, radioManager;

before(async () => {
  db = setupTestDb();
  radioManager = new MockRadioManager();

  // Create test keys
  db.prepare('INSERT INTO api_keys (key, radio_enabled) VALUES (?, ?)').run('enabled-key', 1);
  db.prepare('INSERT INTO api_keys (key, radio_enabled) VALUES (?, ?)').run('disabled-key', 0);

  const app = express();
  app.use('/radio', createRadioRouter(db, radioManager));

  await new Promise(resolve => {
    server = createServer(app).listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise(r => server.close(() => { db.close(); r(); })));

beforeEach(() => {
  radioManager._running.clear();
  radioManager.isNginxEnabled = false;
});

const j = (method, path, body) => fetch(`${baseUrl}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe('GET /radio/:key/info — radio_enabled flag', () => {
  test('when radio_enabled is true and stream is live', async () => {
    radioManager.setRunning('enabled-key', true);

    const res = await j('GET', '/radio/enabled-key/info');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.live, true);
    assert.ok(body.hlsUrl, 'hlsUrl should be present when enabled');
    assert.match(body.hlsUrl, /\/radio\/enabled-key\/index\.m3u8/);
  });

  test('when radio_enabled is true and stream is not live', async () => {
    radioManager.setRunning('enabled-key', false);

    const res = await j('GET', '/radio/enabled-key/info');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.live, false);
    assert.ok(body.hlsUrl, 'hlsUrl should be present when enabled, even if not live');
    assert.match(body.hlsUrl, /\/radio\/enabled-key\/index\.m3u8/);
  });

  test('when radio_enabled is false, live is false and hlsUrl is omitted', async () => {
    radioManager.setRunning('disabled-key', false);

    const res = await j('GET', '/radio/disabled-key/info');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.live, false, 'live should be false when radio is disabled');
    assert.equal(body.hlsUrl, undefined, 'hlsUrl should be undefined when radio is disabled');
  });

  test('when radio_enabled is false, live is always false even if stream would be running', async () => {
    // Even if the stream is running, it should not be reflected when the feature is disabled
    radioManager.setRunning('disabled-key', true);

    const res = await j('GET', '/radio/disabled-key/info');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.live, false, 'live should be false when radio is disabled, regardless of actual state');
    assert.equal(body.hlsUrl, undefined, 'hlsUrl should be undefined when radio is disabled');
  });

  test('includes metadata fields regardless of enabled status', async () => {
    // Set metadata for the disabled key
    db.prepare(`
      INSERT INTO radio_config (api_key, title, description, cover_image_url, autoplay)
      VALUES (?, ?, ?, ?, ?)
    `).run('disabled-key', 'Test Title', 'Test Description', 'https://example.com/cover.jpg', 1);

    const res = await j('GET', '/radio/disabled-key/info');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.title, 'Test Title');
    assert.equal(body.description, 'Test Description');
    assert.equal(body.coverImageUrl, 'https://example.com/cover.jpg');
    assert.equal(body.autoplay, true);
  });

  test('has correct CORS headers', async () => {
    const res = await j('GET', '/radio/enabled-key/info');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  });

  test('rejects invalid key format', async () => {
    const res = await j('GET', '/radio/ab/info'); // too short
    assert.equal(res.status, 400);

    const body = await res.json();
    assert.ok(body.error);
  });
});

describe('GET /radio/:key/info — slug handling', () => {
  test('omits slug when nginx is not enabled', async () => {
    radioManager.isNginxEnabled = false;

    const res = await j('GET', '/radio/enabled-key/info');
    const body = await res.json();

    assert.equal(body.slug, undefined);
  });

  test('includes slug when nginx is enabled', async () => {
    radioManager.isNginxEnabled = true;

    const res = await j('GET', '/radio/enabled-key/info');
    const body = await res.json();

    assert.equal(body.slug, 'slug-enabled-key');
  });
});
