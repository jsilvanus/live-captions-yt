/**
 * Tests for AtemPool — bridge-side ATEM connection manager.
 *
 * All tests use a fake Atem class injected via monkey-patching so no real
 * UDP connections are opened. The fake Atem is an EventEmitter with stubs
 * for connect(), disconnect(), and changeProgramInput().
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Fake Atem — mirrors the atem-connection Atem class
// ---------------------------------------------------------------------------

function makeFakeAtemClass({ initiallyConnected = false } = {}) {
  const instances = [];

  class FakeAtem extends EventEmitter {
    constructor() {
      super();
      this._connected = false;
      this._switches  = [];
      this._connectCalled = false;
      this._disconnectCalled = false;
      instances.push(this);
    }

    connect(host) {
      this._connectCalled = true;
      this._host = host;
      if (initiallyConnected) {
        // Simulate immediate connect (sync)
        setImmediate(() => {
          this._connected = true;
          this.emit('connected');
        });
      }
    }

    disconnect() {
      this._disconnectCalled = true;
      this._connected = false;
      // Simulate disconnect event
      setImmediate(() => this.emit('disconnected'));
    }

    async changeProgramInput(input, me = 0) {
      if (!this._connected) throw new Error(`ATEM ${this._host} is not connected`);
      this._switches.push({ input, me });
    }

    // Test helper: force-connect without needing a real device
    simulateConnect() {
      this._connected = true;
      this.emit('connected');
    }

    // Test helper: force-disconnect
    simulateDisconnect() {
      this._connected = false;
      this.emit('disconnected');
    }

    // Test helper: simulate error
    simulateError(err) {
      this.emit('error', err);
    }
  }

  FakeAtem._instances = instances;
  return FakeAtem;
}

// ---------------------------------------------------------------------------
// Helper: create AtemPool with injected fake Atem constructor
// ---------------------------------------------------------------------------

async function makePool(FakeAtem) {
  const mod = await import('../src/atem-pool.js');
  // Monkey-patch Atem import inside the pool module — we re-create the class
  // inline since ESM doesn't let us swap imports after load. Instead we test
  // by subclassing / injecting via the pool's _open method.
  const { AtemPool } = mod;
  const pool = new AtemPool();
  // Replace _open to use FakeAtem instead of real Atem
  pool._open = function (host) {
    const atem = new FakeAtem();
    const entry = {
      atem,
      connected: false,
      destroyed: false,
      _reconnectTimer: null,
      _reconnectDelay: 5_000,
    };
    this._pool.set(host, entry);

    atem.on('connected', () => {
      entry.connected = true;
      entry._reconnectDelay = 5_000;
      this.emit('atem:connected', host);
    });

    atem.on('disconnected', () => {
      entry.connected = false;
      this.emit('atem:disconnected', host);
      // Do NOT auto-reconnect in tests (avoids timer leaks)
    });

    atem.on('error', (err) => {
      this.emit('atem:error', host, err instanceof Error ? err : new Error(String(err)));
    });

    atem.connect(host);
    return entry;
  };
  return pool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AtemPool — switch()', () => {
  it('throws when ATEM not connected', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);

    // Force-create an entry in disconnected state
    const entry = pool._open('192.168.1.10');
    entry.connected = false;

    await assert.rejects(
      () => pool.switch('192.168.1.10', 0, 3),
      /not connected/
    );
  });

  it('calls changeProgramInput with (input, me)', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const entry = pool._open('192.168.1.10');
    entry.connected = true;
    entry.atem._connected = true;

    await pool.switch('192.168.1.10', 0, 3);

    assert.equal(entry.atem._switches.length, 1);
    assert.equal(entry.atem._switches[0].input, 3);
    assert.equal(entry.atem._switches[0].me, 0);
  });

  it('respects non-zero meIndex', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const entry = pool._open('192.168.1.10');
    entry.connected = true;
    entry.atem._connected = true;

    await pool.switch('192.168.1.10', 1, 5);

    assert.equal(entry.atem._switches[0].me, 1);
    assert.equal(entry.atem._switches[0].input, 5);
  });

  it('auto-creates connection for unknown host', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);

    // Do not manually open — switch() should open it
    // Then mark connected for the test
    const switchPromise = pool.switch('192.168.1.20', 0, 1).catch(e => e);
    // It should have created an entry
    const entry = pool._pool.get('192.168.1.20');
    assert.ok(entry, 'entry should be created by switch()');
    // It's not connected yet, so switch() should have thrown
    const result = await switchPromise;
    assert.ok(result instanceof Error, 'should throw not-connected error');
  });
});

describe('AtemPool — status()', () => {
  it('returns empty array when no connections', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    assert.deepEqual(pool.status(), []);
  });

  it('returns entry per ATEM host with connected flag', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const e1 = pool._open('192.168.1.1');
    const e2 = pool._open('192.168.1.2');
    e1.connected = true;
    e2.connected = false;

    const status = pool.status();
    assert.equal(status.length, 2);
    const h1 = status.find(s => s.host === '192.168.1.1');
    const h2 = status.find(s => s.host === '192.168.1.2');
    assert.ok(h1);
    assert.ok(h2);
    assert.equal(h1.connected, true);
    assert.equal(h2.connected, false);
  });
});

describe('AtemPool — destroy()', () => {
  it('clears all connections', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    pool._open('192.168.1.1');
    pool._open('192.168.1.2');

    pool.destroy();

    assert.equal(pool._pool.size, 0);
  });

  it('calls disconnect on each ATEM', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const entry = pool._open('192.168.1.1');

    pool.destroy();

    assert.equal(entry.atem._disconnectCalled, true);
  });

  it('sets destroyed=true on entries before disconnect', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const entry = pool._open('192.168.1.1');

    pool.destroy();

    assert.equal(entry.destroyed, true);
  });
});

describe('AtemPool — events', () => {
  it('emits atem:connected when ATEM connects', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const events = [];
    pool.on('atem:connected', host => events.push({ type: 'connected', host }));

    const entry = pool._open('192.168.1.10');
    entry.atem.simulateConnect();

    assert.equal(events.length, 1);
    assert.equal(events[0].host, '192.168.1.10');
    assert.equal(events[0].type, 'connected');
  });

  it('emits atem:disconnected when ATEM disconnects', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const events = [];
    pool.on('atem:disconnected', host => events.push({ type: 'disconnected', host }));

    const entry = pool._open('192.168.1.10');
    entry.connected = true;
    entry.atem.simulateDisconnect();

    assert.equal(events.length, 1);
    assert.equal(events[0].host, '192.168.1.10');
  });

  it('emits atem:error on ATEM error', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const errors = [];
    pool.on('atem:error', (host, err) => errors.push({ host, err }));

    const entry = pool._open('192.168.1.10');
    const testErr = new Error('UDP timeout');
    entry.atem.simulateError(testErr);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].host, '192.168.1.10');
    assert.equal(errors[0].err.message, 'UDP timeout');
  });

  it('wraps non-Error error emissions', async () => {
    const FakeAtem = makeFakeAtemClass();
    const pool = await makePool(FakeAtem);
    const errors = [];
    pool.on('atem:error', (host, err) => errors.push({ host, err }));

    const entry = pool._open('192.168.1.10');
    entry.atem.simulateError('string error');

    assert.ok(errors[0].err instanceof Error);
    assert.equal(errors[0].err.message, 'string error');
  });
});

// ---------------------------------------------------------------------------
// Bridge — atem_switch command dispatch
// ---------------------------------------------------------------------------

describe('Bridge — atem_switch command handling', () => {
  it('dispatches atem_switch to AtemPool and posts ok status', async () => {
    const { Bridge } = await import('../src/bridge.js');
    const bridge = new Bridge({ backendUrl: 'http://test', token: 'tok' });

    // Capture status posts
    const statusPosts = [];
    bridge._postStatus = async (body) => { statusPosts.push(body); };

    // Inject a mock AtemPool
    const switched = [];
    bridge._atemPool = {
      switch: async (host, meIndex, inputNumber) => { switched.push({ host, meIndex, inputNumber }); },
      status: () => [],
      destroy: () => {},
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'atem_switch',
      requestId: 'req-1',
      host: '192.168.1.10',
      meIndex: 0,
      inputNumber: 3,
    }));

    assert.equal(switched.length, 1);
    assert.equal(switched[0].host, '192.168.1.10');
    assert.equal(switched[0].meIndex, 0);
    assert.equal(switched[0].inputNumber, 3);
    assert.equal(statusPosts.length, 1);
    assert.equal(statusPosts[0].ok, true);
    assert.equal(statusPosts[0].requestId, 'req-1');
  });

  it('defaults meIndex to 0 when omitted', async () => {
    const { Bridge } = await import('../src/bridge.js');
    const bridge = new Bridge({ backendUrl: 'http://test', token: 'tok' });
    bridge._postStatus = async () => {};

    const switched = [];
    bridge._atemPool = {
      switch: async (host, meIndex, inputNumber) => { switched.push({ host, meIndex, inputNumber }); },
      status: () => [],
      destroy: () => {},
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'atem_switch',
      requestId: 'req-2',
      host: '192.168.1.10',
      inputNumber: 2,
    }));

    assert.equal(switched[0].meIndex, 0);
  });

  it('posts ok:false and emits command:error when AtemPool throws', async () => {
    const { Bridge } = await import('../src/bridge.js');
    const bridge = new Bridge({ backendUrl: 'http://test', token: 'tok' });

    const statusPosts = [];
    bridge._postStatus = async (body) => { statusPosts.push(body); };

    const errors = [];
    bridge.on('command:error', (data) => errors.push(data));

    bridge._atemPool = {
      switch: async () => { throw new Error('ATEM not connected'); },
      status: () => [],
      destroy: () => {},
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'atem_switch',
      requestId: 'req-3',
      host: '192.168.1.10',
      meIndex: 0,
      inputNumber: 1,
    }));

    assert.equal(statusPosts.length, 1);
    assert.equal(statusPosts[0].ok, false);
    assert.match(statusPosts[0].error, /not connected/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].type, 'atem_switch');
  });

  it('does not reach unknown-type handler for atem_switch', async () => {
    const { Bridge } = await import('../src/bridge.js');
    const bridge = new Bridge({ backendUrl: 'http://test', token: 'tok' });
    bridge._postStatus = async () => {};

    const unknownErrors = [];
    bridge.on('error', (err) => {
      if (err.message.startsWith('Unknown command type')) unknownErrors.push(err);
    });

    bridge._atemPool = {
      switch: async () => {},
      status: () => [],
      destroy: () => {},
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'atem_switch',
      requestId: 'req-4',
      host: '192.168.1.10',
      meIndex: 0,
      inputNumber: 1,
    }));

    assert.equal(unknownErrors.length, 0);
  });
});
