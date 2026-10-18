import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from 'lcyt/event-bus';
import { initDb } from '../src/db.js';
import { getDialect } from '../src/db/connection.js';
import { getInstanceId, resetInstanceId } from '../src/cluster/instance.js';
import { createLeases } from '../src/cluster/leases.js';
import { createInstanceRegistry } from '../src/cluster/instances.js';
import { startPgBus, toPgConnectionString } from '../src/cluster/pg-bus.js';
import { startCluster } from '../src/cluster/index.js';
import { leasedChore } from '../src/cluster/chores.js';

const silent = { info() {}, warn() {} };
const PG = () => getDialect() === 'postgres';

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe('instance id', () => {
  it('uses INSTANCE_ID when set and a fresh host-pid-random value otherwise', () => {
    resetInstanceId();
    assert.equal(getInstanceId({ INSTANCE_ID: ' app-1 ' }), 'app-1');
    resetInstanceId();
    const generated = getInstanceId({});
    assert.match(generated, new RegExp(`-${process.pid}-[0-9a-f]{6}$`));
    assert.equal(getInstanceId({ INSTANCE_ID: 'ignored once cached' }), generated);
    resetInstanceId();
  });
});

describe('cluster coordination', () => {
  let db;
  before(async () => { db = await initDb(':memory:'); });
  after(async () => { await db.close(); });

  describe('leases', () => {
    it('lets exactly one of several racing owners take a lease', async () => {
      const leases = createLeases(db, { instanceId: 'a', enforce: true });
      const results = await Promise.all(['o1', 'o2', 'o3', 'o4', 'o5'].map((o) => leases.acquire('race', 5000, o)));
      assert.equal(results.filter(Boolean).length, 1);
    });

    it('renews for the same owner, refuses another owner until it expires, and releases only for the owner', async () => {
      let t = 1_000_000;
      const leases = createLeases(db, { instanceId: 'a', enforce: true, now: () => t });
      assert.equal(await leases.acquire('job', 1000, 'a'), true);
      assert.equal(await leases.acquire('job', 1000, 'b'), false);
      t += 500;
      assert.equal(await leases.acquire('job', 1000, 'a'), true); // renew -> expires at t+1000
      t += 900;
      assert.equal(await leases.acquire('job', 1000, 'b'), false);
      assert.equal(await leases.holder('job'), 'a');
      await leases.release('job', 'b'); // not the owner: no effect
      assert.equal(await leases.holder('job'), 'a');
      t += 200; // expired
      assert.equal(await leases.holder('job'), null);
      assert.equal(await leases.acquire('job', 1000, 'b'), true);
      await leases.release('job', 'b');
      assert.equal(await leases.acquire('job', 1000, 'a'), true);
    });

    it('withLease runs the job once and releases afterwards, or reports that it did not run', async () => {
      const leases = createLeases(db, { instanceId: 'a', enforce: true });
      let runs = 0;
      let release;
      const gate = new Promise((r) => { release = r; });
      let started;
      const firstStarted = new Promise((r) => { started = r; });
      // The first job holds the lease until the second call has answered, however slow the machine is.
      const first = leases.withLease('chore', 5000, async () => { runs++; started(); await gate; return 'done'; }, 'a');
      await firstStarted;
      const second = await leases.withLease('chore', 5000, async () => { runs++; return 'done'; }, 'b');
      release();
      const [r1, r2] = [await first, second];
      assert.equal(runs, 1);
      assert.deepEqual([r1.ran, r2.ran].sort(), [false, true]);
      assert.equal(await leases.holder('chore'), null);
      assert.equal((await leases.withLease('chore', 5000, () => 'again')).ran, true);
    });

    it('withLease releases when the job throws', async () => {
      const leases = createLeases(db, { instanceId: 'a', enforce: true });
      await assert.rejects(leases.withLease('boom', 5000, () => { throw new Error('x'); }), /x/);
      assert.equal(await leases.holder('boom'), null);
    });

    it('is a no-op that always succeeds when not enforced (single instance)', async () => {
      const untouchable = new Proxy({}, { get() { throw new Error('database must not be used'); } });
      const leases = createLeases(untouchable, { instanceId: 'solo', enforce: false });
      assert.equal(await leases.acquire('anything', 1000, 'x'), true);
      assert.equal(await leases.acquire('anything', 1000, 'y'), true);
      assert.equal((await leases.withLease('anything', 1000, () => 7)).value, 7);
      await leases.release('anything');
    });
  });

  describe('instance registry', () => {
    it('registers, lists live instances, prunes dead ones and removes itself on stop', async () => {
      let t = 5_000_000;
      const mk = (id) => createInstanceRegistry(db, { instanceId: id, enforce: true, now: () => t, log: silent, liveWithinMs: 30_000, pruneAfterMs: 120_000 });
      const a = mk('inst-a');
      const b = mk('inst-b');
      await a.beat();
      await b.beat();
      assert.deepEqual((await a.list()).map((i) => i.id).sort(), ['inst-a', 'inst-b']);
      assert.equal((await a.list()).find((i) => i.self).id, 'inst-a');
      t += 40_000; // b stops beating
      await a.beat();
      assert.deepEqual((await a.list()).map((i) => i.id), ['inst-a']);
      t += 130_000;
      await a.beat();
      assert.equal(await db.instances.count({ where: { id: 'inst-b' } }), 0);
      await a.stop();
      assert.equal(await db.instances.count({ where: { id: 'inst-a' } }), 0);
    });

    it('lists only itself and writes nothing when not enforced', async () => {
      const untouchable = new Proxy({}, { get() { throw new Error('database must not be used'); }, });
      untouchable.$dialect = 'sqlite';
      const reg = createInstanceRegistry(untouchable, { instanceId: 'solo', enforce: false, log: silent });
      await reg.start();
      assert.deepEqual((await reg.list()).map((i) => i.id), ['solo']);
      await reg.stop();
    });
  });

  describe('startCluster', () => {
    it('on SQLite stays local: leases succeed, one peer, bus untouched', async (t) => {
      if (PG()) return t.skip('SQLite behaviour');
      const bus = new EventBus();
      const c = await startCluster({ db, eventBus: bus, env: { INSTANCE_ID: 'solo-1' }, log: silent });
      assert.equal(c.shared, false);
      assert.equal(c.instanceId, 'solo-1');
      assert.equal(await c.leases.acquire('x', 1000, 'p'), true);
      assert.equal(await c.leases.acquire('x', 1000, 'q'), true);
      assert.deepEqual(c.peers().map((p) => p.id), ['solo-1']);
      assert.equal(c.busStats(), null);
      assert.equal(bus._forwarders.size, 0);
      await c.stop();
    });
  });

  describe('PostgreSQL event relay', () => {
    const channel = `lcyt_bus_t${process.pid}`;
    let buses;

    function node(id, extra = {}) {
      const bus = new EventBus();
      const relay = startPgBus({ eventBus: bus, db, connectionString: process.env.DATABASE_URL, instanceId: id, channel, log: silent, ...extra });
      const sse = [];
      bus.subscribeSse('proj', null, { write: (f) => sse.push(f) });
      const remoteSeen = [];
      const localOnlySeen = [];
      bus.subscribe('proj', null, (e) => remoteSeen.push(e), { remote: true });
      bus.subscribe('proj', null, (e) => localOnlySeen.push(e));
      buses.push(relay);
      return { bus, relay, sse, remoteSeen, localOnlySeen };
    }

    before(() => { buses = []; });
    after(async () => { for (const r of buses) await r.stop(); });

    it('delivers an event published on one instance to the others, once, in order, and not back to the sender', async (t) => {
      if (!PG()) return t.skip('needs PostgreSQL');
      const a = node('a');
      const b = node('b');
      await Promise.all([a.relay.ready, b.relay.ready]);
      for (let i = 0; i < 20; i++) a.bus.publish('proj', 'caption.sent', { i });
      assert.ok(await until(() => b.remoteSeen.length === 20), `b saw ${b.remoteSeen.length}`);
      assert.deepEqual(b.remoteSeen.map((e) => e.data.i), [...Array(20).keys()]);
      assert.equal(b.sse.length, 20);
      assert.equal(b.localOnlySeen.length, 0, 'plain listeners must not see remote events');
      await a.relay.flush();
      assert.equal(a.relay.stats().sent, 20, 'every notify must complete without an error');
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(a.sse.length, 20, 'sender must not receive its own events again');
      assert.equal(a.localOnlySeen.length, 20);
    });

    it('carries envelopes larger than a NOTIFY message through bus_payloads', async (t) => {
      if (!PG()) return t.skip('needs PostgreSQL');
      const a = node('a2', { maxInlineBytes: 300 });
      const b = node('b2');
      await Promise.all([a.relay.ready, b.relay.ready]);
      const big = 'x'.repeat(5000);
      a.bus.publish('proj', 'dsk.text', { big });
      assert.ok(await until(() => b.remoteSeen.some((e) => e.data.big === big)));
      assert.equal(a.relay.stats().oversize, 1);
    });

    it('re-listens after its connection is killed', async (t) => {
      if (!PG()) return t.skip('needs PostgreSQL');
      const a = node('a3');
      const b = node('b3', { reconnectMaxMs: 200 });
      await Promise.all([a.relay.ready, b.relay.ready]);
      const killed = await db.$queryRawUnsafe(
        `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE query = 'LISTEN "${channel}"' AND pid <> pg_backend_pid()`);
      assert.ok(killed.length >= 1);
      assert.ok(await until(() => b.relay.stats().reconnects >= 1));
      // After the reconnect, new events arrive again.
      assert.ok(await until(async () => {
        a.bus.publish('proj', 'ping.after', { n: Date.now() });
        await a.relay.flush();
        await new Promise((r) => setTimeout(r, 100));
        return b.remoteSeen.some((e) => e.topic === 'ping.after');
      }, 8000));
    });
  });

  it('toPgConnectionString drops Prisma-only parameters', () => {
    assert.equal(toPgConnectionString('postgresql://u:p@h:5432/d?schema=t1&connection_limit=1&sslmode=require'),
      'postgresql://u:p@h:5432/d?sslmode=require');
  });
});

