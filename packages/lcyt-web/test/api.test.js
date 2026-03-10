/**
 * Unit tests for the authenticated API helper in src/lib/api.js.
 *
 * Run with:
 *   node --test test/api.test.js
 * or:
 *   npm test -w packages/lcyt-web
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSenderRef(token) {
  return { current: token ? { _token: token } : null };
}

function makeBackendUrlRef(url) {
  return { current: url };
}

// Minimal fetch stub — replaces globalThis.fetch for the duration of a test.
function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

// ---------------------------------------------------------------------------
// createApi
// ---------------------------------------------------------------------------

describe('createApi', () => {
  let senderRef;
  let backendUrlRef;
  let api;

  beforeEach(() => {
    senderRef = makeSenderRef('test-token-abc');
    backendUrlRef = makeBackendUrlRef('https://api.example.com');
    api = createApi(senderRef, backendUrlRef);
  });

  it('get() sends a GET request with Authorization header', async () => {
    const restore = stubFetch(async (url, opts) => {
      assert.equal(url, 'https://api.example.com/stats');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.headers.Authorization, 'Bearer test-token-abc');
      return { ok: true, json: async () => ({ data: 'ok' }) };
    });
    try {
      const result = await api.get('/stats');
      assert.deepEqual(result, { data: 'ok' });
    } finally {
      restore();
    }
  });

  it('post() sends a POST request with JSON body', async () => {
    const restore = stubFetch(async (url, opts) => {
      assert.equal(url, 'https://api.example.com/icons');
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers['Content-Type'], 'application/json');
      assert.equal(opts.body, JSON.stringify({ filename: 'icon.png' }));
      return { ok: true, json: async () => ({ id: 1 }) };
    });
    try {
      const result = await api.post('/icons', { filename: 'icon.png' });
      assert.deepEqual(result, { id: 1 });
    } finally {
      restore();
    }
  });

  it('put() sends a PUT request', async () => {
    const restore = stubFetch(async (url, opts) => {
      assert.equal(opts.method, 'PUT');
      return { ok: true, json: async () => ({ ok: true }) };
    });
    try {
      const result = await api.put('/stream/1', { targetUrl: 'rtmp://x' });
      assert.deepEqual(result, { ok: true });
    } finally {
      restore();
    }
  });

  it('del() sends a DELETE request', async () => {
    const restore = stubFetch(async (url, opts) => {
      assert.equal(url, 'https://api.example.com/file/42');
      assert.equal(opts.method, 'DELETE');
      return { ok: true, json: async () => ({ ok: true }) };
    });
    try {
      const result = await api.del('/file/42');
      assert.deepEqual(result, { ok: true });
    } finally {
      restore();
    }
  });

  it('throws "Not connected" when no token is available', async () => {
    senderRef.current = null;
    await assert.rejects(() => api.get('/stats'), { message: 'Not connected' });
  });

  it('throws on non-ok response (get)', async () => {
    const restore = stubFetch(async () => ({
      ok: false, status: 500,
      json: async () => ({}),
    }));
    try {
      await assert.rejects(() => api.get('/stats'), /Request failed \(500\)/);
    } finally {
      restore();
    }
  });

  it('throws with server error message on non-ok response (post, parseErrorBody)', async () => {
    const restore = stubFetch(async () => ({
      ok: false, status: 403,
      json: async () => ({ error: 'Forbidden by server' }),
    }));
    try {
      await assert.rejects(() => api.post('/stream', {}), { message: 'Forbidden by server' });
    } finally {
      restore();
    }
  });

  it('del() with parseErrorBody uses server error message', async () => {
    const restore = stubFetch(async () => ({
      ok: false, status: 404,
      json: async () => ({ error: 'Slot not found' }),
    }));
    try {
      await assert.rejects(
        () => api.del('/stream/9', { parseErrorBody: true }),
        { message: 'Slot not found' },
      );
    } finally {
      restore();
    }
  });
});
