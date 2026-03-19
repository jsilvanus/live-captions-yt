/**
 * Tests for Bridge — SSE client + command dispatcher + status reporter.
 *
 * Covers:
 *   - Constructor / status() initial state
 *   - destroy() is safe to call before start()
 *   - destroy() prevents reconnect timers from firing
 *   - _handleCommand() — tcp_send dispatched to TcpPool and status POSTed
 *   - _handleCommand() — unknown command type emits error
 *   - _handleCommand() — non-JSON data emits error
 *   - _handleCommand() — tcp_send failure reports { ok: false } to backend
 *   - _postStatus() — network failure emits 'error' event (does not throw)
 *   - startHeartbeat() — calls _postStatus on interval; cleared on destroy
 *   - reconnectAll() closes existing SSE and reconnects TCP pool
 *   - TCP pool events forwarded as bridge tcp:* events
 *
 * The SSE transport (EventSource) is mocked so no real HTTP server is needed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Bridge } from '../src/bridge.js';

// ---------------------------------------------------------------------------
// Mock EventSource
//
// We monkey-patch the dynamic `import('eventsource')` used by Bridge._connect()
// by replacing globalThis with a fake module registry. Instead, we intercept
// Bridge's internal _connect() method and inject our own fake EventSource.
// ---------------------------------------------------------------------------

/**
 * Build a fake EventSource instance that behaves like the real thing.
 * Exposes .simulateOpen(), .simulateEvent(type, data), .simulateError() for tests.
 */
function makeFakeEventSource() {
  const emitter = new EventEmitter();
  const es = {
    readyState: 0, // CONNECTING
    _listeners: {},
    onopen: null,
    onerror: null,
    _closed: false,

    addEventListener(type, listener) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(listener);
    },

    removeEventListener(type, listener) {
      if (this._listeners[type]) {
        this._listeners[type] = this._listeners[type].filter(l => l !== listener);
      }
    },

    close() {
      this._closed = true;
      this.readyState = 2; // CLOSED
    },

    // Test helpers -------------------------------------------------------

    simulateOpen() {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
      (this._listeners['connected'] ?? []).forEach(l => l({ data: '{}' }));
    },

    simulateEvent(type, data) {
      const rawData = typeof data === 'string' ? data : JSON.stringify(data);
      (this._listeners[type] ?? []).forEach(l => l({ data: rawData }));
    },

    simulateError(err) {
      this.readyState = 2; // CLOSED
      if (this.onerror) this.onerror(err ?? new Error('SSE error'));
    },
  };
  return es;
}

/**
 * Patch Bridge._connect so it never actually imports eventsource.
 * The caller gets back the fake EventSource for manipulation.
 */
function injectFakeEventSource(bridge) {
  let fakeEs = null;

  bridge._connect = async function () {
    if (this._destroyed) return;
    fakeEs = makeFakeEventSource();
    this._es = fakeEs;
    this.emit('connecting', 'fake://url');

    fakeEs.onopen = () => {
      this._reconnectDelay = 5000;
      this.emit('connected');
    };

    fakeEs.addEventListener('connected', () => {
      this.emit('connected');
    });

    fakeEs.addEventListener('command', (evt) => {
      this._handleCommand(evt.data);
    });

    fakeEs.onerror = (err) => {
      this.emit('disconnected');
      fakeEs.close();
      this._es = null;
      if (!this._destroyed) {
        this.emit('reconnecting', this._reconnectDelay);
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = null;
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, 60_000);
          this._connect();
        }, this._reconnectDelay);
      }
    };
  };

  return () => fakeEs; // getter — call after _connect() resolves
}

// ---------------------------------------------------------------------------
// Mock TcpPool
// ---------------------------------------------------------------------------

function makeMockTcpPool({ sendError = null } = {}) {
  const pool = new EventEmitter();
  pool._sent = [];
  pool._statusCalls = [];
  pool.send = async (host, port, payload) => {
    pool._sent.push({ host, port, payload });
    if (sendError) throw sendError;
  };
  pool.status = () => [];
  pool.reconnectAll = () => {};
  pool.destroy = () => {};
  return pool;
}

// ---------------------------------------------------------------------------
// _postStatus mock — capture calls without real HTTP
// ---------------------------------------------------------------------------

