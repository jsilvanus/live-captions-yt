import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SessionStore, makeSessionId } from '../src/store.js';

// ---------------------------------------------------------------------------
// Mock sender factory
// ---------------------------------------------------------------------------

function makeMockSender() {
  const calls = { end: 0 };
  return {
    calls,
    sequence: 0,
    end: async () => { calls.end++; }
  };
}

// ---------------------------------------------------------------------------
// makeSessionId
// ---------------------------------------------------------------------------

describe('makeSessionId', () => {
  it('should return a 16-character hex string', () => {
    const id = makeSessionId('key', 'stream', 'https://example.com');
    assert.strictEqual(typeof id, 'string');
    assert.strictEqual(id.length, 16);
    assert.match(id, /^[0-9a-f]{16}$/);
  });

  it('should be deterministic — same inputs produce same output', () => {
    const id1 = makeSessionId('apikey1', 'stream1', 'https://a.com');
    const id2 = makeSessionId('apikey1', 'stream1', 'https://a.com');
    assert.strictEqual(id1, id2);
  });

  it('should differ for different inputs', () => {
    const id1 = makeSessionId('apikey1', 'stream1', 'https://a.com');
    const id2 = makeSessionId('apikey1', 'stream1', 'https://b.com');
    assert.notStrictEqual(id1, id2);
  });

  it('should differ when only the API key differs', () => {
    const id1 = makeSessionId('key1', 'stream', 'https://a.com');
    const id2 = makeSessionId('key2', 'stream', 'https://a.com');
    assert.notStrictEqual(id1, id2);
  });
});

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

