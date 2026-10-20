/** Caption sessions attach to broadcasts without driving their status (broadcast lifecycle PR 3). */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createLiveRouter } from '../src/routes/live.js';
import { createBroadcastLifecycle } from '../src/broadcasts/lifecycle.js';
import { createBroadcast, getBroadcast, setBroadcastSequence, getBroadcastSequence } from '../src/db/broadcasts.js';

const SECRET = 'binding-secret';
const KEY = 'binding-key';
let server, baseUrl, db, store, lifecycle;

before(() => new Promise(async (resolve) => {
  db = await initDb(':memory:');
  createKey(db, { key: KEY, owner: 'Owner' });
  store = new SessionStore({ cleanupInterval: 0 });
  lifecycle = createBroadcastLifecycle({
    db, steps: {}, deliverables: async () => ({ captions: true, video: false, audio: false }),
  });
  store.onSessionEnd = async () => {};
  const app = express();
  app.use(express.json());
  app.use('/live', createLiveRouter(db, store, SECRET, { broadcastLifecycle: lifecycle }));
  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
}));
after(() => new Promise((resolve) => { store.stopCleanup(); db.close(); server.close(resolve); }));
beforeEach(async () => {
  for (const s of [...store.all()]) store.remove(s.sessionId);
  await store.flush();
  await db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY);
});

const body = (extra = {}) => ({ apiKey: KEY, domain: 'http://localhost', targets: [], ...extra });
async function post(extra) {
  const res = await fetch(`${baseUrl}/live`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(extra)) });
  return { status: res.status, body: await res.json() };
}
async function del(token) {
  return fetch(`${baseUrl}/live`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

describe('session binding', () => {
  it('attaches to the staged broadcast, continues its sequence and leaves its status alone', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'Mass' })).broadcast;
    await lifecycle.transition(KEY, b.id, 'stage');
    await setBroadcastSequence(db, b.id, 7);
    const r = await post({ sequence: 99 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.broadcastId, b.id);
    assert.equal(r.body.sequence, 7, 'the broadcast owns the counter, not the client');
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'staging');
    assert.equal((await del(r.body.token)).status, 200);
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'staging', 'ending the session does not end the broadcast');
  });

  it('refuses an explicit broadcast that is not staged', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'Draft' })).broadcast;
    const r = await post({ broadcastId: b.id });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not_staged');
    assert.equal((await post({ broadcastId: 'nope' })).status, 404);
  });

  it('answers 409 while the current broadcast is stopped', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'Mass' })).broadcast;
    await lifecycle.transition(KEY, b.id, 'stage');
    await lifecycle.transition(KEY, b.id, 'go-live');
    await lifecycle.transition(KEY, b.id, 'stop');
    const r = await post();
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'broadcast_stopped');
  });

  it('makes an ad-hoc broadcast for an old client and ends it with the last session', async () => {
    const r = await post({ sequence: 5 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const b = await getBroadcast(db, KEY, r.body.broadcastId);
    assert.equal(b.adhoc, true);
    assert.equal(b.status, 'live');
    assert.equal(r.body.sequence, 5, 'the old client sequence seeds the counter');
    assert.equal((await del(r.body.token)).status, 200);
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'completed');
  });

  it('a second session joins the current broadcast', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'Mass' })).broadcast;
    await lifecycle.transition(KEY, b.id, 'stage');
    const a = await post();
    const c = await post();
    assert.equal(a.body.broadcastId, b.id);
    assert.equal(c.body.broadcastId, b.id);
  });

  it('PATCH /live sequence sets the broadcast counter', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'Mass' })).broadcast;
    await lifecycle.transition(KEY, b.id, 'stage');
    const r = await post();
    const res = await fetch(`${baseUrl}/live`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${r.body.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence: 12 }),
    });
    assert.equal(res.status, 200);
    assert.equal(await getBroadcastSequence(db, b.id), 12);
  });
});

describe('session store and broadcasts', () => {
  it('keeps an idle session of a staged broadcast past the TTL and closes bound sessions on request', async () => {
    const s = new SessionStore({ cleanupInterval: 0, sessionTtl: 10 });
    let ended = 0;
    s.onSessionEnd = async () => { ended++; };
    s.keepSessionAlive = async (session) => session.broadcastId === 'keep';
    const kept = s.create({ apiKey: KEY, domain: 'd', jwt: 't', sequence: 0 }); kept.broadcastId = 'keep';
    const lost = s.create({ apiKey: KEY, domain: 'e', jwt: 't', sequence: 0 }); lost.broadcastId = 'other';
    kept.lastActivityAt = new Date(Date.now() - 1000);
    lost.lastActivityAt = new Date(Date.now() - 1000);
    await s._sweep();
    assert.equal(s.get(kept.sessionId) !== undefined, true);
    assert.equal(s.get(lost.sessionId), undefined);
    assert.equal(await s.closeBoundSessions('keep'), 1);
    assert.equal(s.get(kept.sessionId), undefined);
    assert.equal(ended, 2);
    s.stopCleanup();
  });
});
