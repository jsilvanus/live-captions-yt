/**
 * Unit tests for DSK editor auth middleware.
 *
 * Tests createEditorAuth(db) and editorAuthOrBearer(jwtAuth, editorAuth).
 * Uses lightweight mock req/res/next objects — no HTTP server needed.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createEditorAuth, editorAuthOrBearer } from '../src/middleware/editor-auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1)');
  return db;
}

function makeReq(headers = {}) {
  return { headers, session: undefined };
}

function makeRes() {
  let code = null;
  let body = null;
  return {
    get statusCode() { return code; },
    status(c) { code = c; return this; },
    json(b) { body = b; return this; },
    get body() { return body; },
  };
}

// ---------------------------------------------------------------------------
// createEditorAuth
// ---------------------------------------------------------------------------

describe('createEditorAuth', () => {
  it('no x-api-key header calls next() and does not set req.session', () => {
    const db = makeDb();
    const auth = createEditorAuth(db);
    const req = makeReq({});
    const res = makeRes();
    let called = false;
    auth(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.session, undefined);
  });

  it('valid active key sets req.session and calls next()', () => {
    const db = makeDb();
    db.prepare('INSERT INTO api_keys (key, active) VALUES (?, 1)').run('mykey');
    const auth = createEditorAuth(db);
    const req = makeReq({ 'x-api-key': 'mykey' });
    const res = makeRes();
    let called = false;
    auth(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.deepEqual(req.session, { apiKey: 'mykey' });
  });

  it('unknown key returns 401', () => {
    const db = makeDb();
    const auth = createEditorAuth(db);
    const req = makeReq({ 'x-api-key': 'no-such-key' });
    const res = makeRes();
    let called = false;
    auth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /invalid or inactive/i);
  });

  it('inactive key (active = 0) returns 401', () => {
    const db = makeDb();
    db.prepare('INSERT INTO api_keys (key, active) VALUES (?, 0)').run('inactivekey');
    const auth = createEditorAuth(db);
    const req = makeReq({ 'x-api-key': 'inactivekey' });
    const res = makeRes();
    let called = false;
    auth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  });

  it('key with active = 2 (not exactly 1) returns 401', () => {
    const db = makeDb();
    db.prepare('INSERT INTO api_keys (key, active) VALUES (?, 2)').run('weirdkey');
    const auth = createEditorAuth(db);
    const req = makeReq({ 'x-api-key': 'weirdkey' });
    const res = makeRes();
    let called = false;
    auth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// editorAuthOrBearer
// ---------------------------------------------------------------------------

describe('editorAuthOrBearer', () => {
  it('delegates to editorAuth when x-api-key header is present', () => {
    const db = makeDb();
    db.prepare('INSERT INTO api_keys (key, active) VALUES (?, 1)').run('mykey');
    const editorAuth = createEditorAuth(db);

    let jwtCalled = false;
    const jwtAuth = (_req, _res, next) => { jwtCalled = true; next(); };

    const combined = editorAuthOrBearer(jwtAuth, editorAuth);
    const req = makeReq({ 'x-api-key': 'mykey' });
    const res = makeRes();
    let nextCalled = false;
    combined(req, res, () => { nextCalled = true; });

    assert.equal(jwtCalled, false, 'jwtAuth must not be called');
    assert.equal(nextCalled, true);
    assert.deepEqual(req.session, { apiKey: 'mykey' });
  });

  it('delegates to jwtAuth when x-api-key header is absent', () => {
    const db = makeDb();
    const editorAuth = createEditorAuth(db);

    let jwtCalled = false;
    const jwtAuth = (req, _res, next) => {
      jwtCalled = true;
      req.session = { apiKey: 'jwt-key' };
      next();
    };

    const combined = editorAuthOrBearer(jwtAuth, editorAuth);
    const req = makeReq({}); // no x-api-key
    const res = makeRes();
    let nextCalled = false;
    combined(req, res, () => { nextCalled = true; });

    assert.equal(jwtCalled, true);
    assert.equal(nextCalled, true);
    assert.deepEqual(req.session, { apiKey: 'jwt-key' });
  });

  it('returns 401 from editorAuth when x-api-key is invalid (jwtAuth not called)', () => {
    const db = makeDb();
    const editorAuth = createEditorAuth(db);

    let jwtCalled = false;
    const jwtAuth = (_req, _res, next) => { jwtCalled = true; next(); };

    const combined = editorAuthOrBearer(jwtAuth, editorAuth);
    const req = makeReq({ 'x-api-key': 'bad-key' });
    const res = makeRes();
    let nextCalled = false;
    combined(req, res, () => { nextCalled = true; });

    assert.equal(jwtCalled, false);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('jwtAuth failing still does not call editorAuth', () => {
    const db = makeDb();
    const editorAuth = createEditorAuth(db);

    let editorCalled = false;
    const wrappedEditor = (req, res, next) => { editorCalled = true; editorAuth(req, res, next); };

    const jwtAuth = (_req, res, _next) => { res.status(401).json({ error: 'no token' }); };

    const combined = editorAuthOrBearer(jwtAuth, wrappedEditor);
    const req = makeReq({}); // no x-api-key header
    const res = makeRes();
    combined(req, res, () => {});

    assert.equal(editorCalled, false);
    assert.equal(res.statusCode, 401);
  });
});
