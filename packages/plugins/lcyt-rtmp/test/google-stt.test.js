/**
 * GoogleSttAdapter unit tests.
 * Mocks fetch and GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_STT_KEY so no real
 * API calls are made.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSttAdapter } from '../src/stt-adapters/google-stt.js';

function makeSttResponse({ transcript = 'hello world', confidence = 0.95 } = {}) {
  return {
    results: [{
      alternatives: [{ transcript, confidence }],
    }],
  };
}

describe('GoogleSttAdapter', () => {
  let originalFetch;
  let originalApiKey;

  beforeEach(() => {
    originalFetch  = globalThis.fetch;
    originalApiKey = process.env.GOOGLE_STT_KEY;
    process.env.GOOGLE_STT_KEY = 'test-api-key-xyz';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_STT_KEY;
    } else {
      process.env.GOOGLE_STT_KEY = originalApiKey;
    }
  });

  test('throws if no credentials configured', async () => {
    delete process.env.GOOGLE_STT_KEY;
    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await assert.rejects(() => adapter.start(), /no credentials/i);
  });

  test('emits transcript event on successful API response', async () => {
    const responseData = makeSttResponse({ transcript: 'Hello, world!', confidence: 0.98 });

    globalThis.fetch = async (url, opts) => ({
      ok:   true,
      status: 200,
      json: async () => responseData,
    });

    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await adapter.start();

    const transcripts = [];
    adapter.on('transcript', t => transcripts.push(t));

    const ts = new Date('2026-03-01T12:00:00.000Z');
    await adapter.sendSegment(Buffer.from('fakemp4data'), { timestamp: ts, duration: 6 });

    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].text, 'Hello, world!');
    assert.equal(transcripts[0].confidence, 0.98);
    assert.equal(transcripts[0].timestamp, ts);
  });

  test('uses GOOGLE_STT_KEY as query parameter', async () => {
    let capturedUrl;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => makeSttResponse() };
    };

    const adapter = new GoogleSttAdapter({ language: 'fi-FI' });
    await adapter.start();
    await adapter.sendSegment(Buffer.from('data'), { timestamp: new Date(), duration: 6 });

    assert.ok(capturedUrl.includes('key=test-api-key-xyz'));
  });

  test('emits error on non-OK API response', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => 'Permission denied',
    });

    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await adapter.start();

    const errors = [];
    adapter.on('error', e => errors.push(e));

    await adapter.sendSegment(Buffer.from('data'), { timestamp: new Date(), duration: 6 });

    assert.equal(errors.length, 1);
    assert.ok(errors[0].error.message.includes('403'));
  });

  test('skips empty buffer without calling fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };

    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await adapter.start();

    await adapter.sendSegment(Buffer.alloc(0), { timestamp: new Date(), duration: 6 });

    assert.equal(fetchCalled, false);
  });

  test('emits no transcript for empty results array', async () => {
    globalThis.fetch = async () => ({
      ok:   true,
      status: 200,
      json: async () => ({ results: [] }),
    });

    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await adapter.start();

    const transcripts = [];
    adapter.on('transcript', t => transcripts.push(t));

    await adapter.sendSegment(Buffer.from('data'), { timestamp: new Date(), duration: 6 });

    assert.equal(transcripts.length, 0);
  });

  test('skips result with empty transcript string', async () => {
    globalThis.fetch = async () => ({
      ok:   true,
      status: 200,
      json: async () => ({ results: [{ alternatives: [{ transcript: '   ', confidence: 0.5 }] }] }),
    });

    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await adapter.start();

    const transcripts = [];
    adapter.on('transcript', t => transcripts.push(t));

    await adapter.sendSegment(Buffer.from('data'), { timestamp: new Date(), duration: 6 });

    assert.equal(transcripts.length, 0);
  });

  test('stop() resolves without error', async () => {
    const adapter = new GoogleSttAdapter({ language: 'en-US' });
    await adapter.start();
    await assert.doesNotReject(() => adapter.stop());
  });
});
