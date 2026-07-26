/**
 * Route-level tests for routes/mixers.js's opts.auth wiring and
 * registry.notifyProgramChanged() firing (plan_vertical_crop.md §4
 * production-follow) — first route-level test file for this router.
 *
 * Covers:
 *   - opts.auth gates every route except the WHIP/sources kiosk carve-out
 *     (mirrors routes/cameras.js's isUnauthenticatedCameraRoute() tests).
 *   - POST /:id/switch/:inputNumber notifies with the acting session's
 *     apiKey after a successful switch, for BOTH the direct-registry branch
 *     (lcyt mixer type) and the bridge-relayed branch (roland-style mixer
 *     with a connected bridge — which never calls registry.switchSource()
 *     at all, so the notification must come from the route, not from
 *     switchSource() itself).
 *   - No notification on a failed switch.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createMixersRouter } from '../src/routes/mixers.js';

let server, baseUrl, db;

function insertBridgeInstance(id = 'bridge-1') {
  db.prepare(`
    INSERT OR IGNORE INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)
  `).run(id, 'Bridge 1', `tok-${id}`);
  return id;
}

function insertMixer(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config, bridge_instance_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Mixer 1',
    overrides.type ?? 'lcyt',
    JSON.stringify(overrides.connection_config ?? {}),
    overrides.bridge_instance_id ?? null,
  );
  return id;
}

function makeRegistryStub() {
  const notified = [];
  return {
    notified,
    isMixerConnected: () => true,
    getActiveSource: () => null,
    switchSource: async () => {},
    reloadMixer: async () => {},
    removeMixer: async () => {},
    notifyProgramChanged(data) { notified.push(data); },
  };
}

// Stand-in for scopedAuth('production') — see cameras-routes.test.js.
function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  req.user = { userId: 1 };
  next();
}

// Permissive stand-in for the composition root's real checkProjectRole — see
// cameras-routes.test.js's identical comment.
const permissiveDeps = { checkProjectRole: () => true };

function startApp(registry, bridgeManager = null, opts = {}) {
  const app = express();
  app.use(express.json());
  app.use('/production/mixers', createMixersRouter(db, registry, bridgeManager, opts));
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
  if (server) { server.close(); server = null; }
});

describe('mixers router — auth wiring', () => {
  it('no opts.auth: routes stay fully open (historical behavior)', async () => {
    const id = insertMixer();
    await startApp(makeRegistryStub());
    const res = await fetch(`${baseUrl}/production/mixers/${id}`);
    assert.equal(res.status, 200);
  });

  it('opts.auth configured: GET /:id requires it', async () => {
    const id = insertMixer();
    await startApp(makeRegistryStub(), null, { auth: fakeAuth, deps: permissiveDeps });
    const unauth = await fetch(`${baseUrl}/production/mixers/${id}`);
    assert.equal(unauth.status, 401);
    const authed = await fetch(`${baseUrl}/production/mixers/${id}`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(authed.status, 200);
  });

  it('opts.auth configured: /sources and /whip-url stay unauthenticated (LcytMixerPage kiosk)', async () => {
    const id = insertMixer({ type: 'lcyt' });
    await startApp(makeRegistryStub(), null, { auth: fakeAuth, deps: permissiveDeps });
    const sources = await fetch(`${baseUrl}/production/mixers/${id}/sources`);
    assert.notEqual(sources.status, 401);
    const whipUrl = await fetch(`${baseUrl}/production/mixers/${id}/whip-url`);
    assert.notEqual(whipUrl.status, 401);
  });

  it('opts.auth configured: POST /:id/switch/:inputNumber stays unauthenticated (LcytMixerPage kiosk cut button)', async () => {
    // LcytMixerPage.jsx plain-fetch()s this route with no Authorization
    // header, same as /sources and /whip-url — regression test for the
    // switch route having been accidentally left out of the carve-out.
    const id = insertMixer({ type: 'lcyt' });
    await startApp(makeRegistryStub(), null, { auth: fakeAuth, deps: permissiveDeps });
    const res = await fetch(`${baseUrl}/production/mixers/${id}/switch/1`, { method: 'POST' });
    assert.notEqual(res.status, 401);
  });
});

describe('POST /:id/switch/:inputNumber — production-follow notification', () => {
  it('direct (lcyt, non-bridge) switch notifies with the acting session apiKey', async () => {
    const id = insertMixer({ type: 'lcyt' });
    const registry = makeRegistryStub();
    await startApp(registry, null, { auth: fakeAuth, deps: permissiveDeps });

    const res = await fetch(`${baseUrl}/production/mixers/${id}/switch/2`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: 'proj-a', mixerId: id, inputNumber: 2 }]);
  });

  it('bridge-relayed switch also notifies, without ever calling registry.switchSource()', async () => {
    insertBridgeInstance('bridge-1');
    const id = insertMixer({ type: 'roland', connection_config: { host: '10.0.0.5' }, bridge_instance_id: 'bridge-1' });
    const registry = makeRegistryStub();
    let switchSourceCalled = false;
    registry.switchSource = async () => { switchSourceCalled = true; };
    const bridgeManager = {
      isConnected: () => true,
      sendCommand: async () => ({ ok: true }),
    };
    await startApp(registry, bridgeManager, { auth: fakeAuth, deps: permissiveDeps });

    const res = await fetch(`${baseUrl}/production/mixers/${id}/switch/3`, {
      method: 'POST', headers: { 'x-api-key': 'proj-b' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: 'proj-b', mixerId: id, inputNumber: 3 }]);
    assert.equal(switchSourceCalled, false, 'bridge branch must not fall through to registry.switchSource()');
  });

  it('no notification when the bridge is not connected (switch fails)', async () => {
    insertBridgeInstance('bridge-1');
    const id = insertMixer({ type: 'roland', connection_config: { host: '10.0.0.5' }, bridge_instance_id: 'bridge-1' });
    const registry = makeRegistryStub();
    const bridgeManager = { isConnected: () => false, sendCommand: async () => {} };
    await startApp(registry, bridgeManager, { auth: fakeAuth, deps: permissiveDeps });

    const res = await fetch(`${baseUrl}/production/mixers/${id}/switch/1`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 503);
    assert.deepEqual(registry.notified, []);
  });

  it('apiKey is null when auth is not configured (historical open behavior)', async () => {
    const id = insertMixer({ type: 'lcyt' });
    const registry = makeRegistryStub();
    await startApp(registry); // no auth opt

    const res = await fetch(`${baseUrl}/production/mixers/${id}/switch/1`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: null, mixerId: id, inputNumber: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Setup/Production tier gate (plan_project_roles.md, decided 2026-07-26)
// ---------------------------------------------------------------------------

describe('Setup/Production tier gate', () => {
  it('POST / (create) 403s when no deps.checkProjectRole is injected at all (fail closed)', async () => {
    await startApp(makeRegistryStub(), null, { auth: fakeAuth }); // no deps
    const res = await fetch(`${baseUrl}/production/mixers`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Mixer', type: 'lcyt' }),
    });
    assert.equal(res.status, 403);
  });

  it('POST / (create) 403s when checkProjectRole rejects the role, requesting the setup tier', async () => {
    const seen = [];
    await startApp(makeRegistryStub(), null, {
      auth: fakeAuth,
      deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } },
    });
    const res = await fetch(`${baseUrl}/production/mixers`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Mixer', type: 'lcyt' }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['setup']);
  });

  it('POST / (create) succeeds when checkProjectRole allows it', async () => {
    await startApp(makeRegistryStub(), null, { auth: fakeAuth, deps: permissiveDeps });
    const res = await fetch(`${baseUrl}/production/mixers`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Mixer', type: 'lcyt' }),
    });
    assert.equal(res.status, 201);
  });

  it('POST /:id/switch/:inputNumber (live control, credentialed) 403s when checkProjectRole rejects, requesting the production tier', async () => {
    const id = insertMixer({ type: 'lcyt' });
    const seen = [];
    await startApp(makeRegistryStub(), null, {
      auth: fakeAuth,
      deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } },
    });
    const res = await fetch(`${baseUrl}/production/mixers/${id}/switch/1`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['production']);
  });

  it('POST /:id/test 403s when checkProjectRole rejects, requesting the production tier', async () => {
    const id = insertMixer({ type: 'roland', connection_config: { host: '10.0.0.5' } });
    const seen = [];
    await startApp(makeRegistryStub(), null, {
      auth: fakeAuth,
      deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } },
    });
    const res = await fetch(`${baseUrl}/production/mixers/${id}/test`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['production']);
  });

  it('GET / stays open regardless of the gate (read is never blocked)', async () => {
    await startApp(makeRegistryStub(), null, { auth: fakeAuth, deps: { checkProjectRole: () => false } });
    const res = await fetch(`${baseUrl}/production/mixers`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(res.status, 200);
  });
});
