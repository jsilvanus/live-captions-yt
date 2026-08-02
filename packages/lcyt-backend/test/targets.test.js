/**
 * Tests for the /targets router (server-persisted caption delivery targets,
 * plan/selfservice_config_backend §1).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { createUser } from '../src/db/users.js';
import { addMember } from '../src/db/project-members.js';
import { createProjectAccessMiddleware } from '../src/middleware/project-access.js';
import { createTargetsRouter } from '../src/routes/targets.js';

const JWT_SECRET = 'test-targets-secret';

// Real production mounting (content.js) uses scopedAuth()/
// createProjectAccessMiddleware, not the plain session-only auth — matters
// here because PUT/DELETE now go through requireProjectRole('setup')
// (plan_project_roles.md, decided 2026-07-26), which needs a real userId.
let server, baseUrl, db, apiKey, token, ownerToken;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const auth = createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'target' });
  const app = express();
  app.use(express.json());
  app.use('/targets', createTargetsRouter(auth, db));

  const k = createKey(db, { owner: 'TargetsUser' });
  apiKey = k.key;
  // Plain session token — no explicit owner needed for read, matches every
  // real session-authenticated client (no requireProjectRole write access).
  token = jwt.sign({ sessionId: 'targets-session', apiKey }, JWT_SECRET, { expiresIn: '1h' });
  // Explicit project owner — the token every write (POST/PUT/DELETE) test
  // below uses, since those now require 'setup' tier.
  const owner = createUser(db, { email: 'targets-owner@example.com', passwordHash: 'x' });
  addMember(db, apiKey, owner.id, 'owner');
  ownerToken = jwt.sign({ type: 'user', userId: owner.id, email: owner.email, projectId: apiKey }, JWT_SECRET, { expiresIn: '1h' });

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

// X-Api-Key mirrors how real clients always call project-scoped routes
// (see e.g. the DSK/mcp-tokens routes' own "JWT Bearer or X-API-Key"
// convention) — relying solely on the JWT's embedded projectId hits a real,
// separate resolveProjectId() param-scavenging fragility on any :id-shaped
// route (see CONSIDER.md), out of scope to fix here.
function bearer(tok = token, key = apiKey) {
  return { Authorization: `Bearer ${tok}`, 'X-Api-Key': key };
}

async function get(path = '/targets') {
  return fetch(`${baseUrl}${path}`, { headers: bearer() });
}
// Writes now require 'setup' tier (plan_project_roles.md) — default to the
// explicit-owner token; individual tests can still pass a different token.
async function post(path, body, tok = ownerToken) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { ...bearer(tok), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function put(path, body, tok = ownerToken) {
  return fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { ...bearer(tok), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function del(path, tok = ownerToken) {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE', headers: bearer(tok) });
}

describe('/targets', () => {
  it('rejects missing auth', async () => {
    const res = await fetch(`${baseUrl}/targets`);
    assert.equal(res.status, 401);
  });

  it('GET /targets returns an empty list initially', async () => {
    const res = await get();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.targets, []);
  });

  it('POST /targets 403s for a session token with no explicit project role (setup tier required)', async () => {
    const res = await post('/targets', { type: 'youtube', streamKey: 'nope' }, token);
    assert.equal(res.status, 403);
  });

  it('POST /targets creates a youtube target', async () => {
    const res = await post('/targets', { type: 'youtube', streamKey: 'abcd-1234' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.type, 'youtube');
    assert.equal(body.target.streamKey, 'abcd-1234');
    assert.equal(body.target.enabled, true);
    assert.ok(body.target.id);
  });

  it('POST /targets creates a generic target with headers', async () => {
    const res = await post('/targets', { type: 'generic', url: 'https://example.com/hook', headers: { 'X-Test': '1' } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.url, 'https://example.com/hook');
    assert.deepEqual(body.target.headers, { 'X-Test': '1' });
  });

  it('POST /targets creates a viewer target', async () => {
    const res = await post('/targets', { type: 'viewer', viewerKey: 'my-viewer-key' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.viewerKey, 'my-viewer-key');
  });

  it('POST /targets rejects an invalid type', async () => {
    const res = await post('/targets', { type: 'bogus' });
    assert.equal(res.status, 400);
  });

  it('POST /targets rejects a generic target with a bad URL', async () => {
    const res = await post('/targets', { type: 'generic', url: 'not-a-url' });
    assert.equal(res.status, 400);
  });

  it('POST /targets rejects a viewer target with a too-short viewerKey', async () => {
    const res = await post('/targets', { type: 'viewer', viewerKey: 'ab' });
    assert.equal(res.status, 400);
  });

  it('GET /targets lists all created targets ordered by sort_order', async () => {
    const res = await get();
    const body = await res.json();
    assert.equal(body.targets.length, 3);
    assert.equal(body.targets[0].type, 'youtube');
    assert.equal(body.targets[1].type, 'generic');
    assert.equal(body.targets[2].type, 'viewer');
  });

  it('PUT /targets/:id updates enabled and streamKey', async () => {
    const list = await (await get()).json();
    const yt = list.targets.find(t => t.type === 'youtube');
    const res = await put(`/targets/${yt.id}`, { enabled: false, streamKey: 'new-key' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.target.enabled, false);
    assert.equal(body.target.streamKey, 'new-key');
  });

  it('PUT /targets/:id returns 404 for an unknown id', async () => {
    const res = await put('/targets/does-not-exist', { enabled: true });
    assert.equal(res.status, 404);
  });

  it('PUT /targets/reorder persists a new sort order', async () => {
    const list = await (await get()).json();
    const ids = list.targets.map(t => t.id);
    const reversed = [...ids].reverse();
    const res = await put('/targets/reorder', { order: reversed });
    assert.equal(res.status, 200);

    const after = await (await get()).json();
    assert.deepEqual(after.targets.map(t => t.id), reversed);
  });

  it('PUT /targets/reorder rejects an unknown id', async () => {
    const res = await put('/targets/reorder', { order: ['nope'] });
    assert.equal(res.status, 400);
  });

  it('DELETE /targets/:id removes a target', async () => {
    const list = await (await get()).json();
    const victim = list.targets[0];
    const res = await del(`/targets/${victim.id}`);
    assert.equal(res.status, 200);

    const after = await (await get()).json();
    assert.equal(after.targets.length, 2);
    assert.ok(!after.targets.find(t => t.id === victim.id));
  });

  it('DELETE /targets/:id returns 404 for an unknown id', async () => {
    const res = await del('/targets/does-not-exist');
    assert.equal(res.status, 404);
  });

  it('targets are scoped per api_key', async () => {
    const otherKey = createKey(db, { owner: 'OtherProject' });
    const otherToken = jwt.sign({ sessionId: 'other-session', apiKey: otherKey.key }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/targets`, { headers: bearer(otherToken, otherKey.key) });
    const body = await res.json();
    assert.deepEqual(body.targets, []);
  });
});

describe('/targets — viewer icon config', () => {
  it('defaults iconId=null and iconEnabled=false on a new viewer target', async () => {
    const body = await (await post('/targets', { type: 'viewer', viewerKey: 'icon-default' })).json();
    assert.equal(body.target.iconId, null);
    assert.equal(body.target.iconEnabled, false);
  });

  it('persists iconId + iconEnabled through create', async () => {
    const body = await (await post('/targets', { type: 'viewer', viewerKey: 'icon-create', iconId: 7, iconEnabled: true })).json();
    assert.equal(body.target.iconId, 7);
    assert.equal(body.target.iconEnabled, true);
  });

  it('round-trips iconId + iconEnabled through GET', async () => {
    const created = await (await post('/targets', { type: 'viewer', viewerKey: 'icon-get', iconId: 3, iconEnabled: true })).json();
    const list = await (await get()).json();
    const found = list.targets.find(t => t.id === created.target.id);
    assert.equal(found.iconId, 3);
    assert.equal(found.iconEnabled, true);
  });

  it('updates iconId + iconEnabled and preserves iconId when only toggling off', async () => {
    const created = await (await post('/targets', { type: 'viewer', viewerKey: 'icon-update', iconId: 5, iconEnabled: true })).json();
    const id = created.target.id;

    // Toggle off without sending iconId — the chosen icon must be preserved.
    let body = await (await put(`/targets/${id}`, { iconEnabled: false })).json();
    assert.equal(body.target.iconEnabled, false);
    assert.equal(body.target.iconId, 5);

    // Re-enable and change the icon.
    body = await (await put(`/targets/${id}`, { iconEnabled: true, iconId: 9 })).json();
    assert.equal(body.target.iconEnabled, true);
    assert.equal(body.target.iconId, 9);

    // Clearing the icon.
    body = await (await put(`/targets/${id}`, { iconId: null })).json();
    assert.equal(body.target.iconId, null);
  });

  it('normalizes invalid iconId to null', async () => {
    const body = await (await post('/targets', { type: 'viewer', viewerKey: 'icon-bad', iconId: 'abc', iconEnabled: true })).json();
    assert.equal(body.target.iconId, null);
  });

  it('ignores icon fields on non-viewer targets', async () => {
    const body = await (await post('/targets', { type: 'youtube', streamKey: 'yt-icon', iconId: 4, iconEnabled: true })).json();
    assert.equal(body.target.iconId, null);
    assert.equal(body.target.iconEnabled, false);
  });
});
