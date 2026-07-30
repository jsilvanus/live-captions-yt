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
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.js';

/**
 * Bridge now fails closed on tcp_send/atem_switch/obs_switch/http_request/
 * model_call until its SecurityPolicy has loaded at least once (see
 * security-policy.test.js for that guard's own behavior). These dispatch
 * tests care about TcpPool/fetch/etc. wiring, not the security layer, so
 * prime an empty (default-allow) policy up front — same as a bridge that
 * successfully fetched a bridge with no configured rules.
 */
function makeBridge(opts = {}) {
  const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', ...opts });
  bridge._securityPolicy.update({ ipRules: [], commandRules: [] });
  return bridge;
}

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
      this._fetchSecurityPolicy();
    });

    fakeEs.addEventListener('rules_updated', () => {
      this._fetchSecurityPolicy();
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
// bridge.start() now fires a real _fetchSecurityPolicy() fetch immediately
// (not gated on the SSE 'connected' event — see "security policy fetch
// wiring" below). Every test in this file gets a benign default mock for
// global.fetch so a test that merely calls start()/simulateOpen() without
// caring about the security-policy fetch doesn't hit the real network;
// tests that DO care override global.fetch themselves within the test body,
// which simply wins for the rest of that test (assigned after this hook
// runs), same as the pre-existing local per-describe overrides already in
// this file.
// ---------------------------------------------------------------------------

const REAL_FETCH = global.fetch;
beforeEach(() => {
  global.fetch = async () => ({ ok: true, json: async () => ({ ipRules: [], commandRules: [] }) });
});
afterEach(() => {
  global.fetch = REAL_FETCH;
});

// ---------------------------------------------------------------------------
// Constructor / status()
// ---------------------------------------------------------------------------

describe('Bridge — constructor and status()', () => {
  it('initialises with sse: false and no TCP entries', () => {
    const bridge = makeBridge();
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
    const bridge = makeBridge();
    assert.doesNotThrow(() => bridge.destroy());
  });

  it('sets _destroyed = true so subsequent _connect() calls are no-ops', async () => {
    const bridge = makeBridge();
    injectFakeEventSource(bridge);
    bridge.destroy();
    // _connect should return immediately without setting _es
    await bridge._connect();
    assert.equal(bridge._es, null);
  });

  it('clears a pending reconnect timer', async () => {
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
// _handleCommand() — model_call (plan/ai_model_registry)
// ---------------------------------------------------------------------------

describe('Bridge — _handleCommand() model_call', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  it('POSTs to the endpoint and reports the parsed body via _postStatus', async () => {
    const bridge = makeBridge();
    const statusCalls = mockFetch(bridge);

    const fetchCalls = [];
    global.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ response: 'A person on stage', done: true }),
      };
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'model_call',
      requestId: 'mc-1',
      endpoint: 'http://ollama:11434/api/generate',
      model: 'llama3.1:8b',
      prompt: 'Summarise the context',
      outputMode: 'text',
    }));

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://ollama:11434/api/generate');
    const payload = JSON.parse(fetchCalls[0].init.body);
    assert.equal(payload.model, 'llama3.1:8b');
    assert.equal(payload.prompt, 'Summarise the context');
    assert.equal(payload.stream, false);
    assert.equal(payload.format, undefined, 'no format field in text mode');
    assert.equal(payload.images, undefined);

    const status = statusCalls.find(c => c.requestId === 'mc-1');
    assert.equal(status.ok, true);
    assert.equal(status.status, 200);
    assert.equal(status.body.response, 'A person on stage');
    bridge.destroy();
  });

  it('fetches sourceUrl itself and attaches base64 images; json mode sets format', async () => {
    const bridge = makeBridge();
    const statusCalls = mockFetch(bridge);

    const imageBytes = Buffer.from('fake-jpeg-bytes');
    const fetchCalls = [];
    global.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      if (url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => imageBytes };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ response: '{"objects":[]}' }) };
    };

    await bridge._handleCommand(JSON.stringify({
      type: 'model_call',
      requestId: 'mc-2',
      sourceUrl: 'http://backend.test/preview/key1/incoming.jpg',
      endpoint: 'http://ollama:11434/api/generate',
      model: 'llava',
      prompt: 'Describe the scene',
      outputMode: 'json',
    }));

    assert.equal(fetchCalls.length, 2, 'image fetch + model POST');
    assert.equal(fetchCalls[0].url, 'http://backend.test/preview/key1/incoming.jpg');
    const payload = JSON.parse(fetchCalls[1].init.body);
    assert.deepEqual(payload.images, [imageBytes.toString('base64')]);
    assert.equal(payload.format, 'json');

    const status = statusCalls.find(c => c.requestId === 'mc-2');
    assert.equal(status.ok, true);
    bridge.destroy();
  });

  it('reports { ok: false } when the source fetch fails', async () => {
    const bridge = makeBridge();
    const statusCalls = mockFetch(bridge);
    global.fetch = async () => ({ ok: false, status: 404 });

    const errEvent = new Promise(r => bridge.once('command:error', r));
    await bridge._handleCommand(JSON.stringify({
      type: 'model_call',
      requestId: 'mc-3',
      sourceUrl: 'http://backend.test/preview/key1/incoming.jpg',
      endpoint: 'http://ollama:11434/api/generate',
      model: 'llava',
      prompt: 'x',
    }));

    const status = statusCalls.find(c => c.requestId === 'mc-3');
    assert.equal(status.ok, false);
    assert.match(status.error, /Source fetch failed: 404/);
    const evt = await errEvent;
    assert.equal(evt.type, 'model_call');
    bridge.destroy();
  });

  it('reports { ok: false } when endpoint is missing', async () => {
    const bridge = makeBridge();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'model_call',
      requestId: 'mc-4',
      prompt: 'x',
    }));

    const status = statusCalls.find(c => c.requestId === 'mc-4');
    assert.equal(status.ok, false);
    assert.match(status.error, /requires an endpoint/);
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// _handleCommand() — bad input
// ---------------------------------------------------------------------------