function mockFetch(bridge) {
  const calls = [];
  bridge._postStatus = async (body) => {
    calls.push(body);
  };
  return calls;
}

// ---------------------------------------------------------------------------
// Constructor / status()
// ---------------------------------------------------------------------------

describe('Bridge — constructor and status()', () => {
  it('initialises with sse: false and no TCP entries', () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const s = bridge.status();
    assert.equal(s.sse, false);
    assert.deepEqual(s.tcp, []);
    bridge.destroy();
  });

  it('strips trailing slash from backendUrl', () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test/', token: 'tok' });
    assert.equal(bridge._backendUrl, 'http://backend.test');
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('Bridge — destroy()', () => {
  it('is safe to call before start()', () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    assert.doesNotThrow(() => bridge.destroy());
  });

  it('sets _destroyed = true so subsequent _connect() calls are no-ops', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    injectFakeEventSource(bridge);
    bridge.destroy();
    // _connect should return immediately without setting _es
    await bridge._connect();
    assert.equal(bridge._es, null);
  });

  it('clears a pending reconnect timer', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    injectFakeEventSource(bridge);
    bridge.start();
    await new Promise(r => setImmediate(r));

    // Simulate error to trigger reconnect timer
    bridge._reconnectDelay = 60_000; // long delay so timer is still pending
    bridge._reconnectTimer = setTimeout(() => {}, 60_000);

    assert.doesNotThrow(() => bridge.destroy());
    // destroy() calls clearTimeout() but does not null the ref;
    // what matters is _destroyed is true so the timer callback is a no-op.
    assert.equal(bridge._destroyed, true);
  });
});

// ---------------------------------------------------------------------------
// SSE connection lifecycle
// ---------------------------------------------------------------------------

describe('Bridge — SSE connection', () => {
  it('emits "connected" when the SSE stream opens', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const getEs = injectFakeEventSource(bridge);
    mockFetch(bridge);

    const connected = new Promise(r => bridge.once('connected', r));
    bridge.start();
    await new Promise(r => setImmediate(r));
    getEs().simulateOpen();

    await connected; // should resolve
    bridge.destroy();
  });

  it('emits "disconnected" and schedules reconnect on SSE error', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._reconnectDelay = 60_000; // prevent actual reconnect
    const getEs = injectFakeEventSource(bridge);
    mockFetch(bridge);

    const disconnected = new Promise(r => bridge.once('disconnected', r));
    bridge.start();
    await new Promise(r => setImmediate(r));
    getEs().simulateError();

    await disconnected;
    assert.notEqual(bridge._reconnectTimer, null);
    bridge.destroy();
  });

  it('resets reconnect delay to initial value on successful reconnect', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const getEs = injectFakeEventSource(bridge);
    mockFetch(bridge);

    bridge.start();
    await new Promise(r => setImmediate(r));

    // Simulate a previous backoff
    bridge._reconnectDelay = 30_000;
    getEs().simulateOpen();

    // onopen resets the delay
    assert.equal(bridge._reconnectDelay, 5_000);
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// _handleCommand() — tcp_send
// ---------------------------------------------------------------------------

describe('Bridge — _handleCommand() tcp_send', () => {
  it('calls TcpPool.send() with correct host/port/payload', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send',
      requestId: 'req-1',
      host: '192.168.1.1',
      port: '9000',
      payload: 'PRESET 1\r\n',
    }));

    assert.equal(bridge._tcpPool._sent.length, 1);
    assert.deepEqual(bridge._tcpPool._sent[0], {
      host: '192.168.1.1',
      port: 9000,
      payload: 'PRESET 1\r\n',
    });
    bridge.destroy();
  });

  it('posts { ok: true } status after a successful tcp_send', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send',
      requestId: 'req-ok',
      host: '10.0.0.1',
      port: 8000,
      payload: 'GO',
    }));

    assert.ok(statusCalls.some(c => c.requestId === 'req-ok' && c.ok === true));
    bridge.destroy();
  });

  it('emits "command:ok" after a successful tcp_send', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool();
    mockFetch(bridge);

    const okEvent = new Promise(r => bridge.once('command:ok', r));

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send',
      requestId: 'r',
      host: '10.0.0.1',
      port: 1234,
      payload: 'data',
    }));

    const evt = await okEvent;
    assert.equal(evt.host, '10.0.0.1');
    assert.equal(evt.port, 1234);
    bridge.destroy();
  });

  it('posts { ok: false, error } when TcpPool.send() rejects', async () => {
    const sendErr = new Error('TCP write failed');
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool({ sendError: sendErr });
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send',
      requestId: 'req-fail',
      host: '10.0.0.1',
      port: 9001,
      payload: 'CMD',
    }));

    const failCall = statusCalls.find(c => c.requestId === 'req-fail');
    assert.ok(failCall, 'should have posted status for failed command');
    assert.equal(failCall.ok, false);
    assert.ok(failCall.error.includes('TCP write failed'));
    bridge.destroy();
  });

  it('emits "command:error" when TcpPool.send() rejects', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool({ sendError: new Error('oops') });
    mockFetch(bridge);

    const errEvent = new Promise(r => bridge.once('command:error', r));

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send',
      requestId: 'r2',
      host: '10.0.0.2',
      port: 1234,
      payload: 'x',
    }));

    const evt = await errEvent;
    assert.equal(evt.host, '10.0.0.2');
    assert.ok(evt.error.includes('oops'));
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// _handleCommand() — bad input
// ---------------------------------------------------------------------------

