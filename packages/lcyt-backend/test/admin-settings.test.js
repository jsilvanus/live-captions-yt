/**
 * Tests for the /admin/server-settings router (plan_env_to_ui_settings.md):
 * auth enforcement, secret masking, 409 on Tier A/env-locked keys,
 * all-or-nothing batch validation, and revert-to-default.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from '../src/db.js';
import { createAdminMiddleware } from '../src/middleware/admin.js';
import { createAdminSettingsRouter } from '../src/routes/admin-settings.js';
import { SettingsService } from '../src/settings/service.js';

const ADMIN_KEY = 'test-admin-key-settings';
const JWT_SECRET = 'test-jwt-secret-settings';

let server, baseUrl, db, settings;

before(() => new Promise((resolve) => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = initDb(':memory:');
  settings = new SettingsService(db);

  const app = express();
  app.use(express.json());
  app.use('/admin/server-settings', createAdminMiddleware(db, JWT_SECRET), createAdminSettingsRouter(db, settings));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  delete process.env.ADMIN_KEY;
  db.close();
  server.close(resolve);
}));

beforeEach(() => {
  delete process.env.CONTACT_EMAIL;
});

afterEach(() => {
  delete process.env.CONTACT_EMAIL;
});

async function req(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('auth', () => {
  it('rejects GET without admin credentials', async () => {
    const res = await fetch(`${baseUrl}/admin/server-settings`);
    assert.equal(res.status, 401);
  });

  it('allows GET with X-Admin-Key', async () => {
    const { status } = await req('GET', '/admin/server-settings');
    assert.equal(status, 200);
  });
});

describe('GET /admin/server-settings', () => {
  it('groups entries by category and masks secrets', async () => {
    const { status, body } = await req('GET', '/admin/server-settings');
    assert.equal(status, 200);
    assert.ok(body.categories.contact);
    assert.ok(body.categories.stt);
    const secretEntry = body.categories.stt.find(e => e.key === 'stt.google_stt_key');
    assert.equal(secretEntry.secret, true);
    assert.equal(secretEntry.value, null);
  });
});

describe('PUT /admin/server-settings', () => {
  it('rejects a malformed body', async () => {
    const { status } = await req('PUT', '/admin/server-settings', { body: { values: 'nope' } });
    assert.equal(status, 400);
  });

  it('writes a valid Tier B key and returns the fresh snapshot', async () => {
    const { status, body } = await req('PUT', '/admin/server-settings', {
      body: { values: { 'contact.email': 'ops@example.com' } },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.updated, ['contact.email']);
    const entry = body.snapshot.find(s => s.key === 'contact.email');
    assert.equal(entry.value, 'ops@example.com');
    assert.equal(entry.source, 'db');
  });

  it('409s on a Tier A key and writes nothing', async () => {
    const { status, body } = await req('PUT', '/admin/server-settings', {
      body: { values: { 'bootstrap.jwt_secret': 'nope' } },
    });
    assert.equal(status, 409);
    assert.equal(body.key, 'bootstrap.jwt_secret');
  });

  it('409s when the env var is currently set (env-locked)', async () => {
    process.env.CONTACT_EMAIL = 'env@example.com';
    const { status, body } = await req('PUT', '/admin/server-settings', {
      body: { values: { 'contact.email': 'db@example.com' } },
    });
    assert.equal(status, 409);
    assert.equal(body.key, 'contact.email');
  });

  it('all-or-nothing: one bad key in a batch writes none of them', async () => {
    // contact.website is untouched by earlier tests in this file — a fresh
    // key, so this assertion isn't riding on shared-server test ordering.
    const { status } = await req('PUT', '/admin/server-settings', {
      body: { values: { 'contact.website': 'https://example.com', 'bootstrap.jwt_secret': 'nope' } },
    });
    assert.equal(status, 409);
    const { body } = await req('GET', '/admin/server-settings');
    const entry = body.categories.contact.find(s => s.key === 'contact.website');
    assert.equal(entry.source, 'default'); // unaffected by the rejected batch
  });

  it('404s on an unknown key', async () => {
    const { status } = await req('PUT', '/admin/server-settings', {
      body: { values: { 'not.a.real.key': 1 } },
    });
    assert.equal(status, 404);
  });

  it('rejects an invalid enum value', async () => {
    const { status } = await req('PUT', '/admin/server-settings', {
      body: { values: { 'stt.provider': 'not-a-provider' } },
    });
    assert.equal(status, 400);
  });
});

describe('DELETE /admin/server-settings/:key', () => {
  it('reverts a key to its default', async () => {
    await req('PUT', '/admin/server-settings', { body: { values: { 'contact.name': 'Ops Team' } } });
    const { status, body } = await req('DELETE', '/admin/server-settings/contact.name');
    assert.equal(status, 200);
    assert.equal(body.source, 'default');
    assert.equal(body.value, '');
  });

  it('409s reverting a Tier A key', async () => {
    const { status } = await req('DELETE', '/admin/server-settings/bootstrap.jwt_secret');
    assert.equal(status, 409);
  });
});