describe('SessionStore', () => {
  let store;

  beforeEach(() => {
    // cleanupInterval: 0 disables the timer so tests don't leak
    store = new SessionStore({ cleanupInterval: 0 });
  });

  after(() => {
    // Ensure cleanup is stopped in case any test enables it
    if (store) store.stopCleanup();
  });

  // -------------------------------------------------------------------------
  // create / get / has
  // -------------------------------------------------------------------------

  describe('create, get, has', () => {
    it('should create a session and retrieve it by sessionId', () => {
      const sender = makeMockSender();
      const session = store.create({
        apiKey: 'api1',
        streamKey: 'stream1',
        domain: 'https://example.com',
        jwt: 'test-jwt',
        sequence: 0,
        syncOffset: 0,
        sender
      });

      assert.ok(session.sessionId);
      assert.strictEqual(session.apiKey, 'api1');
      assert.strictEqual(session.streamKey, 'stream1');
      assert.strictEqual(session.domain, 'https://example.com');
      assert.strictEqual(session.jwt, 'test-jwt');
      assert.strictEqual(session.sequence, 0);
      assert.strictEqual(session.syncOffset, 0);
      assert.ok(session.startedAt > 0);
      assert.ok(session.createdAt instanceof Date);
      assert.ok(session.lastActivityAt instanceof Date);

      // get by sessionId
      const fetched = store.get(session.sessionId);
      assert.strictEqual(fetched, session);
    });

    it('has() should return true for existing session', () => {
      const sender = makeMockSender();
      const session = store.create({
        apiKey: 'api2', streamKey: 'stream2', domain: 'https://b.com',
        jwt: 'jwt2', sender
      });
      assert.strictEqual(store.has(session.sessionId), true);
    });

    it('has() should return false for non-existent session', () => {
      assert.strictEqual(store.has('deadbeef00000000'), false);
    });

    it('get() should return undefined for non-existent session', () => {
      assert.strictEqual(store.get('deadbeef00000000'), undefined);
    });

    it('sessionId should match makeSessionId output', () => {
      const sender = makeMockSender();
      const session = store.create({
        apiKey: 'mykey', streamKey: 'mystream', domain: 'https://c.com',
        jwt: 'jwt', sender
      });
      const expected = makeSessionId('mykey', 'mystream', 'https://c.com');
      assert.strictEqual(session.sessionId, expected);
    });

    it('should default sequence and syncOffset to 0', () => {
      const sender = makeMockSender();
      const session = store.create({
        apiKey: 'a', streamKey: 'b', domain: 'https://d.com', jwt: 'j', sender
      });
      assert.strictEqual(session.sequence, 0);
      assert.strictEqual(session.syncOffset, 0);
    });
  });

  // -------------------------------------------------------------------------
  // getByDomain
  // -------------------------------------------------------------------------

  describe('getByDomain', () => {
    it('should return all sessions with matching domain', () => {
      store.create({
        apiKey: 'k1', streamKey: 's1', domain: 'https://example.com',
        jwt: 'j1', sender: makeMockSender()
      });
      store.create({
        apiKey: 'k2', streamKey: 's2', domain: 'https://example.com',
        jwt: 'j2', sender: makeMockSender()
      });
      store.create({
        apiKey: 'k3', streamKey: 's3', domain: 'https://other.com',
        jwt: 'j3', sender: makeMockSender()
      });

      const matches = store.getByDomain('https://example.com');
      assert.strictEqual(matches.length, 2);
      assert.ok(matches.every(s => s.domain === 'https://example.com'));
    });

    it('should return empty array when no sessions match the domain', () => {
      const result = store.getByDomain('https://unknown.com');
      assert.deepStrictEqual(result, []);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('should remove and return the session', () => {
      const sender = makeMockSender();
      const session = store.create({
        apiKey: 'rm-key', streamKey: 'rm-stream', domain: 'https://rm.com',
        jwt: 'rm-jwt', sender
      });

      const removed = store.remove(session.sessionId);
      assert.strictEqual(removed, session);
      assert.strictEqual(store.has(session.sessionId), false);
    });

    it('should return undefined for non-existent session', () => {
      const result = store.remove('deadbeef00000001');
      assert.strictEqual(result, undefined);
    });
  });

  // -------------------------------------------------------------------------
  // all / size
  // -------------------------------------------------------------------------

  describe('all and size', () => {
    it('size() should return 0 for empty store', () => {
      assert.strictEqual(store.size(), 0);
    });

    it('size() should return the count of active sessions', () => {
      store.create({ apiKey: 'sz1', streamKey: 's1', domain: 'https://sz.com', jwt: 'j', sender: makeMockSender() });
      store.create({ apiKey: 'sz2', streamKey: 's2', domain: 'https://sz.com', jwt: 'j', sender: makeMockSender() });
      assert.strictEqual(store.size(), 2);
    });

    it('all() should iterate over all sessions', () => {
      store.create({ apiKey: 'al1', streamKey: 's1', domain: 'https://al.com', jwt: 'j', sender: makeMockSender() });
      store.create({ apiKey: 'al2', streamKey: 's2', domain: 'https://al.com', jwt: 'j', sender: makeMockSender() });
      const sessions = [...store.all()];
      assert.strictEqual(sessions.length, 2);
    });
  });

  // -------------------------------------------------------------------------
  // touch
  // -------------------------------------------------------------------------

  describe('touch', () => {
    it('should update lastActivityAt to approximately now', async () => {
      const sender = makeMockSender();
      const session = store.create({
        apiKey: 'touch-key', streamKey: 's', domain: 'https://t.com',
        jwt: 'j', sender
      });

      const before = new Date();
      // Small delay to ensure time difference
      await new Promise(r => setTimeout(r, 5));
      store.touch(session.sessionId);
      const after = new Date();

      assert.ok(session.lastActivityAt >= before);
      assert.ok(session.lastActivityAt <= after);
    });

    it('should do nothing for non-existent session', () => {
      assert.doesNotThrow(() => store.touch('deadbeef00000002'));
    });
  });

  // -------------------------------------------------------------------------
  // stopCleanup
  // -------------------------------------------------------------------------

  describe('stopCleanup', () => {
    it('should not throw when called on a store with no timer', () => {
      const s = new SessionStore({ cleanupInterval: 0 });
      assert.doesNotThrow(() => s.stopCleanup());
    });

    it('should stop the cleanup timer when it exists', async () => {
      const s = new SessionStore({ sessionTtl: 1, cleanupInterval: 50 });
      // Verify it has a timer
      assert.ok(s._timer !== null);
      s.stopCleanup();
      assert.strictEqual(s._timer, null);
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup sweep
  // -------------------------------------------------------------------------

  describe('cleanup sweep', () => {
    it('should remove idle sessions and call sender.end()', async () => {
      // Store with very short TTL (1ms) and short cleanup interval (20ms)
      const sweepStore = new SessionStore({ sessionTtl: 1, cleanupInterval: 20 });

      const sender = makeMockSender();
      const session = sweepStore.create({
        apiKey: 'sweep-key', streamKey: 'sweep-stream', domain: 'https://sweep.com',
        jwt: 'j', sender
      });

      // Wait for TTL to pass and sweep to run
      await new Promise(r => setTimeout(r, 80));

      sweepStore.stopCleanup();

      assert.strictEqual(sweepStore.has(session.sessionId), false);
      assert.strictEqual(sender.calls.end, 1);
    });

    it('should not remove recently active sessions', async () => {
      // Store with short cleanup interval but longer TTL
      const sweepStore = new SessionStore({ sessionTtl: 10000, cleanupInterval: 20 });

      const sender = makeMockSender();
      const session = sweepStore.create({
        apiKey: 'active-key', streamKey: 'active-stream', domain: 'https://active.com',
        jwt: 'j', sender
      });

      // Wait for sweep to run without TTL expiring
      await new Promise(r => setTimeout(r, 50));

      sweepStore.stopCleanup();

      // Session should still exist
      assert.strictEqual(sweepStore.has(session.sessionId), true);
      assert.strictEqual(sender.calls.end, 0);
    });
  });
});
