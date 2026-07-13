import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createCropRouter } from '../src/routes/crop.js';
import { runCropMigrations } from '../src/db/crop.js';

const servers = [];

function startApp(db, cropManager) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { apiKey: 'demo-key' };
    next();
  });
  app.use('/crop', createCropRouter(db, (_req, _res, next) => next(), cropManager));
  return new Promise(resolve => {
    const srv = app.listen(0, () => resolve(srv));
  });
}

after(() => Promise.all(servers.map(srv => new Promise(resolve => srv.close(resolve)))));

test('crop config CRUD works through the router', async () => {
  const db = new Database(':memory:');
  runCropMigrations(db);
  const cropManager = {
    getState() { return { running: false, repositionMode: 'restart' }; },
    async applyConfig() { return this.getState(); },
    async applyPosition() { return this.getState(); },
    async activatePreset() { return this.getState(); },
  };
  const srv = await startApp(db, cropManager);
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;

  let res = await fetch(`${base}/crop/config`);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.enabled, false);
  assert.equal(body.running, false);

  res = await fetch(`${base}/crop/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, aspectW: 9, aspectH: 16, outW: 1080, outH: 1920, followProgram: true, transitionMs: 250 }),
  });
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.enabled, true);
  assert.equal(body.transitionMs, 250);

  res = await fetch(`${base}/crop/presets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Center', xNorm: 0.5, yNorm: 0.0 }),
  });
  assert.equal(res.status, 201);
  body = await res.json();
  assert.equal(body.preset.name, 'Center');

  res = await fetch(`${base}/crop/presets`);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.presets.length, 1);

  res = await fetch(`${base}/crop/sets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Main' }),
  });
  assert.equal(res.status, 201);
  body = await res.json();
  assert.equal(body.set.name, 'Main');
});
