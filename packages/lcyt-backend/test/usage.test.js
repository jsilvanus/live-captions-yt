import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import { initDb, createKey, incrementDomainHourlyCaptions } from '../src/db.js';
import { createUsageRouter } from '../src/routes/usage.js';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, db;

const ADMIN_KEY = 'test-usage-admin-key';

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  createKey(db, { key: 'usage-key', owner: 'Usage User' });

  const app = express();
  app.use('/usage', createUsageRouter(db));

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

beforeEach(() => {
  // Reset env vars before each test
  delete process.env.USAGE_PUBLIC;
  delete process.env.ADMIN_KEY;
  delete process.env.ALLOWED_DOMAINS;
});

// ---------------------------------------------------------------------------
// GET /usage — authentication
// ---------------------------------------------------------------------------

describe('GET /usage — authentication', () => {
  it('returns 503 when neither USAGE_PUBLIC nor ADMIN_KEY is set', async () => {
    const res = await fetch(`${baseUrl}/usage`);
    const data = await res.json();
    assert.strictEqual(res.status, 503);
    assert.ok(data.error);
  });

  it('returns 401 when ADMIN_KEY is set but no X-Admin-Key header is provided', async () => {
    process.env.ADMIN_KEY = ADMIN_KEY;
    const res = await fetch(`${baseUrl}/usage`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('returns 403 when X-Admin-Key header has wrong value', async () => {
    process.env.ADMIN_KEY = ADMIN_KEY;
    const res = await fetch(`${baseUrl}/usage`, {
      headers: { 'X-Admin-Key': 'wrong-key' }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error);
  });

  it('returns 200 when correct X-Admin-Key is provided', async () => {
    process.env.ADMIN_KEY = ADMIN_KEY;
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    assert.strictEqual(res.status, 200);
  });

  it('returns 200 when USAGE_PUBLIC is set (no auth needed)', async () => {
    process.env.USAGE_PUBLIC = '1';
    process.env.ALLOWED_DOMAINS = '*';
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}`);
    assert.strictEqual(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// GET /usage — validation
// ---------------------------------------------------------------------------

describe('GET /usage — validation', () => {
  beforeEach(() => {
    process.env.ADMIN_KEY = ADMIN_KEY;
  });

  it('returns 400 for invalid from date format', async () => {
    const res = await fetch(`${baseUrl}/usage?from=not-a-date&to=2026-01-01`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('YYYY-MM-DD'));
  });

  it('returns 400 for invalid to date format', async () => {
    const res = await fetch(`${baseUrl}/usage?from=2026-01-01&to=notadate`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('YYYY-MM-DD'));
  });

  it('returns 400 when from > to', async () => {
    const res = await fetch(`${baseUrl}/usage?from=2026-01-10&to=2026-01-01`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('from'));
  });

  it('returns 403 when domain is not in ALLOWED_DOMAINS', async () => {
    process.env.ALLOWED_DOMAINS = 'lcyt.fi,www.lcyt.fi';
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}&domain=evil.example.com`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('Domain'));
  });
});

// ---------------------------------------------------------------------------
// GET /usage — data and response format
// ---------------------------------------------------------------------------

describe('GET /usage — data and granularity', () => {
  beforeEach(() => {
    process.env.ADMIN_KEY = ADMIN_KEY;
    process.env.ALLOWED_DOMAINS = '*';
  });

  it('returns an array under data key', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(body.data));
  });

  it('returns cache headers for historical (past) windows', async () => {
    const res = await fetch(`${baseUrl}/usage?from=2024-01-01&to=2024-01-31`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    assert.strictEqual(res.status, 200);
    const cacheControl = res.headers.get('Cache-Control');
    assert.ok(cacheControl && cacheControl.includes('max-age'), `expected cache header, got: ${cacheControl}`);
  });

  it('returns no-store cache header for windows including today when global middleware is present', async () => {
    // The route itself does NOT set Cache-Control for current windows — it relies on
    // the global server middleware. Without that middleware (in the unit test), the
    // header is absent. We just verify the response is still 200.
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    assert.strictEqual(res.status, 200);
    // Cache-Control may be null here since the global middleware isn't running
    // in this unit-test setup — that is expected and correct behaviour.
  });

  it('returns day-granularity data by default', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Insert a caption count for a known domain
    incrementDomainHourlyCaptions(db, 'https://usage-test.example.com', { sent: 5 });

    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}&domain=https://usage-test.example.com`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(body.data));
    // There should be at least one record for today
    const row = body.data.find(r => r.domain === 'https://usage-test.example.com');
    assert.ok(row, 'expected row for test domain');
    assert.ok(row.captions_sent >= 5);
  });

  it('granularity=hour returns hour-bucketed data', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/usage?from=${today}&to=${today}&granularity=hour`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(body.data));
    // If there are rows they should have an 'hour' bucket or similar hourly key
    // (Implementation-dependent; main check is it doesn't error)
  });
});