describe('Bridge — _handleCommand() invalid input', () => {
  it('emits "error" for non-JSON data', async () => {
    const bridge = makeBridge();
    bridge._tcpPool = makeMockTcpPool();
    mockFetch(bridge);

    const errEvent = new Promise(r => bridge.once('error', r));
    await bridge._handleCommand('not valid json {{{{');
    const err = await errEvent;
    assert.ok(err.message.includes('non-JSON'));
    bridge.destroy();
  });

  it('emits "error" for unknown command type', async () => {
    const bridge = makeBridge();
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
    const bridge = makeBridge();

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
    const bridge = makeBridge();
    const calls = mockFetch(bridge);

    const timer = bridge.startHeartbeat(20);
    await new Promise(r => setTimeout(r, 75));
    clearInterval(timer);

    assert.ok(calls.length >= 2, `expected ≥ 2 heartbeats, got ${calls.length}`);
    assert.ok(calls.every(c => c.type === 'heartbeat'));
    bridge.destroy();
  });

  it('stops heartbeats after bridge.destroy()', async () => {
    const bridge = makeBridge();
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
    const bridge = makeBridge();

    const tcpConnected = new Promise(r => bridge.once('tcp:connected', r));
    bridge._tcpPool.emit('connected', 'host:1234');

    const key = await tcpConnected;
    assert.equal(key, 'host:1234');
    bridge.destroy();
  });

  it('forwards TcpPool "disconnected" as "tcp:disconnected"', async () => {
    const bridge = makeBridge();

    const tcpDisconnected = new Promise(r => bridge.once('tcp:disconnected', r));
    bridge._tcpPool.emit('disconnected', 'host:5678');

    const key = await tcpDisconnected;
    assert.equal(key, 'host:5678');
    bridge.destroy();
  });

  it('forwards TcpPool "error" as "tcp:error" with key and error', async () => {
    const bridge = makeBridge();

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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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
    const bridge = makeBridge();
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

// ---------------------------------------------------------------------------
// Local security enforcement (defense in depth) — see security-policy.test.js
// for SecurityPolicy's own unit tests; these confirm Bridge._handleCommand()
// consults it and never touches the network on a block.
// ---------------------------------------------------------------------------

describe('Bridge — local security enforcement', () => {
  it('blocks a tcp_send matching a local deny IP rule without calling TcpPool', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._securityPolicy.update({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }], commandRules: [] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-blocked', host: '10.0.0.1', port: 9000, payload: 'PRESET 1',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0, 'TcpPool.send() was never called');
    const call = statusCalls.find(c => c.requestId === 'req-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local bridge security policy/);
    bridge.destroy();
  });

  it('blocks a tcp_send matching a local deny command rule without calling TcpPool', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._securityPolicy.update({ ipRules: [], commandRules: [{ ruleType: 'deny', pattern: '^FACTORY-RESET$' }] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-blocked', host: '10.0.0.1', port: 9000, payload: 'FACTORY-RESET',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0);
    const call = statusCalls.find(c => c.requestId === 'req-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local bridge security policy/);
    bridge.destroy();
  });

  it('allows a tcp_send that matches no local deny rule', async () => {
    const bridge = makeBridge(); // primes an empty (default-allow) policy
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-ok', host: '10.0.0.1', port: 9000, payload: 'PRESET 1',
    }));

    assert.equal(bridge._tcpPool._sent.length, 1);
    assert.ok(statusCalls.some(c => c.requestId === 'req-ok' && c.ok === true));
    bridge.destroy();
  });

  it('fails closed on a fresh bridge whose security policy has never loaded', async () => {
    // Deliberately no makeBridge() priming and no _connect()/'connected' event
    // — this is the state a just-started bridge is in before its first
    // successful GET .../security-rules/for-agent fetch resolves.
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-early', host: '10.0.0.1', port: 9000, payload: 'PRESET 1',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0, 'no unguarded startup window');
    const call = statusCalls.find(c => c.requestId === 'req-early');
    assert.equal(call.ok, false);
    assert.match(call.error, /not yet loaded/);
    bridge.destroy();
  });

  it('blocks a model_call whose sourceUrl host matches a local deny IP rule, even when endpoint is allowed', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._securityPolicy.update({ ipRules: [{ ruleType: 'deny', pattern: '169.254.169.254' }], commandRules: [] });
    const statusCalls = mockFetch(bridge);
    let modelCallCalled = false;
    bridge._modelCall = async () => { modelCallCalled = true; return { status: 200, body: {} }; };

    await bridge._handleCommand(JSON.stringify({
      type: 'model_call', requestId: 'req-mc-blocked',
      endpoint: 'http://ollama:11434/api/generate',
      sourceUrl: 'http://169.254.169.254/latest/meta-data/',
    }));

    assert.equal(modelCallCalled, false, 'blocked before ever fetching sourceUrl, despite endpoint being allowed');
    const call = statusCalls.find(c => c.requestId === 'req-mc-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local bridge security policy/);
    bridge.destroy();
  });

  it('blocks an http_request whose URL host matches a local deny IP rule without calling _httpRequest', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    bridge._securityPolicy.update({ ipRules: [{ ruleType: 'deny', pattern: '192.168.1.50' }], commandRules: [] });
    const statusCalls = mockFetch(bridge);
    let httpRequestCalled = false;
    bridge._httpRequest = async () => { httpRequestCalled = true; return { status: 200, body: {} }; };

    await bridge._handleCommand(JSON.stringify({
      type: 'http_request', requestId: 'req-http-blocked', method: 'GET', url: 'http://192.168.1.50/Monarch/sdk/status',
    }));

    assert.equal(httpRequestCalled, false);
    const call = statusCalls.find(c => c.requestId === 'req-http-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local bridge security policy/);
    bridge.destroy();
  });

  it('an unrecognised (non-secured) command type is unaffected by the security policy', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    // No policy loaded at all — an unknown type should still just report
    // "Unknown command type", not a security block.
    const errEvent = new Promise(r => bridge.once('error', r));
    await bridge._handleCommand(JSON.stringify({ type: 'not_a_real_type', requestId: 'x' }));
    const err = await errEvent;
    assert.match(err.message, /Unknown command type/);
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// LocalSecurityFloor wiring — the deployer-controlled security.local.yaml
// floor (see local-security-floor.test.js for the class's own unit tests).
// These confirm Bridge actually consults it and that its block message is
// distinguishable from the backend-synced SecurityPolicy's.
// ---------------------------------------------------------------------------

describe('Bridge — local security floor (security.local.yaml) wiring', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'bridge-lsf-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeYaml(content) {
    fs.writeFileSync(join(dir, 'security.local.yaml'), content);
  }

  it('omitting localPolicyDir leaves the floor absent (backward compatible)', () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    assert.deepEqual(bridge.localSecurityFloorSummary(), { present: false, loadError: null, ipRuleCount: 0, commandRuleCount: 0 });
    bridge.destroy();
  });

  it('loads security.local.yaml from localPolicyDir at construction time', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "169.254.169.254"
`);
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    assert.deepEqual(bridge.localSecurityFloorSummary(), { present: true, loadError: null, ipRuleCount: 1, commandRuleCount: 0 });
    bridge.destroy();
  });

  it('blocks a tcp_send matching a local-floor deny IP rule even though the backend policy allows everything', async () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "169.254.169.254"
    description: "never allow cloud metadata"
`);
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    bridge._securityPolicy.update({ ipRules: [], commandRules: [] }); // backend layer: fully open
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-floor-blocked', host: '169.254.169.254', port: 80, payload: 'x',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0);
    const call = statusCalls.find(c => c.requestId === 'req-floor-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local security floor/);
    assert.match(call.error, /never allow cloud metadata/);
    bridge.destroy();
  });

  it('blocks a tcp_send matching a local-floor deny command rule even though the backend policy allows everything', async () => {
    writeYaml(`
rules:
  - kind: command
    pattern: "^FACTORY-RESET$"
`);
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    bridge._securityPolicy.update({ ipRules: [], commandRules: [] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-floor-cmd-blocked', host: '10.0.0.1', port: 80, payload: 'FACTORY-RESET',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0);
    const call = statusCalls.find(c => c.requestId === 'req-floor-cmd-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local security floor/);
    bridge.destroy();
  });

  it('allows a command that neither the backend policy nor the local floor deny', async () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "169.254.169.254"
`);
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    bridge._securityPolicy.update({ ipRules: [], commandRules: [] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-ok', host: '10.0.0.1', port: 80, payload: 'PRESET-1',
    }));

    assert.equal(bridge._tcpPool._sent.length, 1);
    assert.ok(statusCalls.some(c => c.requestId === 'req-ok' && c.ok === true));
    bridge.destroy();
  });

  it('a malformed security.local.yaml blocks every secured command, distinct from the backend-policy message', async () => {
    writeYaml('rules: not-a-list');
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    bridge._securityPolicy.update({ ipRules: [], commandRules: [] }); // backend layer would otherwise allow
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    assert.ok(bridge.localSecurityFloorSummary().loadError);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-malformed', host: '10.0.0.1', port: 80, payload: 'PRESET-1',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0);
    const call = statusCalls.find(c => c.requestId === 'req-malformed');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local security floor/);
    assert.match(call.error, /malformed/);
    bridge.destroy();
  });

  it('the backend-synced SecurityPolicy block still reports its own distinct message when the floor would have allowed', async () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "8.8.8.8"
`); // present, valid, but does not match this command's target
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    bridge._securityPolicy.update({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }], commandRules: [] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-backend-blocked', host: '10.0.0.1', port: 80, payload: 'x',
    }));

    const call = statusCalls.find(c => c.requestId === 'req-backend-blocked');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local bridge security policy/);
    bridge.destroy();
  });

  it('the local floor still blocks an IP target the backend allow-list explicitly allows ("allow only this")', async () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "10.0.0.1"
    description: "never allow this target, no matter what the backend says"
`);
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    // Allow-list mode: only 10.0.0.1 is permitted by the backend layer, everything else is default-denied.
    bridge._securityPolicy.update({ ipRules: [{ ruleType: 'allow', pattern: '10.0.0.1' }], commandRules: [] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-floor-vs-allowlist', host: '10.0.0.1', port: 80, payload: 'x',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0);
    const call = statusCalls.find(c => c.requestId === 'req-floor-vs-allowlist');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local security floor/);
    assert.match(call.error, /never allow this target/);
    bridge.destroy();
  });

  it('the local floor still blocks a command the backend allow-list explicitly allows ("allow only this")', async () => {
    writeYaml(`
rules:
  - kind: command
    pattern: "^PRESET-1$"
`);
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    // Allow-list mode: only PRESET-1 is permitted by the backend layer, everything else is default-denied.
    bridge._securityPolicy.update({ ipRules: [], commandRules: [{ ruleType: 'allow', pattern: '^PRESET-1$' }] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-floor-vs-allowlist-cmd', host: '10.0.0.1', port: 80, payload: 'PRESET-1',
    }));

    assert.equal(bridge._tcpPool._sent.length, 0);
    const call = statusCalls.find(c => c.requestId === 'req-floor-vs-allowlist-cmd');
    assert.equal(call.ok, false);
    assert.match(call.error, /Blocked by local security floor/);
    bridge.destroy();
  });

  it('the backend allow-list still passes through a different target the local floor does not deny', async () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "169.254.169.254"
`); // present, valid, but does not match this command's target
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok', localPolicyDir: dir });
    bridge._securityPolicy.update({ ipRules: [{ ruleType: 'allow', pattern: '10.0.0.1' }], commandRules: [] });
    bridge._tcpPool = makeMockTcpPool();
    const statusCalls = mockFetch(bridge);

    await bridge._handleCommand(JSON.stringify({
      type: 'tcp_send', requestId: 'req-allowlist-passthrough', host: '10.0.0.1', port: 80, payload: 'x',
    }));

    assert.equal(bridge._tcpPool._sent.length, 1);
    assert.ok(statusCalls.some(c => c.requestId === 'req-allowlist-passthrough' && c.ok === true));
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// _fetchSecurityPolicy() — connected/rules_updated SSE wiring
// ---------------------------------------------------------------------------

describe('Bridge — security policy fetch wiring', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  it('start() fetches the policy immediately, from an instanceId-less URL, without waiting on SSE connect', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok-abc' });
    injectFakeEventSource(bridge); // SSE never opened/simulated in this test

    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(url);
      return { ok: true, json: async () => ({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }], commandRules: [] }) };
    };

    bridge.start();
    await new Promise(r => setImmediate(r));

    assert.equal(fetchCalls.length, 1);
    assert.equal(
      fetchCalls[0],
      'http://backend.test/production/bridge/security-rules/for-agent?token=tok-abc',
    );
    assert.equal(bridge._securityPolicy.isLoaded(), true);
    assert.equal(bridge._securityPolicy.checkIp('10.0.0.1', 80).allowed, false);
    bridge.destroy();
  });

  it('the "connected" event triggers an additional refetch', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const getEs = injectFakeEventSource(bridge);

    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ ipRules: [], commandRules: [] }) };
    };

    bridge.start(); // 1st fetch
    await new Promise(r => setImmediate(r));
    assert.equal(fetchCount, 1);

    getEs().simulateEvent('connected', {}); // 2nd fetch
    await new Promise(r => setImmediate(r));
    assert.equal(fetchCount, 2);
    bridge.destroy();
  });

  it('a "rules_updated" event triggers a refetch that replaces the cached policy', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const getEs = injectFakeEventSource(bridge);

    let responseBody = { ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }], commandRules: [] };
    global.fetch = async () => ({ ok: true, json: async () => responseBody });

    bridge.start();
    await new Promise(r => setImmediate(r));
    assert.equal(bridge._securityPolicy.checkIp('10.0.0.1', 80).allowed, false);

    responseBody = { ipRules: [], commandRules: [] }; // rule removed server-side
    getEs().simulateEvent('rules_updated', {});
    await new Promise(r => setImmediate(r));

    assert.equal(bridge._securityPolicy.checkIp('10.0.0.1', 80).allowed, true, 'refetch replaced the stale rule set');
    bridge.destroy();
  });

  it('a failed refetch keeps using the last known-good policy and emits "error"', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });
    const getEs = injectFakeEventSource(bridge);

    let shouldFail = false;
    global.fetch = async () => {
      if (shouldFail) throw new Error('network down');
      return { ok: true, json: async () => ({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }], commandRules: [] }) };
    };

    bridge.start();
    await new Promise(r => setImmediate(r));
    assert.equal(bridge._securityPolicy.checkIp('10.0.0.1', 80).allowed, false);

    shouldFail = true;
    const errEvent = new Promise(r => bridge.once('error', r));
    getEs().simulateEvent('rules_updated', {});
    const err = await errEvent;

    assert.match(err.message, /Security policy fetch failed/);
    assert.equal(bridge._securityPolicy.checkIp('10.0.0.1', 80).allowed, false, 'stale policy from before the failed refetch is still enforced');
    bridge.destroy();
  });

  it('a slower, older fetch resolving after a newer one does not clobber the fresher policy', async () => {
    const bridge = new Bridge({ backendUrl: 'http://backend.test', token: 'tok' });

    // First fetch (in-flight, slow): would report a deny rule.
    // Second fetch (fires after, resolves first): reports no rules.
    // The slow first response arriving last must NOT overwrite the second's result.
    const responses = [
      { delayMs: 30, body: { ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }], commandRules: [] } },
      { delayMs: 5,  body: { ipRules: [], commandRules: [] } },
    ];
    let call = 0;
    global.fetch = async () => {
      const { delayMs, body } = responses[call++];
      await new Promise(r => setTimeout(r, delayMs));
      return { ok: true, json: async () => body };
    };

    const first = bridge._fetchSecurityPolicy();
    const second = bridge._fetchSecurityPolicy();
    await Promise.all([first, second]);

    assert.equal(bridge._securityPolicy.checkIp('10.0.0.1', 80).allowed, true, 'the newer (empty-rules) fetch must win, not the slower stale one');
    bridge.destroy();
  });
});
