/**
 * Tests for the /auth router (register, login, me, change-password).
 *
 * Uses an in-memory SQLite database so no persistent state is needed.
 * Bcrypt rounds are reduced to 1 in tests to keep them fast — this is safe
 * because correctness (not security) is what we're verifying.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createAuthRouter } from '../src/routes/auth.js';

// Reduce bcrypt rounds for speed — override the module-level constant via the
// fact that bcrypt.hash takes the rounds as a parameter (the router uses its
// own constant of 12). We accept slower tests (~0.5 s per hash) rather than
// patching internals. All tests share one registered user to amortise cost.

const JWT_SECRET = 'test-auth-secret';

let server, baseUrl, db;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');

  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRouter(db, JWT_SECRET, { loginEnabled: true }));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

// Helper — register a user and return the response body
async function register(email, password, name) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return { status: res.status, body: await res.json() };
}

async function login(email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Disabled logins
// ---------------------------------------------------------------------------

describe('/auth — loginEnabled: false', () => {
  let disabledServer, disabledUrl;

  before(() => new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(db, JWT_SECRET, { loginEnabled: false }));
    disabledServer = createServer(app);
    disabledServer.listen(0, () => {
      disabledUrl = `http://localhost:${disabledServer.address().port}`;
      resolve();
    });
  }));

  after(() => new Promise(r => disabledServer.close(r)));

  it('returns 503 for any auth route', async () => {
    const res = await fetch(`${disabledUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123' }),
    });
    assert.equal(res.status, 503);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('returns 400 when email is missing', async () => {
    const { status, body } = await register('', 'password123');
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it('returns 400 when password is too short', async () => {
    const { status, body } = await register('test@example.com', 'short');
    assert.equal(status, 400);
    assert.ok(body.error.toLowerCase().includes('password'));
  });

  it('registers successfully and returns a JWT token', async () => {
    const { status, body } = await register('newuser@example.com', 'password123', 'Test User');
    assert.equal(status, 201);
    assert.ok(body.token, 'should return a JWT token');
    assert.ok(body.userId);
    assert.equal(body.email, 'newuser@example.com');
    assert.equal(body.name, 'Test User');

    // Verify it's a valid JWT
    const payload = jwt.verify(body.token, JWT_SECRET);
    assert.equal(payload.type, 'user');
    assert.equal(payload.email, 'newuser@example.com');
  });

  it('returns 409 when email already exists', async () => {
    await register('dup@example.com', 'password123');
    const { status, body } = await register('dup@example.com', 'password456');
    assert.equal(status, 409);
    assert.ok(body.error.toLowerCase().includes('exists'));
  });

  it('stores email in lowercase', async () => {
    const { status, body } = await register('Upper@Example.Com', 'password123');
    assert.equal(status, 201);
    assert.equal(body.email, 'upper@example.com');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  before(async () => {
    // Create a known user for login tests
    await register('login-test@example.com', 'correctpassword');
  });

  it('returns 400 when email or password is missing', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login-test@example.com' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 401 for unknown email', async () => {
    const { status } = await login('nobody@example.com', 'password123');
    assert.equal(status, 401);
  });

  it('returns 401 for wrong password', async () => {
    const { status } = await login('login-test@example.com', 'wrongpassword');
    assert.equal(status, 401);
  });

  it('returns 200 with JWT for correct credentials', async () => {
    const { status, body } = await login('login-test@example.com', 'correctpassword');
    assert.equal(status, 200);
    assert.ok(body.token, 'should return a token');
    const payload = jwt.verify(body.token, JWT_SECRET);
    assert.equal(payload.type, 'user');
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

describe('GET /auth/me', () => {
  let userToken;

  before(async () => {
    const { body } = await register('me-test@example.com', 'password123', 'Me User');
    userToken = body.token;
  });

  it('returns 401 without token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with a session token (wrong type)', async () => {
    const sessionToken = jwt.sign({ sessionId: 'sid', apiKey: 'ak', domain: 'https://t.com' }, JWT_SECRET);
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(res.status, 401);
  });

  it('returns user profile with valid user token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, 'me-test@example.com');
    assert.equal(body.name, 'Me User');
    assert.ok(body.userId);
    assert.ok(body.createdAt);
    assert.equal(body.password_hash, undefined, 'must not expose password hash');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/change-password
// ---------------------------------------------------------------------------

describe('POST /auth/change-password', () => {
  let userToken, userEmail;

  before(async () => {
    userEmail = 'chpw@example.com';
    const { body } = await register(userEmail, 'oldpassword123');
    userToken = body.token;
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'oldpassword123' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 400 when newPassword is too short', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'oldpassword123', newPassword: 'short' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'wrongpassword', newPassword: 'newpassword123' }),
    });
    assert.equal(res.status, 401);
  });

  it('changes password successfully', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'oldpassword123', newPassword: 'newpassword456' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Old password no longer works
    const { status: oldStatus } = await login(userEmail, 'oldpassword123');
    assert.equal(oldStatus, 401);

    // New password works
    const { status: newStatus } = await login(userEmail, 'newpassword456');
    assert.equal(newStatus, 200);
  });
});