describe('leased chores', () => {
  it('two instances ticking one after the other run the chore once per interval', async () => {
    const db = await initDb(':memory:');
    try {
      let t = 1_000_000;
      const a = createLeases(db, { instanceId: 'a', enforce: true, now: () => t });
      const b = createLeases(db, { instanceId: 'b', enforce: true, now: () => t });
      const ran = [];
      const day = () => 86_400_000;
      const runA = leasedChore(a, 'backup', day, () => { ran.push('a'); });
      const runB = leasedChore(b, 'backup', day, () => { ran.push('b'); });
      await Promise.all([runA(), runB()]);
      assert.equal(ran.length, 1, 'one run in the first interval');
      const loser = ran[0] === 'a' ? runB : runA;
      t += 60_000; // the other instance ticks a minute later
      await loser();
      assert.equal(ran.length, 1, 'still held');
      t += day(); // next interval
      await loser();
      assert.equal(ran.length, 2, 'the next interval is won by whoever ticks first');
    } finally {
      await db.close();
    }
  });

  it('without enforcement (single instance) every tick runs', async () => {
    const db = await initDb(':memory:');
    try {
      const leases = createLeases(db, { instanceId: 'solo', enforce: false });
      let n = 0;
      const run = leasedChore(leases, 'x', () => 1000, () => { n++; });
      await run(); await run(); await run();
      assert.equal(n, 3);
    } finally {
      await db.close();
    }
  });
});
