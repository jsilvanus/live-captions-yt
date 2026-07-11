/**
 * Tests for project public-slug routes and helpers
 * (plan_dsk_viewport_settings Phase 1).
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';

import { initDb } from '../src/db.js';
import { createUser } from '../src/db/users.js';
import { createKey, validatePublicSlugFormat, resolveKeyByPublicSlug } from '../src/db/keys.js';
import { createOrganization, updateOrganization } from '../src/db/orgs.js';
import { createProjectSlugRouter } from '../src/routes/project-slug.js';

const JWT_SECRET = 'test-slug-secret';
const ADMIN_KEY = 'test-admin-key-slug';

let server, baseUrl, db, owner, outsider;

function makeToken(user) {
  return jwt.sign({ type: 'user', userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
}

function authed(user) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken(user)}` };
}

before(() => new Promise(resolve => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = initDb(':memory:');

  const app = express();
  app.use(express.json());
  app.use('/keys/:key/slug', createProjectSlugRouter(db, { loginEnabled: true, jwtSecret: JWT_SECRET }));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  delete process.env.ADMIN_KEY;
  db.close();
  server.close(resolve);
}));

beforeEach(() => {
  // FK-safe order: api_keys references organizations and users
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM org_members').run();
  db.prepare('DELETE FROM organizations').run();
  db.prepare('DELETE FROM users').run();
  owner = createUser(db, { email: 'owner@example.com', passwordHash: 'hash', name: 'Owner' });
  outsider = createUser(db, { email: 'other@example.com', passwordHash: 'hash', name: 'Other' });
});

function makeProject({ orgId = null } = {}) {
  return createKey(db, { key: `proj-${Math.random().toString(36).slice(2, 10)}`, owner: 'P', user_id: owner.id, org_id: orgId });
}

describe('validatePublicSlugFormat', () => {
  it('accepts valid slugs and rejects bad formats', () => {
    assert.equal(validatePublicSlugFormat('sunday-service').ok, true);
    assert.equal(validatePublicSlugFormat('abc').ok, true);
    assert.equal(validatePublicSlugFormat('a1-b2-c3').ok, true);

    for (const bad of ['ab', 'Sunday', '-abc', 'abc-', 'a--b', 'a_b', 'a'.repeat(41), '', 'events', 'images', 'admin']) {
      assert.equal(validatePublicSlugFormat(bad).ok, false, `expected '${bad}' to be rejected`);
    }
  });
});

describe('GET /keys/:key/slug', () => {
  it('returns null slug and no prefix for a plain project', async () => {
    const proj = makeProject();
    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, { headers: authed(owner) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { slug: null, requiredPrefix: null });
  });

  it('returns the org-policy prefix when the org enforces one', async () => {
    const org = createOrganization(db, { name: 'Team One', slug: 'team1', ownerUserId: owner.id });
    updateOrganization(db, org.id, { projectSlugPolicy: 'prefix' });
    const proj = makeProject({ orgId: org.id });

    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, { headers: authed(owner) });
    const data = await res.json();
    assert.equal(data.requiredPrefix, 'team1-');
  });

  it('rejects users without project access', async () => {
    const proj = makeProject();
    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, { headers: authed(outsider) });
    assert.equal(res.status, 403);
  });
});

describe('PUT /keys/:key/slug', () => {
  it('sets a valid slug and makes it resolvable', async () => {
    const proj = makeProject();
    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, {
      method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'sunday-service' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, slug: 'sunday-service' });
    assert.equal(resolveKeyByPublicSlug(db, 'sunday-service'), proj.key);
  });

  it('clears the slug with null', async () => {
    const proj = makeProject();
    await fetch(`${baseUrl}/keys/${proj.key}/slug`, { method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'to-clear' }) });
    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, { method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: null }) });
    assert.equal(res.status, 200);
    assert.equal(resolveKeyByPublicSlug(db, 'to-clear'), null);
  });

  it('rejects reserved words, bad formats, and taken slugs with reasons', async () => {
    const projA = makeProject();
    const projB = makeProject();
    await fetch(`${baseUrl}/keys/${projA.key}/slug`, { method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'taken-slug' }) });

    for (const [slug, fragment] of [['events', 'reserved'], ['Bad Slug', 'lowercase'], ['taken-slug', 'taken']]) {
      const res = await fetch(`${baseUrl}/keys/${projB.key}/slug`, {
        method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug }),
      });
      assert.equal(res.status, 400, `expected 400 for '${slug}'`);
      const data = await res.json();
      assert.ok(data.error.toLowerCase().includes(fragment), `'${data.error}' should mention ${fragment}`);
    }
  });

  it('re-setting the same slug on the same project is idempotent', async () => {
    const proj = makeProject();
    await fetch(`${baseUrl}/keys/${proj.key}/slug`, { method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'same-slug' }) });
    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, { method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'same-slug' }) });
    assert.equal(res.status, 200);
  });

  it('enforces the org prefix policy for users but not for admin', async () => {
    const org = createOrganization(db, { name: 'Team One', slug: 'team1', ownerUserId: owner.id });
    updateOrganization(db, org.id, { projectSlugPolicy: 'prefix' });
    const proj = makeProject({ orgId: org.id });

    const denied = await fetch(`${baseUrl}/keys/${proj.key}/slug`, {
      method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'freeform' }),
    });
    assert.equal(denied.status, 400);
    assert.ok((await denied.json()).error.includes("team1-"));

    const allowed = await fetch(`${baseUrl}/keys/${proj.key}/slug`, {
      method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'team1-sunday' }),
    });
    assert.equal(allowed.status, 200);

    // Site admin bypasses the prefix policy
    const adminSet = await fetch(`${baseUrl}/keys/${proj.key}/slug`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
      body: JSON.stringify({ slug: 'freeform' }),
    });
    assert.equal(adminSet.status, 200);
  });

  it('rejects writes from non-managing users', async () => {
    const proj = makeProject();
    const res = await fetch(`${baseUrl}/keys/${proj.key}/slug`, {
      method: 'PUT', headers: authed(outsider), body: JSON.stringify({ slug: 'nope-slug' }),
    });
    assert.equal(res.status, 403);
  });
});

describe('GET /keys/:key/slug/check', () => {
  it('reports availability with a reason when unavailable', async () => {
    const projA = makeProject();
    const projB = makeProject();
    await fetch(`${baseUrl}/keys/${projA.key}/slug`, { method: 'PUT', headers: authed(owner), body: JSON.stringify({ slug: 'claimed' }) });

    const free = await fetch(`${baseUrl}/keys/${projB.key}/slug/check?slug=unclaimed`, { headers: authed(owner) });
    assert.deepEqual(await free.json(), { available: true });

    const taken = await fetch(`${baseUrl}/keys/${projB.key}/slug/check?slug=claimed`, { headers: authed(owner) });
    const data = await taken.json();
    assert.equal(data.available, false);
    assert.ok(data.reason);

    // A project's own current slug counts as available (re-save is a no-op)
    const own = await fetch(`${baseUrl}/keys/${projA.key}/slug/check?slug=claimed`, { headers: authed(owner) });
    assert.deepEqual(await own.json(), { available: true });
  });
});