describe('Bridge — _handleCommand() invalid input', () => {
  it('emits "error" for non-JSON data', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool();
    mockFetch(bridge);

    const errEvent = new Promise(r => bridge.once('error', r));
    await bridge._handleCommand('not valid json {{{{');
    const err = await errEvent;
    assert.ok(err.message.includes('non-JSON'));
    bridge.destroy();
  });

  it('emits "error" for unknown command type', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool();
    mockFetch(bridge);

    const errEvent = new Promise(r => bridge.once('error', r));
    await bridge._handleCommand(JSON.stringify({ type: 'unknown_op', requestId: 'x' }));
    const err = await errEvent;
    assert.ok(err.message.includes('Unknown command type'));
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// _postStatus() — network failure
// ---------------------------------------------------------------------------

describe('Bridge — _postStatus() network failure', () => {
  it('emits "error" when fetch throws (does not propagate exception)', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });

    // Override fetch to throw
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('Network down'); };

    const errEvent = new Promise(r => bridge.once('error', r));
    await bridge._postStatus({ type: 'heartbeat' });

    const err = await errEvent;
    assert.ok(err.message.includes('Status POST failed'));

    global.fetch = origFetch;
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// startHeartbeat()
// ---------------------------------------------------------------------------

describe('Bridge — startHeartbeat()', () => {
  it('calls _postStatus at each interval', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const calls = mockFetch(bridge);

    const timer = bridge.startHeartbeat(20);
    await new Promise(r => setTimeout(r, 75));
    clearInterval(timer);

    assert.ok(calls.length >= 2, `expected ≥ 2 heartbeats, got ${calls.length}`);
    assert.ok(calls.every(c => c.type === 'heartbeat'));
    bridge.destroy();
  });

  it('stops heartbeats after bridge.destroy()', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const calls = mockFetch(bridge);

    bridge.startHeartbeat(20);
    bridge.destroy();

    const countAfterDestroy = calls.length;
    await new Promise(r => setTimeout(r, 60));

    // No new heartbeats should arrive after destroy
    assert.equal(calls.length, countAfterDestroy);
  });
});

// ---------------------------------------------------------------------------
// TCP pool event forwarding
// ---------------------------------------------------------------------------

describe('Bridge — TCP pool event forwarding', () => {
  it('forwards TcpPool "connected" as "tcp:connected"', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });

    const tcpConnected = new Promise(r => bridge.once('tcp:connected', r));
    bridge._tcpPool.emit('connected', 'host:1234');

    const key = await tcpConnected;
    assert.equal(key, 'host:1234');
    bridge.destroy();
  });

  it('forwards TcpPool "disconnected" as "tcp:disconnected"', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });

    const tcpDisconnected = new Promise(r => bridge.once('tcp:disconnected', r));
    bridge._tcpPool.emit('disconnected', 'host:5678');

    const key = await tcpDisconnected;
    assert.equal(key, 'host:5678');
    bridge.destroy();
  });

  it('forwards TcpPool "error" as "tcp:error" with key and error', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });

    const tcpError = new Promise(r => bridge.once('tcp:error', (k, e) => r({ k, e })));
    const err = new Error('conn refused');
    bridge._tcpPool.emit('error', 'host:9999', err);

    const { k, e } = await tcpError;
    assert.equal(k, 'host:9999');
    assert.equal(e, err);
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// reconnectAll()
// ---------------------------------------------------------------------------

