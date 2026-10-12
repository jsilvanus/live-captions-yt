/**
 * Two backend instances on one PostgreSQL database, in one process: each has its own EventBus,
 * SessionStore and HTTP server, joined by the LISTEN/NOTIFY relay. Needs DATABASE_URL=postgresql://.
 *
 * Covers: a session started on one instance is usable on the other, events reach SSE clients on
 * either instance, the sequence keeps rising across instances, ending a session on one instance
 * ends it on the other, a TTL sweep never ends a session another instance is serving, CORS knows
 * sessions of other instances, and viewer captions are relayed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { EventBus } from 'lcyt/event-bus';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createLiveRouter } from '../src/routes/live.js';
import { createCaptionsRouter } from '../src/routes/captions.js';
import { createEventsRouter } from '../src/routes/events.js';
import { createMicRouter } from '../src/routes/mic.js';
import { createViewerRouter, broadcastToViewers, setViewerRelay } from '../src/routes/viewer.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createLeases } from '../src/cluster/leases.js';
import { startPgBus } from '../src/cluster/pg-bus.js';
import { restoreSessionRuntime } from '../src/session-targets.js';

const SECRET = 'multi-instance-secret';
const silent = { info() {}, warn() {} };
const DOMAIN = 'https://multi.example';
const PG = () => Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
const channel = `lcyt_bus_m${process.pid}`;

async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** Read an SSE endpoint into an array of { event, data }. */
async function openSse(url) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  const events = [];
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch { /* aborted */ }
  })();
  return { events, close: () => ctrl.abort(), status: res.status };
}

const json = (token) => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });

