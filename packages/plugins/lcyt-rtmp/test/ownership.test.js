import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { withOwnership, readThrough, ownedElsewhere, RELAY_OWNERSHIP, CROP_OWNERSHIP, LOCAL } from '../src/ownership.js';

/** A manager that only remembers what it was asked (stands in for relay/crop/STT managers). */
class FakeManager extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.running = new Map();
    this.publishing = new Set();
    this.calls = [];
  }
  async start(key, relays = [], opts = {}) { this.calls.push(['start', key]); if (relays.length) this.running.set(key, { relays, opts }); }
  async startAll(key, relays, opts) { return this.start(key, relays, opts); }
  async stop(key) { this.calls.push(['stop', key]); this.running.delete(key); }
  async stopKey(key) { return this.stop(key); }
  async writeCaption(key, text) { this.calls.push(['writeCaption', key, text]); return this.running.has(key); }
  async applyPosition(key, pos) { this.calls.push(['applyPosition', key]); return { ok: true, pos }; }
  async applyForSource(db, key, src) { this.calls.push(['applyForSource', db, key, src]); return 'applied'; }
  async setDskRtmpSource() { return 'dsk'; }
  async setDskOverlay(key, names, paths) { this.calls.push(['setDskOverlay', key, names, paths]); }
  markPublishing(key) { this.publishing.add(key); }
  markNotPublishing(key) { this.publishing.delete(key); }
  isPublishing(key) { return this.publishing.has(key); }
  isRunning(key) { return this.running.has(key); }
  runningSlots(key) { return this.running.has(key) ? [1] : []; }
  hasCea708() { return false; }
  getStatus(key) { return { running: this.running.has(key), by: this.name }; }
}

/** Two instances sharing one lease table; "HTTP" is a direct call into the other wrapper. */
function cluster() {
  const leases = new Map(); // name -> instanceId
  const nodes = {};
  const make = (id) => {
    const manager = new FakeManager(id);
    const node = { id, manager, forwarded: [], released: [], claims: [] };
    const ownership = {
      async claim(kind, key, { stillNeeded } = {}) {
        const name = `${kind}:${key}`;
        const holder = leases.get(name);
        if (holder && holder !== id) return { ok: false, owner: { id: holder, url: `http://${holder}`, self: false } };
        leases.set(name, id);
        node.claims.push([name, stillNeeded]);
        return { ok: true };
      },
      async release(kind, key) { node.released.push(`${kind}:${key}`); if (leases.get(`${kind}:${key}`) === id) leases.delete(`${kind}:${key}`); },
      async ownerOf(kind, key) {
        const holder = leases.get(`${kind}:${key}`);
        if (!holder) return null;
        return { id: holder, url: `http://${holder}`, self: holder === id };
      },
      async forward(owner, kind, method, args) {
        node.forwarded.push([owner.id, kind, method, args]);
        const other = nodes[owner.id];
        return JSON.parse(JSON.stringify(await other.wrapped.__invokeLocal(method, JSON.parse(JSON.stringify(args))) ?? null));
      },
    };
    node.wrapped = withOwnership(manager, {
      ...RELAY_OWNERSHIP,
      routed: {
        ...RELAY_OWNERSHIP.routed,
        applyForSource: { keyIndex: 1, forwardKeyIndex: 0, forwardArgs: (a) => a.slice(1), localArgs: (a) => ['DB', ...a] },
      },
      ownership,
      log: { warn() {} },
    });
    nodes[id] = node;
    return node;
  };
  return { a: make('A'), b: make('B'), leases };
}

