/**
 * SttManager integration tests.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SttManager } from '../src/stt-manager.js';

// ── Minimal mock store ────────────────────────────────────────────────────────

function makeStore(sessions = []) {
  return {
    values() { return sessions[Symbol.iterator](); },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnv() {
  const saved = {
    STT_DEFAULT_LANGUAGE: process.env.STT_DEFAULT_LANGUAGE,
    GOOGLE_STT_KEY:       process.env.GOOGLE_STT_KEY,
    MEDIAMTX_HLS_BASE_URL: process.env.MEDIAMTX_HLS_BASE_URL,
  };
  process.env.GOOGLE_STT_KEY        = 'test-key';
  process.env.MEDIAMTX_HLS_BASE_URL = 'http://localhost:8888';
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function neverFetch() {
  return async () => {
    throw new Error('fetch should not be called in this test');
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SttManager', () => {
  let originalFetch;
  let restoreEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    restoreEnv = makeEnv();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  test('isRunning() returns false before start', () => {
    const mgr = new SttManager(makeStore());
    assert.equal(mgr.isRunning('mykey'), false);
  });

  test('getStatus() returns { running: false } for unknown key', () => {
    const mgr = new SttManager(makeStore());
    const status = mgr.getStatus('unknown');
    assert.strictEqual(status.running, false);
    assert.ok('ffmpegVersion' in status, 'ffmpegVersion field expected');
    assert.ok('whepAvailable' in status, 'whepAvailable field expected');
  });

  test('start() then isRunning() returns true', async () => {
    // Prevent real fetch calls from the fetcher poll
    globalThis.fetch = async (url) => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore());
    await mgr.start('mykey', { provider: 'google', language: 'en-US' });
    assert.equal(mgr.isRunning('mykey'), true);
    await mgr.stop('mykey');
  });

  test('getStatus() returns running details after start', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore());
    await mgr.start('mykey', { provider: 'google', language: 'fi-FI' });

    const status = mgr.getStatus('mykey');
    assert.equal(status.running, true);
    assert.equal(status.provider, 'google');
    assert.equal(status.language, 'fi-FI');
    assert.equal(status.audioSource, 'hls');
    assert.equal(status.segmentsSent, 0);
    assert.equal(status.lastTranscript, null);

    await mgr.stop('mykey');
  });

  test('stop() removes session and emits stopped', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore());
    await mgr.start('mykey', { provider: 'google', language: 'en-US' });

    const stoppedEvents = [];
    mgr.on('stopped', e => stoppedEvents.push(e));

    await mgr.stop('mykey');

    assert.equal(mgr.isRunning('mykey'), false);
    assert.equal(stoppedEvents.length, 1);
    assert.equal(stoppedEvents[0].apiKey, 'mykey');
  });

  test('stop() is a no-op for unknown key', async () => {
    const mgr = new SttManager(makeStore());
    await assert.doesNotReject(() => mgr.stop('not-running'));
  });

  test('start() on already-running key restarts it', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore());
    const stoppedEvents = [];
    mgr.on('stopped', e => stoppedEvents.push(e));

    await mgr.start('mykey', { provider: 'google', language: 'en-US' });
    await mgr.start('mykey', { provider: 'google', language: 'fi-FI' }); // restart

    // The first session should have been stopped
    assert.equal(stoppedEvents.length, 1);
    assert.equal(mgr.getStatus('mykey').language, 'fi-FI');

    await mgr.stop('mykey');
  });

  test('throws on unsupported provider', async () => {
    const mgr = new SttManager(makeStore());
    await assert.rejects(
      () => mgr.start('mykey', { provider: 'unknown_provider' }),
      /unsupported provider/i
    );
  });

  test('throws on unsupported audioSource', async () => {
    const mgr = new SttManager(makeStore());
    await assert.rejects(
      () => mgr.start('mykey', { provider: 'google', audioSource: 'ftp' }),
      /unsupported audioSource/i
    );
  });

  test('stopAll() stops all running sessions', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore());
    await mgr.start('key1', { provider: 'google', language: 'en-US' });
    await mgr.start('key2', { provider: 'google', language: 'fi-FI' });

    assert.equal(mgr.isRunning('key1'), true);
    assert.equal(mgr.isRunning('key2'), true);

    await mgr.stopAll();

    assert.equal(mgr.isRunning('key1'), false);
    assert.equal(mgr.isRunning('key2'), false);
  });

  test('transcript is delivered into session _sendQueue', async () => {
    // Set up a fake backend session
    let queueResolved = false;
    const fakeSession = {
      apiKey:       'mykey',
      domain:       'test.local',
      sequence:     0,
      extraTargets: [],
      sender:       null,
      _sendQueue:   Promise.resolve(),
    };

    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore([fakeSession]));
    await mgr.start('mykey', { provider: 'google', language: 'en-US' });

    // Manually emit a transcript event from the adapter
    const sttSession = mgr._sessions.get('mykey');
    assert.ok(sttSession, 'stt session should exist');

    sttSession.adapter.emit('transcript', {
      text:       'Hello from STT',
      confidence: 0.95,
      timestamp:  new Date(),
    });

    // Wait for the promise chain to flush
    await new Promise(r => setTimeout(r, 50));

    // Sequence should have been incremented
    assert.equal(fakeSession.sequence, 1);

    await mgr.stop('mykey');
  });

  test('transcript is not delivered when no matching backend session', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    // Empty store — no backend session for this key
    const mgr = new SttManager(makeStore([]));
    await mgr.start('mykey', { provider: 'google', language: 'en-US' });

    const sttSession = mgr._sessions.get('mykey');
    // Should not throw
    sttSession.adapter.emit('transcript', {
      text:       'Ignored',
      confidence: 0.8,
      timestamp:  new Date(),
    });

    await new Promise(r => setTimeout(r, 20));
    await mgr.stop('mykey');
  });

  test('setDeliveryHelpers: server-side translation is invoked and delivered to a viewer target (Phase 5)', async () => {
    // Regression test for a real bug: _deliverTranscript previously reached
    // across packages via `await import('../../lcyt-backend/src/...')`, a
    // relative path that doesn't resolve from this file's location, silently
    // swallowed by `.catch(() => ({}))` — so translation and viewer delivery
    // never actually ran. setDeliveryHelpers() injects them instead; this
    // test proves the injected functions are actually called and their
    // output actually reaches the viewer broadcast.
    const fakeSession = {
      apiKey:       'mykey',
      domain:       'test.local',
      sequence:     0,
      extraTargets: [{ id: 'vt1', type: 'viewer', viewerKey: 'test-viewer' }],
      sender:       null,
      _sendQueue:   Promise.resolve(),
    };

    // getSttConfig(db, apiKey) does `db.prepare(...).get(apiKey)` — stub just enough of the shape.
    const fakeDb = { prepare: () => ({ get: () => ({ language: 'en-US', provider: 'google', audio_source: 'hls', auto_start: 0 }) }) };

    globalThis.fetch = async (url) => {
      // The HlsSegmentFetcher also polls a playlist URL in the background —
      // only intercept translateText's MyMemory GET, let everything else 404
      // like the other tests in this file do.
      if (String(url).includes('mymemory')) {
        return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Hei maailma' } }) };
      }
      return { ok: false, status: 404 };
    };

    const broadcastCalls = [];
    const mgr = new SttManager(makeStore([fakeSession]), fakeDb);
    mgr.setDeliveryHelpers({
      getTranslationVendorConfig: () => ({ vendor: 'mymemory' }),
      getTranslationTargets: () => ([{ id: 'tt1', enabled: true, lang: 'fi-FI', target: 'captions' }]),
      broadcastToViewers: (viewerKey, data) => broadcastCalls.push({ viewerKey, data }),
    });

    await mgr.start('mykey', { provider: 'google', language: 'en-US' });
    const sttSession = mgr._sessions.get('mykey');
    sttSession.adapter.emit('transcript', { text: 'Hello world', confidence: 0.95, timestamp: new Date() });

    await new Promise(r => setTimeout(r, 50));

    assert.equal(broadcastCalls.length, 1);
    assert.equal(broadcastCalls[0].viewerKey, 'test-viewer');
    assert.deepEqual(broadcastCalls[0].data.translations, { 'fi-FI': 'Hei maailma' });

    await mgr.stop('mykey');
  });

  test('setDeliveryHelpers: no-op (default composed text, no translations) when helpers are never injected', async () => {
    // Same-language shortcut and the "helpers not injected" path must not throw
    // and must not attempt any translation — this is the pre-Phase-5 default
    // behavior for any caller (e.g. tests, or a future consumer) that never
    // calls setDeliveryHelpers().
    const fakeSession = {
      apiKey:       'mykey2',
      domain:       'test.local',
      sequence:     0,
      extraTargets: [{ id: 'vt1', type: 'viewer', viewerKey: 'test-viewer-2' }],
      sender:       null,
      _sendQueue:   Promise.resolve(),
    };

    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const mgr = new SttManager(makeStore([fakeSession]), { prepare: () => ({ get: () => null }) });
    // Deliberately do NOT call setDeliveryHelpers().

    await mgr.start('mykey2', { provider: 'google', language: 'en-US' });
    const sttSession = mgr._sessions.get('mykey2');

    // Should not throw even though broadcastToViewers was never injected.
    sttSession.adapter.emit('transcript', { text: 'No translation configured', confidence: 0.9, timestamp: new Date() });
    await new Promise(r => setTimeout(r, 30));

    assert.equal(fakeSession.sequence, 1);
    await mgr.stop('mykey2');
  });
});
