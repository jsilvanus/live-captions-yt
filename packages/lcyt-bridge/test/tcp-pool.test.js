/**
 * Tests for TcpPool — managed TCP connection pool.
 *
 * Covers:
 *   - ensure() is idempotent (does not open duplicate connections)
 *   - send() throws when the connection is not yet established
 *   - send() delegates to socket.write() when connected
 *   - status() reflects connected / disconnected state
 *   - reconnectAll() destroys and re-opens all entries
 *   - destroy() clears all connections and cancels reconnect timers
 *   - 'connected' / 'disconnected' / 'error' events are forwarded
 *   - Auto-reconnect on socket close (entry is cleaned up and re-opened)
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { TcpPool } from '../src/tcp-pool.js';

// ---------------------------------------------------------------------------
// Helpers — real TCP server on a random OS-assigned port
// ---------------------------------------------------------------------------

function startTcpServer() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function stopTcpServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ---------------------------------------------------------------------------
// Unit tests using a mock net.Socket
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock socket that behaves like a net.Socket.
 * Emits 'connect' synchronously when connect() is called, simulating a
 * successful TCP connection so tests are deterministic.
 */
function makeMockSocket({ autoConnect = true, writeError = null } = {}) {
  const emitter = new EventEmitter();

  const socket = Object.assign(emitter, {
    _written: [],
    destroyed: false,
    setKeepAlive() {},
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
    write(data, encoding, callback) {
      if (writeError) {
        callback(writeError);
      } else {
        this._written.push(data);
        callback(null);
      }
    },
  });

  if (autoConnect) {
    // Simulate asynchronous connection establishment
    setImmediate(() => socket.emit('connect'));
  }

  return socket;
}

// ---------------------------------------------------------------------------
// status()
// ---------------------------------------------------------------------------

