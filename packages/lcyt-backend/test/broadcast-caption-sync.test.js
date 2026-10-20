/**
 * BroadcastCaptionSync: periodic clock sync owned by the live broadcast.
 * Fake store/senders and a manual timer; in-memory database.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { createBroadcast, getBroadcast } from '../src/db/broadcasts.js';
import { createBroadcastCaptionSync } from '../src/broadcasts/caption-sync.js';

const KEY = 'sync-key';
let db;

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(KEY);
});
after(() => db.close());
beforeEach(async () => { await db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY); });

function fakes() {
  const sessions = new Map();
  const timers = [];
  const events = [];
  const svc = (opts = {}) => createBroadcastCaptionSync({
    db, store: { entries: () => sessions.entries() },
    eventBus: { publish: (k, topic, data) => events.push({ topic, ...data }) },
    intervalS: () => 300, random: () => 0,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    logger: { warn() {} },
    ...opts,
  });
  return { sessions, timers, events, svc };
}

describe('syncNow', () => {
  it('syncs every sender of the bound sessions, stores the first offset and publishes it', async () => {
    const { sessions, events, svc } = fakes();
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    const sender = { sync: async () => ({ syncOffset: 120, roundTripTime: 40 }) };
    const extra = { sync: async () => ({ syncOffset: 90, roundTripTime: 50 }) };
    const session = { broadcastId: b.id, sender, extraTargets: [{ type: 'youtube', sender: extra }, { type: 'viewer' }], syncOffset: 0 };
    sessions.set('s1', session);
    sessions.set('other', { broadcastId: 'not-this', sender: { sync: async () => { throw new Error('must not run'); } }, extraTargets: [] });
    const r = await svc().syncNow(KEY, b.id);
    assert.equal(r.ok, true);
    assert.equal(r.senders, 2);
    const row = await getBroadcast(db, KEY, b.id);
    assert.equal(row.syncOffsetMs, 120);
    assert.ok(row.lastSyncedAt);
    assert.equal(row.syncFailures, 0);
    assert.equal(session.syncOffset, 90, 'each session carries the last offset written');
    assert.deepEqual(events.map((e) => [e.topic, e.offsetMs, e.rttMs]), [['broadcast.caption_synced', 120, 40]]);
  });

  it('counts a failed round and keeps the previous offset', async () => {
    const { sessions, svc } = fakes();
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    await db.broadcasts.updateMany({ where: { id: b.id }, data: { sync_offset_ms: 77 } });
    sessions.set('s1', { broadcastId: b.id, sender: { sync: async () => { throw new Error('timeout'); } }, extraTargets: [] });
    const r = await svc().syncNow(KEY, b.id);
    assert.equal(r.ok, false);
    const row = await getBroadcast(db, KEY, b.id);
    assert.equal(row.syncOffsetMs, 77);
    assert.equal(row.syncFailures, 1);
  });

  it('without a sender it is skipped and is not counted as a failure', async () => {
    const { svc } = fakes();
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    const r = await svc().syncNow(KEY, b.id);
    assert.equal(r.skipped, true);
    assert.equal((await getBroadcast(db, KEY, b.id)).syncFailures, 0);
  });
});

describe('periodic schedule', () => {
  it('start is idempotent, reschedules after each round and stop clears the timer', async () => {
    const { sessions, timers, svc } = fakes();
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    sessions.set('s1', { broadcastId: b.id, sender: { sync: async () => ({ syncOffset: 5, roundTripTime: 1 }) }, extraTargets: [] });
    const sync = svc();
    sync.start(KEY, b.id);
    sync.start(KEY, b.id);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 300_000);
    await timers[0].fn();
    assert.equal(timers.length, 2, 'rescheduled');
    assert.equal((await getBroadcast(db, KEY, b.id)).syncOffsetMs, 5);
    sync.stop(b.id);
    assert.equal(timers[1].cleared, true);
    assert.equal(sync.isRunning(b.id), false);
  });

  it('backs off x2 then x4 (cap) after failures and returns to the base after a success', async () => {
    const { sessions, timers, svc } = fakes();
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    let ok = false;
    sessions.set('s1', { broadcastId: b.id, sender: { sync: async () => { if (!ok) throw new Error('x'); return { syncOffset: 1 }; } }, extraTargets: [] });
    const sync = svc();
    sync.start(KEY, b.id);
    await timers[0].fn(); // failure 1
    assert.equal(timers[1].ms, 600_000);
    await timers[1].fn(); // failure 2
    assert.equal(timers[2].ms, 1_200_000);
    await timers[2].fn(); // failure 3 -> capped at x4
    assert.equal(timers[3].ms, 1_200_000);
    ok = true;
    await timers[3].fn();
    assert.equal(timers[4].ms, 300_000);
  });

  it('does not sync when another instance holds the lease', async () => {
    const { sessions, timers, svc } = fakes();
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    let called = 0;
    sessions.set('s1', { broadcastId: b.id, sender: { sync: async () => { called += 1; return { syncOffset: 1 }; } }, extraTargets: [] });
    const sync = svc({ leases: { acquire: async () => false } });
    sync.start(KEY, b.id);
    await timers[0].fn();
    assert.equal(called, 0);
    assert.equal(timers.length, 2);
  });
});
