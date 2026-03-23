/**
 * WhisperHttpAdapter unit tests.
 * Mocks fetch so no real whisper.cpp server is required.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WhisperHttpAdapter } from '../src/stt-adapters/whisper-http.js';

const FAKE_URL = 'http://localhost:8080';

describe('WhisperHttpAdapter', () => {
  let originalFetch;
  let originalEnvUrl;

  let OriginalFormData;

  beforeEach(() => {
    originalFetch  = globalThis.fetch;
    originalEnvUrl = process.env.WHISPER_HTTP_URL;
    process.env.WHISPER_HTTP_URL = FAKE_URL;
    // Always install a spy FormData so we can inspect fields
    OriginalFormData = globalThis.FormData;
    globalThis.FormData = class {
      constructor() { this._entries = []; }
      append(k, v) { this._entries.push([k, v]); }
    };
    if (!globalThis.Blob) {
      globalThis.Blob = class {
        constructor(parts) { this.size = parts.reduce((s, p) => s + (p?.length ?? 0), 0); }
      };
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.FormData = OriginalFormData;
    if (originalEnvUrl === undefined) {
      delete process.env.WHISPER_HTTP_URL;
    } else {
      process.env.WHISPER_HTTP_URL = originalEnvUrl;
    }
  });

  test('throws if WHISPER_HTTP_URL is not set', async () => {
    delete process.env.WHISPER_HTTP_URL;
    const adapter = new WhisperHttpAdapter({ serverUrl: '' });
    await assert.rejects(() => adapter.start(), /WHISPER_HTTP_URL/i);
  });

  test('accepts serverUrl constructor option overriding env var', async () => {
    delete process.env.WHISPER_HTTP_URL;
    const adapter = new WhisperHttpAdapter({ serverUrl: FAKE_URL });
    // should not throw
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, json: async () => ({ text: 'hello' }) };
    };
    await adapter.start();
    await adapter.sendSegment(Buffer.from('fake'), { timestamp: new Date(), duration: 6 });
    assert.ok(called);
  });

  test('emits transcript event on successful response', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en-US' });
    await adapter.start();

    globalThis.fetch = async () => ({
      ok:   true,
      json: async () => ({ text: 'test transcript text', language: 'en' }),
    });

    let received = null;
    adapter.on('transcript', data => { received = data; });

    await adapter.sendSegment(Buffer.from('fake'), { timestamp: new Date(), duration: 6 });

    assert.ok(received);
    assert.strictEqual(received.text, 'test transcript text');
    assert.strictEqual(received.confidence, null);
    assert.ok(received.timestamp instanceof Date);
  });

  test('uses short ISO 639-1 code for language field', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'fi-FI' });
    await adapter.start();

    let capturedForm = null;
    globalThis.fetch = async (url, opts) => {
      capturedForm = opts.body;
      return { ok: true, json: async () => ({ text: 'moi' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    // FormData stub records entries
    const langEntry = capturedForm._entries.find(([k]) => k === 'language');
    assert.ok(langEntry, 'language field should be appended to FormData');
    assert.strictEqual(langEntry[1], 'fi');
  });

  test('appends model field when WHISPER_HTTP_MODEL is set', async () => {
    const origModel = process.env.WHISPER_HTTP_MODEL;
    process.env.WHISPER_HTTP_MODEL = 'ggml-base.en';
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();

    let capturedForm = null;
    globalThis.fetch = async (url, opts) => {
      capturedForm = opts.body;
      return { ok: true, json: async () => ({ text: 'hello' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    const modelEntry = capturedForm._entries.find(([k]) => k === 'model');
    assert.ok(modelEntry, 'model field should be present');
    assert.strictEqual(modelEntry[1], 'ggml-base.en');

    if (origModel === undefined) delete process.env.WHISPER_HTTP_MODEL;
    else process.env.WHISPER_HTTP_MODEL = origModel;
  });

  test('emits error on HTTP error response', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => ({
      ok:     false,
      status: 500,
      text:   async () => 'Internal Server Error',
    });

    let err = null;
    adapter.on('error', data => { err = data.error; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.ok(err instanceof Error);
    assert.match(err.message, /500/);
  });

  test('emits error on network failure', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

    let err = null;
    adapter.on('error', data => { err = data.error; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.ok(err instanceof Error);
    assert.match(err.message, /ECONNREFUSED/);
  });

  test('emits error on invalid JSON response', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => ({
      ok:   true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    let err = null;
    adapter.on('error', data => { err = data.error; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.ok(err instanceof Error);
    assert.match(err.message, /invalid JSON/i);
  });

  test('skips empty segments without calling fetch', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();

    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };

    await adapter.sendSegment(Buffer.alloc(0), { timestamp: new Date(), duration: 0 });

    assert.ok(!called, 'fetch should not be called for empty segments');
  });

  test('does not emit transcript when response text is blank', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ text: '   ' }) });

    let received = null;
    adapter.on('transcript', data => { received = data; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.strictEqual(received, null);
  });

  test('stop() is a no-op that resolves', async () => {
    const adapter = new WhisperHttpAdapter({ language: 'en' });
    await adapter.start();
    await assert.doesNotReject(() => adapter.stop());
  });

  test('trailing slash stripped from serverUrl', async () => {
    let calledUrl = '';
    globalThis.fetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ text: 'hello' }) };
    };
    const adapter = new WhisperHttpAdapter({ serverUrl: `${FAKE_URL}/` });
    await adapter.start();
    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });
    assert.ok(calledUrl.endsWith('/inference'), `expected URL to end with /inference, got ${calledUrl}`);
    assert.ok(!calledUrl.includes('//inference'), 'should not have double slash');
  });
});
