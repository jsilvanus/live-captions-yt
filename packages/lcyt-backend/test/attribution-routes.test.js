import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { createFeedAttributor } from '../src/feed-attributor.js';
import { createAttributionRouter } from '../src/routes/attribution.js';

let server, base, db, attributor;
before(async () => {
  db = new Database(':memory:'); runMigrations(db);
  db.prepare(`INSERT INTO prod_cameras (id, name, control_type, control_config, sort_order, owner_api_key) VALUES ('mine','Mine','visca-ip','{}',0,'k1')`).run();
  db.prepare(`INSERT INTO prod_cameras (id, name, control_type, control_config, sort_order, owner_api_key) VALUES ('theirs','Theirs','visca-ip','{}',0,'k2')`).run();
  attributor = createFeedAttributor({ db, thumbnailPath: () => '/nope', fetchFrame: async () => null });
  const app = express(); app.use(express.json());
  const auth = (req, res, next) => { req.session = req.headers['x-key'] ? { apiKey: req.headers['x-key'] } : undefined; next(); };
  app.use('/a', createAttributionRouter(attributor, { db, auth }));
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/a`;
});
after(() => { attributor.shutdown(); server.close(); db.close(); });

const call = (path, body, key = 'k1') => fetch(base + path, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-key': key },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('attribution routes', () => {
  it('401 without a session apiKey', async () => {
    assert.equal((await fetch(base + '/status')).status, 401);
  });
  it('start / status / stop', async () => {
    const s = await (await call('/start', { intervalMs: 60000 })).json();
    assert.equal(s.status.running, true);
    assert.equal((await (await call('/status')).json()).status.running, true);
    assert.equal((await (await call('/stop', {})).json()).stopped, true);
  });
  it('rejects a silly interval', async () => {
    assert.equal((await call('/start', { intervalMs: 5 })).status, 400);
  });
  it('override sets and clears; other project cameras are 404', async () => {
    const o = await (await call('/override', { cameraId: 'mine' })).json();
    assert.equal(o.tag.method, 'operator');
    assert.equal((await call('/override', { cameraId: 'theirs' })).status, 404);
    const c = await (await call('/override', { cameraId: null })).json();
    assert.equal(c.tag.method, 'unknown');
  });
});