describe('two instances on one PostgreSQL', () => {
  let db;
  const nodes = [];

  async function node(id, sendLock = null) {
    const eventBus = new EventBus();
    const relay = startPgBus({ eventBus, db, connectionString: process.env.DATABASE_URL, instanceId: id, channel, log: silent });
    const leases = createLeases(db, { instanceId: id, enforce: true });
    const cluster = { shared: true, leases, instanceId: id };
    const store = new SessionStore({ db, eventBus, cluster, restore: restoreSessionRuntime, sendLock, cleanupInterval: 0, sessionTtl: 60_000 });
    const auth = createAuthMiddleware(SECRET);
    const app = express();
    app.use(express.json());
    app.use('/live', createLiveRouter(db, store, SECRET));
    app.use('/captions', createCaptionsRouter(store, auth, db));
    app.use('/events', createEventsRouter(store, SECRET));
    app.use('/mic', createMicRouter(store, auth));
    const server = createServer(app);
    await new Promise((r) => server.listen(0, r));
    await relay.ready;
    const n = { id, eventBus, relay, store, server, url: `http://localhost:${server.address().port}` };
    nodes.push(n);
    return n;
  }

  before(async () => {
    if (!PG()) return;
    db = await initDb(':memory:');
    await createKey(db, { key: 'multi-key', owner: 'Multi' });
  });

  after(async () => {
    for (const n of nodes) {
      n.store.stopCleanup();
      await n.relay.stop();
      await new Promise((r) => n.server.close(r));
    }
    await db?.close();
  });

  it('serves a session on the instance that did not start it, with rising sequence numbers and events on both', async (t) => {
    if (!PG()) return t.skip('needs PostgreSQL');
    const A = await node('inst-a');
    const B = await node('inst-b');

    const start = await fetch(`${A.url}/live`, {
      method: 'POST', headers: json(),
      body: JSON.stringify({ apiKey: 'multi-key', domain: DOMAIN, targets: [{ id: 't1', type: 'viewer', viewerKey: 'multi-viewer' }] }),
    });
    assert.equal(start.status, 200);
    const { token, sessionId } = await start.json();
    assert.equal(A.store.has(sessionId), true);
    assert.equal(B.store.has(sessionId), false, 'B has not seen the session yet');

    // B answers for the session: loads it from the database.
    const status = await fetch(`${B.url}/live`, { headers: json(token) });
    assert.equal(status.status, 200);
    assert.equal(B.store.has(sessionId), true);
    assert.equal(B.store.get(sessionId).extraTargets.length, 1, 'targets were rebuilt from the stored list');

    const sseA = await openSse(`${A.url}/events?token=${token}`);
    const sseB = await openSse(`${B.url}/events?token=${token}`);
    assert.ok(await until(() => sseA.events.some((e) => e.event === 'connected') && sseB.events.some((e) => e.event === 'connected')));

    // Alternate the instances that take the caption posts.
    const order = [A, B, B, A, B, A];
    for (const [i, n] of order.entries()) {
      const r = await fetch(`${n.url}/captions`, { method: 'POST', headers: json(token), body: JSON.stringify({ captions: [{ text: `line ${i}` }] }) });
      assert.equal(r.status, 202);
    }
    assert.ok(await until(() => sseA.events.filter((e) => e.event === 'caption_result').length === 6), `A saw ${sseA.events.length} events`);
    assert.ok(await until(() => sseB.events.filter((e) => e.event === 'caption_result').length === 6), `B saw ${sseB.events.length} events`);
    const seqA = sseA.events.filter((e) => e.event === 'caption_result').map((e) => e.data.sequence);
    assert.deepEqual(seqA, [1, 2, 3, 4, 5, 6], 'one number per request, never reused, whichever instance took it');
    const row = await db.sessions.findUnique({ where: { session_id: sessionId } });
    assert.equal(row.sequence, 6);

    // Soft mic lock changed on B is seen on A (event and stored holder).
    const mic = await fetch(`${B.url}/mic`, { method: 'POST', headers: json(token), body: JSON.stringify({ action: 'claim', clientId: 'client-b' }) });
    assert.equal(mic.status, 200);
    assert.ok(await until(() => sseA.events.some((e) => e.event === 'mic_state' && e.data.holder === 'client-b')));
    assert.ok(await until(() => A.store.get(sessionId).micHolder === 'client-b'));
    assert.ok(await until(async () => (await db.sessions.findUnique({ where: { session_id: sessionId } })).mic_holder === 'client-b'));

    // CORS: an instance that never served the session still knows its domain.
    const C = await node('inst-c');
    assert.equal(await C.store.domainKnown(DOMAIN), true);
    assert.equal(await C.store.domainKnown('https://nobody.example'), false);

    // Ending the session on B ends it everywhere.
    const del = await fetch(`${B.url}/live`, { method: 'DELETE', headers: json(token) });
    assert.equal(del.status, 200);
    assert.ok(await until(() => sseA.events.some((e) => e.event === 'session_closed')));
    assert.ok(await until(() => !A.store.has(sessionId)), 'A dropped its copy');
    assert.equal(await db.sessions.count({ where: { session_id: sessionId } }), 0);
    const gone = await fetch(`${A.url}/live`, { headers: json(token) });
    assert.equal(gone.status, 404);
    sseA.close(); sseB.close();
  });

  it('does not end a session on a TTL sweep while another instance is serving it, and ends it once nobody is', async (t) => {
    if (!PG()) return t.skip('needs PostgreSQL');
    const A = nodes.find((n) => n.id === 'inst-a');
    const B = nodes.find((n) => n.id === 'inst-b');
    const start = await fetch(`${A.url}/live`, { method: 'POST', headers: json(), body: JSON.stringify({ apiKey: 'multi-key', domain: 'https://ttl.example', targets: [{ id: 't1', type: 'viewer', viewerKey: 'ttl-viewer' }] }) });
    const { token, sessionId, sequence: startSeq } = await start.json();
    const sent = new Promise((resolve) => B.eventBus.subscribe('multi-key', ['caption.sent'], (e) => { if (e.sessionId === sessionId) resolve(); }));
    await fetch(`${B.url}/captions`, { method: 'POST', headers: json(token), body: JSON.stringify({ captions: [{ text: 'hi' }] }) });
    await sent; // touch() runs before the result is emitted
    await B.store.flush();
    assert.ok((await db.sessions.findUnique({ where: { session_id: sessionId } })).sequence > startSeq);
    // A has been idle for a long time by its own clock, but B just served the session.
    A.store.get(sessionId).lastActivityAt = new Date(0);
    await A.store._sweep();
    assert.equal(A.store.has(sessionId), true, 'still alive');
    assert.equal(await db.sessions.count({ where: { session_id: sessionId } }), 1);

    // Now the stored activity is old too: the sweep ends it and B learns about it.
    await db.sessions.updateMany({ where: { session_id: sessionId }, data: { last_activity: new Date(0).toISOString() } });
    A.store.get(sessionId).lastActivityAt = new Date(0);
    await A.store._sweep();
    assert.equal(A.store.has(sessionId), false);
    assert.equal(await db.sessions.count({ where: { session_id: sessionId } }), 0);
    assert.ok(await until(() => !B.store.has(sessionId)), 'B dropped its copy');
  });

  for (const mode of ['atomic', 'lease']) {
    it(`never reuses a sequence number when two instances send at the same time (${mode})`, async (t) => {
      if (!PG()) return t.skip('needs PostgreSQL');
      const X = await node(`inst-x-${mode}`, mode);
      const Y = await node(`inst-y-${mode}`, mode);
      const start = await fetch(`${X.url}/live`, { method: 'POST', headers: json(), body: JSON.stringify({ apiKey: 'multi-key', domain: `https://race-${mode}.example`, targets: [{ id: 't1', type: 'viewer', viewerKey: `race-${mode}` }] }) });
      const { token } = await start.json();
      await fetch(`${Y.url}/live`, { headers: json(token) }); // load it on Y
      const sse = await openSse(`${X.url}/events?token=${token}`);
      assert.ok(await until(() => sse.events.some((e) => e.event === 'connected')));
      const total = 20;
      await Promise.all(Array.from({ length: total }, (_, i) => {
        const n = i % 2 ? X : Y;
        return fetch(`${n.url}/captions`, { method: 'POST', headers: json(token), body: JSON.stringify({ captions: [{ text: `race ${i}` }] }) });
      }));
      assert.ok(await until(() => sse.events.filter((e) => e.event === 'caption_result' || e.event === 'caption_error').length === total, 10000));
      const seqs = sse.events.filter((e) => e.event === 'caption_result').map((e) => e.data.sequence);
      assert.equal(seqs.length, total, 'no send failed');
      assert.equal(new Set(seqs).size, total, `all numbers distinct: ${seqs}`);
      const sorted = [...seqs].sort((a, b) => a - b);
      assert.equal(sorted[total - 1] - sorted[0], total - 1, 'and contiguous');
      sse.close();
    });
  }

  it('reserveSequence puts the reserved number on the session and every YouTube sender', async (t) => {
    if (!PG()) return t.skip('needs PostgreSQL');
    const A = nodes.find((n) => n.id === 'inst-a');
    const start = await fetch(`${A.url}/live`, { method: 'POST', headers: json(), body: JSON.stringify({ apiKey: 'multi-key', domain: 'https://reserve.example', targets: [{ id: 't1', type: 'viewer', viewerKey: 'reserve-v' }] }) });
    const { sessionId, sequence: first } = await start.json();
    const session = A.store.get(sessionId);
    session.sender = { sequence: 0 };
    session.extraTargets = [{ type: 'youtube', sender: { sequence: 0 } }, { type: 'viewer' }];
    await A.store.reserveSequence(session);
    assert.equal(session.sequence, first);
    assert.equal(session.sender.sequence, first);
    assert.equal(session.extraTargets[0].sender.sequence, first);
    await A.store.reserveSequence(session);
    assert.equal(session.sender.sequence, first + 1, 'each reservation takes the next number');
    assert.equal((await db.sessions.findUnique({ where: { session_id: sessionId } })).sequence, first + 2, 'stored value is the next free number');
    session.sender = null; session.extraTargets = [];
  });

  it('relays viewer captions to viewers connected to another instance', async (t) => {
    if (!PG()) return t.skip('needs PostgreSQL');
    const A = nodes.find((n) => n.id === 'inst-a');
    const B = nodes.find((n) => n.id === 'inst-b');
    // The viewer module holds per-process state, so this process plays instance B; A only publishes.
    setViewerRelay(B.eventBus);
    const app = express();
    app.use('/viewer', createViewerRouter(null));
    const server = createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const sse = await openSse(`http://localhost:${server.address().port}/viewer/relay-viewer`);
      assert.ok(await until(() => sse.events.some((e) => e.event === 'connected')));
      A.eventBus.publish('_viewer', 'viewer.caption', { viewerKey: 'relay-viewer', payload: { text: 'from A', sequence: 9 }, owner: 'multi-key' });
      assert.ok(await until(() => sse.events.some((e) => e.event === 'caption' && e.data.text === 'from A')));

      // And the other direction: a caption sent here is published for the other instances.
      const seen = [];
      A.eventBus.onRemote((e) => { if (e.topic === 'viewer.caption') seen.push(e.data); });
      broadcastToViewers('relay-viewer', { text: 'from B', sequence: 10 });
      assert.ok(await until(() => seen.some((d) => d.payload.text === 'from B' && d.viewerKey === 'relay-viewer')));
      sse.close();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