describe('withOwnership', () => {
  test('a start on an unowned key runs locally and takes the lease', async () => {
    const { a, leases } = cluster();
    await a.wrapped.startAll('k1', [{ slot: 1 }], { cea708DelayMs: 5 });
    assert.equal(a.manager.isRunning('k1'), true);
    assert.equal(leases.get('relay:k1'), 'A');
  });

  test('a start on another instance is forwarded to the owner, never duplicated', async () => {
    const { a, b } = cluster();
    await a.wrapped.startAll('k1', [{ slot: 1 }], {});
    await b.wrapped.startAll('k1', [{ slot: 1 }, { slot: 2 }], { cea708DelayMs: 100 });
    assert.equal(b.manager.isRunning('k1'), false, 'B started nothing');
    assert.deepEqual(b.forwarded.map((f) => f.slice(0, 3)), [['A', 'relay', 'startAll']]);
    assert.equal(a.manager.running.get('k1').relays.length, 2, 'A applied the new relay list');
    assert.equal(a.manager.running.get('k1').opts.cea708DelayMs, 100);
  });

  test('stop from the other instance reaches the owner and frees the key', async () => {
    const { a, b, leases } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    await b.wrapped.stopKey('k1');
    assert.equal(a.manager.isRunning('k1'), false);
    assert.equal(leases.has('relay:k1'), false, 'lease released once nothing runs');
    // The next start anywhere takes over cleanly.
    await b.wrapped.start('k1', [{ slot: 1 }]);
    assert.equal(b.manager.isRunning('k1'), true);
    assert.equal(leases.get('relay:k1'), 'B');
  });

  test('a start that leaves nothing running gives the lease back', async () => {
    const { a, leases } = cluster();
    await a.wrapped.start('k1', []); // no relay slots configured
    assert.equal(leases.has('relay:k1'), false);
  });

  test('a failing start gives the lease back and rethrows', async () => {
    const { a, leases } = cluster();
    a.manager.start = async () => { throw new Error('ffmpeg missing'); };
    await assert.rejects(a.wrapped.start('k1', [{ slot: 1 }]), /ffmpeg missing/);
    assert.equal(leases.has('relay:k1'), false);
  });

  test('stillNeeded reports whether the process is still running', async () => {
    const { a } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    const stillNeeded = a.claims.at(-1)[1];
    assert.equal(await stillNeeded(), true);
    a.manager.running.delete('k1'); // the process exited by itself
    assert.equal(await stillNeeded(), false);
  });

  test('routed calls: writeCaption and setDskRtmpSource follow the owner', async () => {
    const { a, b } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    assert.equal(await b.wrapped.writeCaption('k1', 'hello'), true);
    assert.deepEqual(a.manager.calls.at(-1), ['writeCaption', 'k1', 'hello']);
    assert.equal(b.manager.calls.some((c) => c[0] === 'writeCaption'), false);
    // Not owned by anyone: runs locally.
    assert.equal(await b.wrapped.writeCaption('other', 'x'), false);
    assert.deepEqual(b.manager.calls.at(-1), ['writeCaption', 'other', 'x']);
  });

  test('setDskOverlay goes to the owner with names and paths', async () => {
    const { a, b } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    await b.wrapped.setDskOverlay('k1', ['logo'], ['/data/images/k1/logo.png']);
    assert.deepEqual(a.manager.calls.at(-1), ['setDskOverlay', 'k1', ['logo'], ['/data/images/k1/logo.png']]);
    assert.equal(b.manager.calls.some((c) => c[0] === 'setDskOverlay'), false);
  });

  test('applyForSource keeps its db argument local and forwards the rest', async () => {
    const { a, b } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    const res = await b.wrapped.applyForSource('B-DB', 'k1', { cameraId: 3 });
    assert.equal(res, 'applied');
    assert.deepEqual(b.forwarded.at(-1), ['A', 'relay', 'applyForSource', ['k1', { cameraId: 3 }]]);
    assert.deepEqual(a.manager.calls.at(-1), ['applyForSource', 'DB', 'k1', { cameraId: 3 }]);
  });

  test('mark calls apply locally and are passed on to the owner without blocking or throwing', async () => {
    const { a, b } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    b.wrapped.markPublishing('k1');
    assert.equal(b.manager.isPublishing('k1'), true, 'local flag set at once');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(a.manager.isPublishing('k1'), true, 'owner flagged too');
    b.wrapped.markNotPublishing('k1');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(a.manager.isPublishing('k1'), false);
  });

  test('a failed mark forward is swallowed', async () => {
    const { a, b } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    a.manager.markPublishing = () => { throw new Error('boom'); };
    b.wrapped.markPublishing('k1'); // must not throw or leave an unhandled rejection
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.manager.isPublishing('k1'), true);
  });

  test('reads: local state wins, otherwise the owner answers', async () => {
    const { a, b } = cluster();
    await a.wrapped.start('k1', [{ slot: 1 }]);
    assert.equal(await b.wrapped.__read('isRunning', 'k1'), true);
    assert.deepEqual(await b.wrapped.__read('runningSlots', 'k1'), [1]);
    assert.equal(await b.wrapped.__read('isRunning', 'nobody'), false);
    assert.equal(await readThrough(b.wrapped, 'isRunning', 'k1'), true);
    assert.equal(await ownedElsewhere(b.wrapped, 'k1'), true);
    assert.equal(await ownedElsewhere(a.wrapped, 'k1'), false);
    a.manager.markPublishing('k1');
    assert.equal(await b.wrapped.__read('isPublishing', 'k1'), true);
  });

  test('the owner never forwards a call it received (no loops)', async () => {
    const { a } = cluster();
    // A holds nothing, a forwarded stop arrives: it runs locally without asking anyone.
    await a.wrapped.__invokeLocal('stop', ['k9']);
    assert.deepEqual(a.forwarded, []);
  });

  test('forwarded calls are limited to the listed methods', async () => {
    const { a } = cluster();
    await assert.rejects(a.wrapped.__invokeLocal('stopAll', []), (e) => e.code === 'METHOD_NOT_ALLOWED');
    await assert.rejects(a.wrapped.__invokeLocal('constructor', []), (e) => e.code === 'METHOD_NOT_ALLOWED');
  });

  test('a forwarded start to an instance that lost the lease reports NOT_OWNER', async () => {
    const { a, b } = cluster();
    await b.wrapped.start('k1', [{ slot: 1 }]);
    await assert.rejects(a.wrapped.__invokeLocal('start', ['k1', [{ slot: 1 }]]), (e) => e.code === 'NOT_OWNER');
  });

  test('everything else passes through, bound to the real manager', async () => {
    const { a } = cluster();
    let seen = 0;
    a.wrapped.on('x', () => { seen++; });
    a.manager.emit('x');
    assert.equal(seen, 1);
    assert.equal(a.wrapped[LOCAL], a.manager);
    assert.equal(a.wrapped.hasCea708('k'), false);
    assert.deepEqual(a.wrapped.getStatus('k'), { running: false, by: 'A' });
  });

  test('crop spec routes applyPosition to the owner', async () => {
    const leases = new Map([['crop:k1', 'A']]);
    const m = new FakeManager('B');
    let forwarded;
    const w = withOwnership(m, {
      ...CROP_OWNERSHIP,
      ownership: {
        claim: async () => ({ ok: true }), release: async () => {},
        ownerOf: async (kind, key) => ({ id: leases.get(`${kind}:${key}`), url: 'http://A', self: false }),
        forward: async (o, kind, method, args) => { forwarded = [o.id, kind, method, args]; return { ok: true }; },
      },
    });
    assert.deepEqual(await w.applyPosition('k1', { xNorm: 0.5 }), { ok: true });
    assert.deepEqual(forwarded, ['A', 'crop', 'applyPosition', ['k1', { xNorm: 0.5 }]]);
  });
});

describe('readThrough and ownedElsewhere on plain managers', () => {
  test('answer directly', async () => {
    const m = new FakeManager('X');
    assert.equal(await readThrough(m, 'isRunning', 'k'), false);
    assert.equal(await ownedElsewhere(m, 'k'), false);
  });
});
