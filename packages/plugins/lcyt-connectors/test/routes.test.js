import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let Database, express, jwt;
try {
  Database = (await import('better-sqlite3')).default;
  express = (await import('express')).default;
  jwt = (await import('jsonwebtoken')).default;
} catch {
  console.log('# better-sqlite3/express/jsonwebtoken not available — skipping lcyt-connectors route tests');
  process.exit(0);
}

const { initConnectors } = await import('../src/api.js');
const { createConnectorsRouter } = await import('../src/routes/connectors.js');
const { createVariablesRouter } = await import('../src/routes/variables.js');

const JWT_SECRET = 'test-secret';

// No JWT verification needed here — auth just needs to set req.session.apiKey.
function fakeAuth(req, res, next) {
  req.session = { apiKey: req.headers['x-test-api-key'] || 'key1' };
  next();
}

describe('lcyt-connectors routes', () => {
  let server, baseUrl;

  before(async () => {
    const db = new Database(':memory:');
    const { bus, engine, scheduler } = initConnectors(db, {});
    const app = express();
    app.use(express.json());
    app.use('/connectors', createConnectorsRouter(db, fakeAuth));
    app.use('/variables', createVariablesRouter(db, fakeAuth, bus, engine, scheduler, JWT_SECRET));
    await new Promise((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  async function json(path, opts) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1' },
      ...opts,
    });
    return { status: res.status, body: await res.json() };
  }

  test('POST /connectors validates required fields', async () => {
    const { status, body } = await json('/connectors', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(status, 400);
    assert.match(body.error, /required/);
  });

  test('full connector -> request -> mapping CRUD chain', async () => {
    let res = await json('/connectors', {
      method: 'POST',
      body: JSON.stringify({ name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.connector.slug, 'weather');
    assert.equal('authConfig' in res.body.connector, false);

    res = await json('/connectors/weather/requests', {
      method: 'POST',
      body: JSON.stringify({ name: 'Current', slug: 'current', method: 'GET', path: '/current', responseType: 'json' }),
    });
    assert.equal(res.status, 201);
    const requestId = res.body.request.id;

    res = await json('/connectors/weather/requests/current/mappings', {
      method: 'POST',
      body: JSON.stringify({ jsonPath: '$.temp', variableName: 'temp' }),
    });
    assert.equal(res.status, 201);

    res = await json('/connectors/weather/requests/current/mappings');
    assert.equal(res.body.mappings.length, 1);
    assert.equal(res.body.mappings[0].variableName, 'temp');

    res = await json('/connectors/weather', { method: 'DELETE' });
    assert.equal(res.status, 200);
    res = await json('/connectors/weather');
    assert.equal(res.status, 404);
  });

  test('rejects a duplicate connector slug', async () => {
    await json('/connectors', { method: 'POST', body: JSON.stringify({ name: 'A', slug: 'dup', baseUrl: 'https://a.example' }) });
    const { status, body } = await json('/connectors', { method: 'POST', body: JSON.stringify({ name: 'B', slug: 'dup', baseUrl: 'https://b.example' }) });
    assert.equal(status, 409);
    assert.match(body.error, /already in use/);
  });

  test('rejects a mapping variable name starting with underscore', async () => {
    await json('/connectors', { method: 'POST', body: JSON.stringify({ name: 'A', slug: 'sysvar', baseUrl: 'https://a.example' }) });
    await json('/connectors/sysvar/requests', { method: 'POST', body: JSON.stringify({ name: 'R', slug: 'r', method: 'GET', path: '/x' }) });
    const { status, body } = await json('/connectors/sysvar/requests/r/mappings', {
      method: 'POST', body: JSON.stringify({ variableName: '_reserved' }),
    });
    assert.equal(status, 400);
    assert.match(body.error, /reserved/);
  });

  test('variable CRUD: create, read snapshot, update, delete', async () => {
    let res = await json('/variables', { method: 'POST', body: JSON.stringify({ name: 'greeting', value: 'hi', defaultValue: 'hello' }) });
    assert.equal(res.status, 201);

    res = await json('/variables');
    assert.equal(res.body.variables.greeting.value, 'hi');
    assert.equal(res.body.variables.greeting.source, 'manual');

    res = await json('/variables/greeting', { method: 'PUT', body: JSON.stringify({ value: 'yo' }) });
    assert.equal(res.body.variable.value, 'yo');

    res = await json('/variables/greeting', { method: 'DELETE' });
    assert.equal(res.status, 200);
    res = await json('/variables');
    assert.equal(res.body.variables.greeting, undefined);
  });

  test('POST /variables parses an inline => TTL off the value', async () => {
    const res = await json('/variables', {
      method: 'POST', body: JSON.stringify({ name: 'ttlvar', value: 'Prayer => 20s:Hymn' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.variable.value, 'Prayer'); // annotation stripped
    assert.ok(res.body.variable.expiresAt, 'expiresAt exposed');
    assert.equal(res.body.variable.revertMode, 'literal');
  });

  test('PUT /variables without a TTL clears a pending expiry (last-write-wins)', async () => {
    await json('/variables', { method: 'POST', body: JSON.stringify({ name: 'lww', value: 'Live => 60s' }) });
    let res = await json('/variables');
    assert.ok(res.body.variables.lww.expiresAt);
    await json('/variables/lww', { method: 'PUT', body: JSON.stringify({ value: 'Held' }) });
    res = await json('/variables');
    assert.equal(res.body.variables.lww.value, 'Held');
    assert.equal(res.body.variables.lww.expiresAt, null);
  });

  test('POST /variables rejects names starting with underscore', async () => {
    const { status, body } = await json('/variables', { method: 'POST', body: JSON.stringify({ name: '_reserved', value: '1' }) });
    assert.equal(status, 400);
    assert.match(body.error, /reserved/);
  });

  test('POST /variables/refresh 202s fire-and-forget for an unreachable connector', async () => {
    await json('/connectors', { method: 'POST', body: JSON.stringify({ name: 'Ghost', slug: 'ghost', baseUrl: 'https://nonexistent.invalid.example' }) });
    await json('/connectors/ghost/requests', { method: 'POST', body: JSON.stringify({ name: 'R', slug: 'r', method: 'GET', path: '/x' }) });
    const { status, body } = await json('/variables/refresh', {
      method: 'POST', body: JSON.stringify({ connectorSlug: 'ghost', requestSlug: 'r' }),
    });
    assert.equal(status, 202);
    assert.equal(body.pending, true);
  });

  test('variables are scoped per api_key', async () => {
    await fetch(`${baseUrl}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'other-key' },
      body: JSON.stringify({ name: 'onlyMine', value: 'x' }),
    });
    const res = await json('/variables'); // key1
    assert.equal(res.body.variables.onlyMine, undefined);
  });

  describe('GET /variables/events (SSE auth)', () => {
    test('rejects a forged token (valid JWT shape, wrong signature)', async () => {
      const forged = jwt.sign({ apiKey: 'someone-elses-key' }, 'wrong-secret');
      const res = await fetch(`${baseUrl}/variables/events?token=${encodeURIComponent(forged)}`);
      assert.equal(res.status, 401);
    });

    test('rejects a hand-crafted unsigned "token" (base64-decodable but not a real JWT)', async () => {
      const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
      const fakePayload = Buffer.from(JSON.stringify({ apiKey: 'key1' })).toString('base64url');
      const forged = `${fakeHeader}.${fakePayload}.`;
      const res = await fetch(`${baseUrl}/variables/events?token=${encodeURIComponent(forged)}`);
      assert.equal(res.status, 401);
    });

    test('accepts a properly signed token and streams the connected event', async () => {
      const token = jwt.sign({ apiKey: 'key1' }, JWT_SECRET);
      const res = await fetch(`${baseUrl}/variables/events?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      const { value } = await reader.read();
      const text = Buffer.from(value).toString();
      assert.match(text, /event: connected/);
      assert.match(text, /"apiKey":"key1"/);
      await reader.cancel();
    });
  });
});
