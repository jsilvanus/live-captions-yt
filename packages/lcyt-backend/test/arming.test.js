/**
 * Production arming (plan_backend_actions.md): db helpers, the
 * /production/arming route, and the go-live / session-end hooks.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventBus } from 'lcyt/event-bus';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createArmingRouter } from '../src/routes/arming.js';
import { createLiveRouter } from '../src/routes/live.js';
import { runMigrations as runRtmpMigrations } from 'lcyt-rtmp/src/db.js';
import {
  createBroadcast, getBroadcast, bindSessionStart, completeBroadcast, activateBroadcast,
  getArming, setArmed, armOnGoLive, disarmOnEnd,
} from '../src/db.js';

const SECRET = 'arming-secret';
let db, key, server, baseUrl, bus, events, store;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  runRtmpMigrations(db);
  key = createKey(db, { owner: 'Arming' }).key;
  bus = new EventBus();
  events = [];
  bus.subscribe(key, ['production.arming_changed'], (e) => events.push(e.data));
  store = new SessionStore({ cleanupInterval: 0, eventBus: bus });
  const app = express();
  app.use(express.json());
  app.use('/production/arming', createArmingRouter(db, createAuthMiddleware(SECRET), bus));
  app.use('/live', createLiveRouter(db, store, SECRET));
  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
}));
after(() => new Promise((resolve) => { store.stopCleanup(); db.close(); server.close(resolve); }));
beforeEach(() => {
  db.prepare('UPDATE api_keys SET active_broadcast_id = NULL WHERE key = ?').run(key);
  db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(key);
  events.length = 0;
});

const mk = (status = 'draft') => createBroadcast(db, key, { title: 't', status }).broadcast ?? createBroadcast(db, key, { title: 't', status });

describe('arming db', () => {
  it('is disarmed with no broadcast and cannot be armed', () => {
    assert.deepEqual(getArming(db, key), { armed: false, broadcastId: null, status: null });
    assert.equal(setArmed(db, key, true).status, 409);
  });

  it('lives on the active broadcast, defaults to disarmed, and toggles', () => {
    const b = mk();
    activateBroadcast(db, key, b.id);
    assert.equal(getArming(db, key).armed, false);
    assert.equal(getBroadcast(db, key, b.id).armed, false);
    const r = setArmed(db, key, true);
    assert.deepEqual([r.ok, r.armed, r.changed, r.broadcastId], [true, true, true, b.id]);
    assert.equal(setArmed(db, key, true).changed, false);
    assert.equal(getArming(db, key).armed, true);
    assert.equal(getBroadcast(db, key, b.id).armed, true);
  });

  it('a live broadcast takes precedence over the active one', () => {
    const active = mk();
    activateBroadcast(db, key, active.id);
    const live = mk();
    bindSessionStart(db, key, live.id);
    assert.equal(getArming(db, key).broadcastId, live.id);
    assert.equal(getArming(db, key).status, 'live');
  });

  it('armOnGoLive / disarmOnEnd publish only on change; completeBroadcast clears the flag', () => {
    const b = mk();
    bindSessionStart(db, key, b.id);
    assert.equal(armOnGoLive(db, bus, key, b.id), true);
    assert.equal(armOnGoLive(db, bus, key, b.id), false);
    assert.deepEqual(events, [{ armed: true, broadcastId: b.id, reason: 'go_live' }]);
    assert.equal(disarmOnEnd(db, bus, key, b.id), true);
    assert.equal(events.at(-1).reason, 'session_end');
    setArmed(db, key, true);
    completeBroadcast(db, b.id);
    assert.equal(getBroadcast(db, key, b.id).armed, false);
  });
});

describe('/production/arming route', () => {
  const token = () => jwt.sign({ sessionId: 's1', apiKey: key }, SECRET);
  const call = (method, body) => fetch(`${baseUrl}/production/arming`, {
    method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });

  it('GET reports SAFE by default; PUT arms, publishes once, and disarms', async () => {
    const b = mk();
    activateBroadcast(db, key, b.id);
    assert.deepEqual(await (await call('GET')).json(), { armed: false, broadcastId: b.id, status: 'draft' });
    let res = await call('PUT', { armed: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).armed, true);
    await call('PUT', { armed: true });
    assert.deepEqual(events, [{ armed: true, broadcastId: b.id, reason: 'manual' }]);
    res = await call('PUT', { armed: false });
    assert.equal((await res.json()).armed, false);
    assert.equal(events.length, 2);
  });

  it('PUT validates the body and needs a broadcast', async () => {
    assert.equal((await call('PUT', { armed: 'yes' })).status, 400);
    assert.equal((await call('PUT', { armed: true })).status, 409);
  });
});

describe('go-live and session end', () => {
  it('POST /live arms the new broadcast and DELETE /live disarms it', async () => {
    const res = await fetch(`${baseUrl}/live`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, domain: 'http://127.0.0.1:5173', targets: [{ id: '1', type: 'youtube', streamKey: 'k' }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    const { token } = body;
    const live = getArming(db, key);
    assert.equal(live.armed, true);
    assert.equal(live.status, 'live');
    assert.equal(events[0].reason, 'go_live');
    const del = await fetch(`${baseUrl}/live`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(del.status, 200);
    assert.equal(events.at(-1).reason, 'session_end');
    assert.equal(events.at(-1).armed, false);
    assert.equal(db.prepare('SELECT armed FROM broadcasts WHERE api_key = ?').get(key).armed, 0);
  });
});