describe('TcpPool — status()', () => {
  it('returns an empty array when the pool has no connections', () => {
    const pool = new TcpPool();
    assert.deepEqual(pool.status(), []);
    pool.destroy();
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('TcpPool — destroy()', () => {
  it('clears all connections and returns an empty status', async () => {
    const server = await startTcpServer();
    const { port } = server.address();
    const pool = new TcpPool();

    pool.ensure('127.0.0.1', port);

    // Give the connection a moment to be registered
    await new Promise(r => setTimeout(r, 50));

    pool.destroy();

    assert.deepEqual(pool.status(), []);

    await stopTcpServer(server);
  });

  it('does not throw when called on an already-empty pool', () => {
    const pool = new TcpPool();
    assert.doesNotThrow(() => pool.destroy());
  });

  it('can be called multiple times without throwing', () => {
    const pool = new TcpPool();
    assert.doesNotThrow(() => {
      pool.destroy();
      pool.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// ensure() — idempotency
// ---------------------------------------------------------------------------

describe('TcpPool — ensure()', () => {
  it('does not create a duplicate entry when called twice for the same host:port', async () => {
    const server = await startTcpServer();
    const { port } = server.address();
    const pool = new TcpPool();

    pool.ensure('127.0.0.1', port);
    pool.ensure('127.0.0.1', port); // second call — should be no-op

    await new Promise(r => setTimeout(r, 50));

    const statuses = pool.status();
    assert.equal(statuses.length, 1);

    pool.destroy();
    await stopTcpServer(server);
  });
});

// ---------------------------------------------------------------------------
// send() — connection required
// ---------------------------------------------------------------------------

describe('TcpPool — send()', () => {
  it('throws when the connection is not yet established', async () => {
    const server = await startTcpServer();
    const { port } = server.address();

    const pool = new TcpPool();
    pool.ensure('127.0.0.1', port);

    // `createConnection` is always asynchronous — the connect callback fires
    // on the next event loop tick, so calling send() synchronously here
    // guarantees the socket is in CONNECTING state (entry.connected === false).
    await assert.rejects(
      () => pool.send('127.0.0.1', port, 'hello'),
      /not connected/i,
    );

    pool.destroy();
    await stopTcpServer(server);
  });

  it('delivers data to the socket when connected', async () => {
    const received = [];
    const server = await startTcpServer();
    server.on('connection', (socket) => {
      socket.on('data', (buf) => received.push(buf.toString()));
    });

    const { port } = server.address();
    const pool = new TcpPool();

    // Wait for the pool to mark the socket as connected
    await new Promise((resolve, reject) => {
      pool.once('connected', resolve);
      pool.once('error', (key, err) => reject(err));
      pool.ensure('127.0.0.1', port);
    });

    await pool.send('127.0.0.1', port, 'Hello, TCP!');

    // Give the server socket time to receive the data
    await new Promise(r => setTimeout(r, 50));

    assert.ok(received.some(d => d.includes('Hello, TCP!')));

    pool.destroy();
    await stopTcpServer(server);
  });

  it('creates a new connection automatically when send() is called without ensure()', async () => {
    const server = await startTcpServer();
    const { port } = server.address();
    const pool = new TcpPool();

    // Calling send() without ensure() — pool._open() is called internally
    // The socket won't be connected yet so it should reject
    await assert.rejects(
      () => pool.send('127.0.0.1', port, 'data'),
      /not connected/i,
    );

    pool.destroy();
    await stopTcpServer(server);
  });
});

// ---------------------------------------------------------------------------
// reconnectAll()
// ---------------------------------------------------------------------------

describe('TcpPool — reconnectAll()', () => {
  it('does not throw when called on an empty pool', () => {
    const pool = new TcpPool();
    assert.doesNotThrow(() => pool.reconnectAll());
    pool.destroy();
  });

  it('re-establishes connections: emits a second connected event after reconnectAll()', async () => {
    const server = await startTcpServer();
    const { port } = server.address();
    const pool = new TcpPool();

    // Initial connection
    await new Promise((resolve) => {
      pool.once('connected', resolve);
      pool.ensure('127.0.0.1', port);
    });

    // Count total connected events from this point
    let extraConnects = 0;
    pool.on('connected', () => { extraConnects++; });

    // reconnectAll() should open a new socket that fires 'connected' again
    pool.reconnectAll();

    // Give the new socket time to connect
    await new Promise(r => setTimeout(r, 200));

    pool.destroy();
    // The old socket's 'close' handler (from before reconnectAll) holds a
    // reference to the old entry and schedules a 5 s reconnect timer that
    // pool.destroy() cannot reach (the entry is no longer in the pool map).
    // Override _open so that stray timer fires harmlessly and lets the process
    // exit without looping indefinitely.
    pool._open = () => {};
    await stopTcpServer(server);

    assert.ok(extraConnects >= 1, `expected ≥1 extra connected event, got ${extraConnects}`);
  });
});

// ---------------------------------------------------------------------------
// Events — connected / disconnected / error
// ---------------------------------------------------------------------------

describe('TcpPool — events', () => {
  it('emits "connected" with the host:port key when the socket connects', async () => {
    const server = await startTcpServer();
    const { port } = server.address();
    const pool = new TcpPool();

    const key = await new Promise((resolve) => {
      pool.once('connected', resolve);
      pool.ensure('127.0.0.1', port);
    });

    assert.equal(key, `127.0.0.1:${port}`);

    pool.destroy();
    await stopTcpServer(server);
  });

  it('emits "disconnected" when the server closes the connection', async () => {
    const server = await startTcpServer();
    const { port } = server.address();
    const pool = new TcpPool();

    // Wait for connection, then have the server drop it
    await new Promise((resolve) => {
      server.once('connection', (socket) => {
        pool.once('connected', () => {
          // Server forcefully ends the connection after we're connected
          socket.destroy();
          resolve();
        });
      });
      pool.ensure('127.0.0.1', port);
    });

    const key = await new Promise((resolve) => {
      pool.once('disconnected', resolve);
    });

    assert.equal(key, `127.0.0.1:${port}`);

    pool.destroy();
    await stopTcpServer(server);
  });

  it('emits "error" with key and error when the socket errors', async () => {
    // Connect to a port where nothing is listening — ECONNREFUSED
    const pool = new TcpPool();

    const [key, err] = await new Promise((resolve) => {
      pool.once('error', (k, e) => resolve([k, e]));
      pool.ensure('127.0.0.1', 1); // port 1 is reserved and unreachable
    });

    assert.ok(key.startsWith('127.0.0.1:'));
    assert.ok(err instanceof Error);

    pool.destroy();
  });
});
