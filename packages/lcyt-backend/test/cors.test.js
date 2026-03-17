/**
 * Unit tests for createCorsMiddleware.
 *
 * Uses lightweight mock req/res/next objects — no HTTP server needed.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCorsMiddleware } from '../src/middleware/cors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq({ method = 'GET', path = '/', origin = null, query = {} } = {}) {
  return { method, path, headers: origin ? { origin } : {}, query };
}

function makeRes() {
  const headers = {};
  let statusCode = null;
  return {
    headers,
    statusCode,
    setHeader(k, v) { headers[k] = v; },
    sendStatus(code) { this.statusCode = code; },
  };
}

function makeStore(matchingDomains = []) {
  return {
    getByDomain(origin) {
      return matchingDomains.includes(origin) ? [{ id: 1 }] : [];
    },
  };
}

// ---------------------------------------------------------------------------
// Admin routes (/keys)
// ---------------------------------------------------------------------------

describe('cors — /keys admin routes', () => {
  it('returns 204 for OPTIONS /keys', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'OPTIONS', path: '/keys', origin: 'https://evil.example' });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 204);
    assert.equal(nextCalled, false);
  });

  it('does NOT set CORS headers for GET /keys', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'GET', path: '/keys', origin: 'https://any.example' });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(nextCalled, true);
  });

  it('does NOT set CORS headers for DELETE /keys/123', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'DELETE', path: '/keys/abc123', origin: 'https://any.example' });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(nextCalled, true);
  });
});

// ---------------------------------------------------------------------------
// Free-tier signup: POST /keys?freetier
// ---------------------------------------------------------------------------

describe('cors — free-tier signup POST /keys?freetier', () => {
  it('sets CORS headers for any origin on POST /keys?freetier', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'POST', path: '/keys', origin: 'https://stranger.example', query: { freetier: '' } });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://stranger.example');
    assert.equal(nextCalled, true);
  });

  it('still calls next() for freetier even without origin header', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'POST', path: '/keys', query: { freetier: '' } });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    // No origin header → no CORS header set
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  });
});

// ---------------------------------------------------------------------------
// Permissive routes (POST /live, GET /health, GET /contact, OPTIONS *)
// ---------------------------------------------------------------------------

describe('cors — permissive routes', () => {
  it('sets ACAO for POST /live with any origin', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'POST', path: '/live', origin: 'https://client.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://client.example');
  });

  it('sets ACAO for GET /health', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'GET', path: '/health', origin: 'https://monitor.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://monitor.example');
  });

  it('sets ACAO for GET /contact', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'GET', path: '/contact', origin: 'https://site.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://site.example');
  });

  it('returns 204 for OPTIONS requests with origin', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'OPTIONS', path: '/captions', origin: 'https://client.example' });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://client.example');
    assert.equal(nextCalled, false);
  });

  it('sets Allow-Credentials on permissive routes', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'POST', path: '/live', origin: 'https://client.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Credentials'], 'true');
  });

  it('does NOT set ACAO when there is no origin header', () => {
    const mw = createCorsMiddleware(makeStore());
    const req = makeReq({ method: 'POST', path: '/live' }); // no origin
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  });
});

// ---------------------------------------------------------------------------
// Dynamic origin matching (authenticated routes)
// ---------------------------------------------------------------------------

describe('cors — dynamic origin matching', () => {
  it('sets ACAO when origin matches a registered session domain', () => {
    const mw = createCorsMiddleware(makeStore(['https://registered.example']));
    const req = makeReq({ method: 'GET', path: '/captions', origin: 'https://registered.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://registered.example');
  });

  it('does NOT set ACAO when origin is NOT registered', () => {
    const mw = createCorsMiddleware(makeStore(['https://registered.example']));
    const req = makeReq({ method: 'GET', path: '/captions', origin: 'https://unknown.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  });

  it('calls next() even when origin is unregistered', () => {
    const mw = createCorsMiddleware(makeStore([]));
    const req = makeReq({ method: 'GET', path: '/captions', origin: 'https://unknown.example' });
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  it('returns 204 for OPTIONS even when origin is unregistered', () => {
    const mw = createCorsMiddleware(makeStore([]));
    const req = makeReq({ method: 'OPTIONS', path: '/captions', origin: 'https://unknown.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.statusCode, 204);
  });

  it('sets Allow-Credentials for registered origins', () => {
    const mw = createCorsMiddleware(makeStore(['https://registered.example']));
    const req = makeReq({ method: 'GET', path: '/events', origin: 'https://registered.example' });
    const res = makeRes();
    mw(req, res, () => {});
    assert.equal(res.headers['Access-Control-Allow-Credentials'], 'true');
  });

  it('calls next() for requests with no origin header', () => {
    const mw = createCorsMiddleware(makeStore([]));
    const req = makeReq({ method: 'GET', path: '/captions' }); // server-side request
    const res = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});