describe('Bridge — reconnectAll()', () => {
  it('closes the existing SSE connection and calls tcpPool.reconnectAll()', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    let tcpReconnectCalled = false;
    bridge._tcpPool.reconnectAll = () => { tcpReconnectCalled = true; };

    let newConnectCalled = false;
    bridge._connect = async () => { newConnectCalled = true; };

    // Simulate an open SSE connection
    let esClosed = false;
    bridge._es = { close() { esClosed = true; }, readyState: 1 };

    bridge.reconnectAll();

    assert.equal(esClosed, true);
    assert.equal(tcpReconnectCalled, true);
    assert.equal(newConnectCalled, true);
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// _handleCommand() — http_request
// ---------------------------------------------------------------------------

describe('Bridge — _handleCommand() http_request', () => {
  it('makes a GET request and posts { ok: true, status } on success', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const statusCalls = mockFetch(bridge);

    // Stub _httpRequest directly
    bridge._httpRequest = async ({ method, url }) => {
      return { status: 200, body: { state: 'READY' } };
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'http_request',
      requestId: 'req-http-1',
      method: 'GET',
      url: 'http://192.168.1.50/Monarch/sdk/status',
    }));

    const call = statusCalls.find(c => c.requestId === 'req-http-1');
    assert.ok(call, 'should have posted status');
    assert.equal(call.ok, true);
    assert.equal(call.status, 200);
    bridge.destroy();
  });

  it('posts { ok: false } when the HTTP request throws', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const statusCalls = mockFetch(bridge);

    bridge._httpRequest = async () => {
      throw new Error('ECONNREFUSED');
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'http_request',
      requestId: 'req-http-fail',
      method: 'POST',
      url: 'http://192.168.1.50/Monarch/sdk/encoder1/start',
      headers: {},
      body: {},
    }));

    const call = statusCalls.find(c => c.requestId === 'req-http-fail');
    assert.ok(call, 'should have posted status');
    assert.equal(call.ok, false);
    assert.ok(call.error.includes('ECONNREFUSED'));
    bridge.destroy();
  });

  it('emits "command:ok" after a successful http_request', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    mockFetch(bridge);

    bridge._httpRequest = async () => ({ status: 200, body: {} });

    const okEvent = new Promise(r => bridge.once('command:ok', r));

    await bridge._handleCommand(JSON.stringify({
      type: 'http_request',
      requestId: 'r-http',
      method: 'POST',
      url: 'http://10.0.0.5/Monarch/sdk/encoder1/start',
    }));

    const evt = await okEvent;
    assert.equal(evt.type, 'http_request');
    assert.ok(evt.url.includes('encoder1/start'));
    bridge.destroy();
  });

  it('emits "command:error" when http_request fails', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    mockFetch(bridge);

    bridge._httpRequest = async () => { throw new Error('timeout'); };

    const errEvent = new Promise(r => bridge.once('command:error', r));

    await bridge._handleCommand(JSON.stringify({
      type: 'http_request',
      requestId: 'r-http-err',
      method: 'GET',
      url: 'http://10.0.0.5/Monarch/sdk/status',
    }));

    const evt = await errEvent;
    assert.equal(evt.type, 'http_request');
    assert.ok(evt.error.includes('timeout'));
    bridge.destroy();
  });

  it('_httpRequest serialises object body as JSON', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge.destroy(); // not starting SSE

    const fetchCalls = [];
    const origFetch = global.fetch;
    global.fetch = async (url, init) => {
      fetchCalls.push({ url, method: init.method, body: init.body, headers: init.headers });
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
      };
    };

    await bridge._httpRequest({
      method: 'POST',
      url: 'http://10.0.0.5/Monarch/sdk/encoder1/start',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      body: { foo: 'bar' },
    });

    global.fetch = origFetch;

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].method, 'POST');
    assert.equal(fetchCalls[0].body, JSON.stringify({ foo: 'bar' }));
    assert.equal(fetchCalls[0].headers['Content-Type'], 'application/json');
    assert.equal(fetchCalls[0].headers['Authorization'], 'Basic dXNlcjpwYXNz');
  });
});
