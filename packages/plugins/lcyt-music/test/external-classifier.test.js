/**
 * classifyExternal() unit tests (Phase 4).
 *
 * Stubs globalThis.fetch directly — no network involved. Mirrors the
 * fetch-stubbing pattern used in test/music-manager.test.js.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExternal, CLASSIFIER_TIMEOUT_MS } from '../src/analyser/external-classifier.js';

function makePcm(length = 256) {
  const pcm = new Float32Array(length);
  for (let i = 0; i < length; i++) pcm[i] = Math.sin(i * 0.1) * 0.5;
  return pcm;
}

describe('classifyExternal', () => {
  let originalFetch;
  let originalUrl;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalUrl = process.env.MUSIC_CLASSIFIER_URL;
    process.env.MUSIC_CLASSIFIER_URL = 'http://classifier.example.test/classify';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MUSIC_CLASSIFIER_URL;
    else process.env.MUSIC_CLASSIFIER_URL = originalUrl;
  });

  test('throws when MUSIC_CLASSIFIER_URL is not set', async () => {
    delete process.env.MUSIC_CLASSIFIER_URL;
    await assert.rejects(() => classifyExternal(makePcm()), /MUSIC_CLASSIFIER_URL is not set/);
  });

  test('posts a WAV body and returns { label, confidence } on success', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ label: 'music', confidence: 0.87 }),
      };
    };

    const result = await classifyExternal(makePcm(), { sampleRate: 22050 });
    assert.deepEqual(result, { label: 'music', confidence: 0.87 });

    assert.equal(captured.url, 'http://classifier.example.test/classify');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers['Content-Type'], 'audio/wav');
    assert.ok(Buffer.isBuffer(captured.opts.body) || captured.opts.body instanceof Uint8Array);
    // 44-byte RIFF/WAV header + 2 bytes per sample.
    assert.equal(captured.opts.body.length, 44 + makePcm().length * 2);
  });

  test('defaults confidence to null when the response omits it', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ label: 'speech' }),
    });
    const result = await classifyExternal(makePcm());
    assert.deepEqual(result, { label: 'speech', confidence: null });
  });

  test('throws when the response is not ok', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => classifyExternal(makePcm()), /503/);
  });

  test('throws when the response body is missing a string label', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await assert.rejects(() => classifyExternal(makePcm()), /missing label/);
  });

  test('propagates an abort/timeout error from fetch', async () => {
    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
    await assert.rejects(() => classifyExternal(makePcm(), { timeoutMs: 10 }), /aborted/);
  });

  test('uses the default CLASSIFIER_TIMEOUT_MS when no override is given', async () => {
    assert.equal(CLASSIFIER_TIMEOUT_MS, 3000);
  });
});
