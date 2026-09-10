/**
 * Route-level tests for routes/dsk-templates.js's requireProduction() gate
 * on the live graphics-operate actions (activate, the /template alias,
 * broadcast, graphics-push, renderer start/stop) — plan_project_roles.md's
 * "/graphics page tier was never decided" gap, closed at the 'production'
 * tier (see CONSIDER.md).
 *
 * Unlike requireSetup() (dsk-viewports.js/dsk-templates.js's template CRUD),
 * requireProduction() deliberately fails OPEN when req.user.userId is absent
 * — DskControlPage.jsx's sidebar mode authenticates with a plain
 * caption-session JWT that carries no per-user identity at all, and must
 * keep working unaffected by this gate.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db.js';
import { createDskTemplatesRouter } from '../src/routes/dsk-templates.js';
import { saveTemplate } from '../src/db/dsk-templates.js';

let db;

function makeApp(auth, deps = {}) {
  const app = express();
  app.use(express.json());
  app.use('/dsk', createDskTemplatesRouter(db, auth, null, null, null, null, deps));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

// Real per-user identity (e.g. DskControlPage.jsx standalone mode's
// persisted project-access token).
function realUserAuth(req, _res, next) {
  const k = req.headers['x-api-key'];
  if (k) { req.session = { apiKey: k }; req.user = { userId: 1 }; }
  next();
}

// Plain session-JWT identity (DskControlPage.jsx sidebar mode's
// session.getSessionToken()) — no req.user at all.
function sessionOnlyAuth(req, _res, next) {
  const k = req.headers['x-api-key'];
  if (k) req.session = { apiKey: k };
  next();
}

const permissiveDeps = { checkProjectRole: () => true };

before(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS caption_files (id INTEGER PRIMARY KEY)');
  runMigrations(db);
});

after(() => db.close());

describe('dsk-templates live graphics-operate routes — Production-tier gate', () => {
  it('POST .../activate: a plain session JWT (no req.user) fails OPEN — DskControlPage.jsx sidebar mode', async () => {
    const id = saveTemplate(db, { apiKey: 'proj-a', name: 'T1', templateJson: { layers: [] } });
    const { server, baseUrl } = await listen(makeApp(sessionOnlyAuth, { checkProjectRole: () => false }));
    const res = await fetch(`${baseUrl}/dsk/proj-a/templates/${id}/activate`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    // Not blocked by requireProduction (would be 403) — reaches the real handler.
    assert.notEqual(res.status, 403);
    server.close();
  });

  it('POST .../activate: a real per-user JWT is checked against the production tier and rejected', async () => {
    const id = saveTemplate(db, { apiKey: 'proj-a', name: 'T1', templateJson: { layers: [] } });
    const seen = [];
    const { server, baseUrl } = await listen(makeApp(realUserAuth, { checkProjectRole: (tier) => { seen.push(tier); return false; } }));
    const res = await fetch(`${baseUrl}/dsk/proj-a/templates/${id}/activate`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['production']);
    server.close();
  });

  it('POST .../activate: a real per-user JWT with operator+ succeeds', async () => {
    const id = saveTemplate(db, { apiKey: 'proj-a', name: 'T1', templateJson: { layers: [] } });
    const { server, baseUrl } = await listen(makeApp(realUserAuth, permissiveDeps));
    const res = await fetch(`${baseUrl}/dsk/proj-a/templates/${id}/activate`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 200);
    server.close();
  });

  it('POST .../activate: no deps at all fails closed for a real per-user JWT', async () => {
    const id = saveTemplate(db, { apiKey: 'proj-a', name: 'T1', templateJson: { layers: [] } });
    const { server, baseUrl } = await listen(makeApp(realUserAuth)); // no deps
    const res = await fetch(`${baseUrl}/dsk/proj-a/templates/${id}/activate`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 403);
    server.close();
  });

  it('POST /template (activate-by-id alias) is gated the same way', async () => {
    const id = saveTemplate(db, { apiKey: 'proj-a', name: 'T1', templateJson: { layers: [] } });
    const { server, baseUrl } = await listen(makeApp(realUserAuth, { checkProjectRole: () => false }));
    const res = await fetch(`${baseUrl}/dsk/proj-a/template`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    assert.equal(res.status, 403);
    server.close();
  });

  it('POST /broadcast is gated the same way', async () => {
    const { server, baseUrl } = await listen(makeApp(realUserAuth, { checkProjectRole: () => false }));
    const res = await fetch(`${baseUrl}/dsk/proj-a/broadcast`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: '#a', text: 'x' }),
    });
    assert.equal(res.status, 403);
    server.close();
  });

  it('POST /graphics is gated the same way', async () => {
    const { server, baseUrl } = await listen(makeApp(realUserAuth, { checkProjectRole: () => false }));
    const res = await fetch(`${baseUrl}/dsk/proj-a/graphics`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ default: [] }),
    });
    assert.equal(res.status, 403);
    server.close();
  });

  it('POST /renderer/start and /renderer/stop are gated the same way', async () => {
    const { server, baseUrl } = await listen(makeApp(realUserAuth, { checkProjectRole: () => false }));
    const start = await fetch(`${baseUrl}/dsk/proj-a/renderer/start`, { method: 'POST', headers: { 'x-api-key': 'proj-a' } });
    assert.equal(start.status, 403);
    const stop = await fetch(`${baseUrl}/dsk/proj-a/renderer/stop`, { method: 'POST', headers: { 'x-api-key': 'proj-a' } });
    assert.equal(stop.status, 403);
    server.close();
  });

  it('cross-key access is still rejected before requireProduction ever matters (checkOwner)', async () => {
    const id = saveTemplate(db, { apiKey: 'proj-a', name: 'T1', templateJson: { layers: [] } });
    const { server, baseUrl } = await listen(makeApp(realUserAuth, permissiveDeps));
    // Authenticated as proj-b, but the URL's :apikey segment is proj-a.
    const res = await fetch(`${baseUrl}/dsk/proj-a/templates/${id}/activate`, {
      method: 'POST', headers: { 'x-api-key': 'proj-b' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'Forbidden');
    server.close();
  });
});
