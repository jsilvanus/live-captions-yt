/**
 * Tests for GET /youtube/config
 *
 * Verifies that the route returns the YOUTUBE_CLIENT_ID env var when configured
 * and 503 when it is not set.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createYouTubeRouter } from '../src/routes/youtube.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-youtube-secret';

let server, baseUrl;

before(() => new Promise((resolve) => {
  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use('/youtube', createYouTubeRouter(auth));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(r => server.close(r)));

// Helper: make a valid token (session token format)
function makeToken() {
  return jwt.sign(
    { sessionId: 'sess-001', apiKey: 'test-key', domain: 'https://test.com' },
    JWT_SECRET,
  );
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('GET /youtube/config — authentication', () => {
  it('returns 401 without a token', async () => {
    const res = await fetch(`${baseUrl}/youtube/config`);
    assert.equal(res.status, 401);
  });

  it('returns 401 for an invalid token', async () => {
    const res = await fetch(`${baseUrl}/youtube/config`, {
      headers: { Authorization: 'Bearer bad.token.here' },
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// With YOUTUBE_CLIENT_ID not set
// ---------------------------------------------------------------------------

describe('GET /youtube/config — client ID not configured', () => {
  beforeEach(() => { delete process.env.YOUTUBE_CLIENT_ID; });

  it('returns 503 when YOUTUBE_CLIENT_ID is not set', async () => {
    const token = makeToken();
    const res = await fetch(`${baseUrl}/youtube/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.ok(body.error);
  });
});

// ---------------------------------------------------------------------------
// With YOUTUBE_CLIENT_ID set
// ---------------------------------------------------------------------------

describe('GET /youtube/config — client ID configured', () => {
  beforeEach(() => { process.env.YOUTUBE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'; });
  after(() => { delete process.env.YOUTUBE_CLIENT_ID; });

  it('returns 200 with clientId', async () => {
    const token = makeToken();
    const res = await fetch(`${baseUrl}/youtube/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'test-client-id.apps.googleusercontent.com');
  });
});
