/**
 * OpenAiAdapter unit tests.
 * Mocks fetch so no real OpenAI-compatible endpoint is required.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiAdapter } from '../src/stt-adapters/openai.js';

const FAKE_URL    = 'http://localhost:8080';
const FAKE_APIKEY = 'sk-test-1234';

describe('OpenAiAdapter', () => {
  let originalFetch;
  let originalEnvUrl;
  let originalEnvKey;
  let OriginalFormData;

  beforeEach(() => {
    originalFetch  = globalThis.fetch;
    originalEnvUrl = process.env.OPENAI_STT_URL;
    originalEnvKey = process.env.OPENAI_STT_API_KEY;
    process.env.OPENAI_STT_URL     = FAKE_URL;
    process.env.OPENAI_STT_API_KEY = FAKE_APIKEY;

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
    if (originalEnvUrl === undefined) delete process.env.OPENAI_STT_URL;
    else process.env.OPENAI_STT_URL = originalEnvUrl;
    if (originalEnvKey === undefined) delete process.env.OPENAI_STT_API_KEY;
    else process.env.OPENAI_STT_API_KEY = originalEnvKey;
  });

  test('throws if OPENAI_STT_API_KEY is not set', async () => {
    delete process.env.OPENAI_STT_API_KEY;
    const adapter = new OpenAiAdapter({ baseUrl: FAKE_URL });
    await assert.rejects(() => adapter.start(), /OPENAI_STT_API_KEY/i);
  });

  test('accepts apiKey constructor option overriding env var', async () => {
    delete process.env.OPENAI_STT_API_KEY;
    const adapter = new OpenAiAdapter({ baseUrl: FAKE_URL, apiKey: 'override-key' });
    // Should not throw
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({ text: 'hi' }) }; };
    await adapter.start();
    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });
    assert.ok(called);
  });

  test('emits transcript event on successful response', async () => {
    const adapter = new OpenAiAdapter({ language: 'en-US' });
    await adapter.start();

    globalThis.fetch = async () => ({
      ok:   true,
      json: async () => ({ text: 'Hello from OpenAI' }),
    });

    let received = null;
    adapter.on('transcript', data => { received = data; });

    await adapter.sendSegment(Buffer.from('fake'), { timestamp: new Date(), duration: 6 });

    assert.ok(received);
    assert.strictEqual(received.text, 'Hello from OpenAI');
    assert.strictEqual(received.confidence, null);
    assert.ok(received.timestamp instanceof Date);
  });

  test('sends Authorization: Bearer header', async () => {
    const adapter = new OpenAiAdapter({ language: 'en', apiKey: 'my-secret-key' });
    await adapter.start();

    let capturedHeaders = null;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, json: async () => ({ text: 'test' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.strictEqual(capturedHeaders?.Authorization, 'Bearer my-secret-key');
  });

  test('sends model field in FormData', async () => {
    const origModel = process.env.OPENAI_STT_MODEL;
    process.env.OPENAI_STT_MODEL = 'whisper-1';
    const adapter = new OpenAiAdapter({ language: 'en' });
    await adapter.start();

    let capturedForm = null;
    globalThis.fetch = async (url, opts) => {
      capturedForm = opts.body;
      return { ok: true, json: async () => ({ text: 'hi' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    const modelEntry = capturedForm._entries.find(([k]) => k === 'model');
    assert.ok(modelEntry, 'model field must be present');
    assert.strictEqual(modelEntry[1], 'whisper-1');

    if (origModel === undefined) delete process.env.OPENAI_STT_MODEL;
    else process.env.OPENAI_STT_MODEL = origModel;
  });

  test('uses short ISO 639-1 code for language field', async () => {
    const adapter = new OpenAiAdapter({ language: 'sv-SE' });
    await adapter.start();

    let capturedForm = null;
    globalThis.fetch = async (url, opts) => {
      capturedForm = opts.body;
      return { ok: true, json: async () => ({ text: 'hej' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    const langEntry = capturedForm._entries.find(([k]) => k === 'language');
    assert.ok(langEntry, 'language field should be in FormData');
    assert.strictEqual(langEntry[1], 'sv');
  });

  test('POSTs to /v1/audio/transcriptions', async () => {
    const adapter = new OpenAiAdapter({ language: 'en', baseUrl: 'http://my-server:9000' });
    await adapter.start();

    let calledUrl = '';
    globalThis.fetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ text: 'ok' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.strictEqual(calledUrl, 'http://my-server:9000/v1/audio/transcriptions');
  });

  test('emits error on HTTP error response', async () => {
    const adapter = new OpenAiAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => ({
      ok:     false,
      status: 401,
      text:   async () => 'Unauthorized',
    });

    let err = null;
    adapter.on('error', data => { err = data.error; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.ok(err instanceof Error);
    assert.match(err.message, /401/);
  });

  test('emits error on network failure', async () => {
    const adapter = new OpenAiAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

    let err = null;
    adapter.on('error', data => { err = data.error; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.ok(err instanceof Error);
    assert.match(err.message, /ECONNREFUSED/);
  });

  test('emits error on invalid JSON response', async () => {
    const adapter = new OpenAiAdapter({ language: 'en' });
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
    const adapter = new OpenAiAdapter({ language: 'en' });
    await adapter.start();

    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };

    await adapter.sendSegment(Buffer.alloc(0), { timestamp: new Date(), duration: 0 });

    assert.ok(!called, 'fetch should not be called for empty segments');
  });

  test('does not emit transcript when response text is blank', async () => {
    const adapter = new OpenAiAdapter({ language: 'en' });
    await adapter.start();

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ text: '  ' }) });

    let received = null;
    adapter.on('transcript', data => { received = data; });

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    assert.strictEqual(received, null);
  });

  test('stop() is a no-op that resolves', async () => {
    const adapter = new OpenAiAdapter({ language: 'en' });
    await adapter.start();
    await assert.doesNotReject(() => adapter.stop());
  });

  test('trailing slash stripped from baseUrl', async () => {
    let calledUrl = '';
    globalThis.fetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ text: 'hello' }) };
    };
    const adapter = new OpenAiAdapter({ baseUrl: `${FAKE_URL}/`, apiKey: 'k' });
    await adapter.start();
    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });
    assert.ok(!calledUrl.includes('//v1'), `URL should not have double slash: ${calledUrl}`);
    assert.ok(calledUrl.endsWith('/v1/audio/transcriptions'));
  });

  test('uses model constructor option over env var', async () => {
    const origModel = process.env.OPENAI_STT_MODEL;
    process.env.OPENAI_STT_MODEL = 'whisper-1';
    const adapter = new OpenAiAdapter({ language: 'en', model: 'whisper-large-v3' });
    await adapter.start();

    let capturedForm = null;
    globalThis.fetch = async (url, opts) => {
      capturedForm = opts.body;
      return { ok: true, json: async () => ({ text: 'hi' }) };
    };

    await adapter.sendSegment(Buffer.from('x'), { timestamp: new Date(), duration: 6 });

    const modelEntry = capturedForm._entries.find(([k]) => k === 'model');
    assert.strictEqual(modelEntry[1], 'whisper-large-v3');

    if (origModel === undefined) delete process.env.OPENAI_STT_MODEL;
    else process.env.OPENAI_STT_MODEL = origModel;
  });
});
