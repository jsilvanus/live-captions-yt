import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let Database, express;
try {
  Database = (await import('better-sqlite3')).default;
  express = (await import('express')).default;
} catch {
  console.log('# better-sqlite3/express not available — skipping lcyt-connectors route tests');
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

  test('GET /connectors embeds each connector\'s requests — no follow-up GET /connectors/:slug/requests needed', async () => {
    await json('/connectors', { method: 'POST', body: JSON.stringify({ name: 'Joined', slug: 'joined-test', baseUrl: 'https://example.com' }) });
    await json('/connectors/joined-test/requests', { method: 'POST', body: JSON.stringify({ name: 'Current', slug: 'current', method: 'GET', path: '/current' }) });
    await json('/connectors/joined-test/requests', { method: 'POST', body: JSON.stringify({ name: 'Forecast', slug: 'forecast', method: 'GET', path: '/forecast' }) });

    const { status, body } = await json('/connectors');
    assert.equal(status, 200);
    const connector = body.connectors.find((c) => c.slug === 'joined-test');
    assert.ok(connector);
    assert.equal(connector.requests.length, 2);
    assert.deepEqual(connector.requests.map((r) => r.slug).sort(), ['current', 'forecast'].sort());
    assert.equal(connector.requests[0].constantPollEnabled, false);
    // auth_config masking still holds for the connector itself
    assert.equal('authConfig' in connector, false);
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

  test('PUT /variables/:name writes a source:file code with an inline => TTL', async () => {
    // Mirrors what useVariables.writeFileCode() sends for a file metacode.
    const res = await json('/variables/section', {
      method: 'PUT', body: JSON.stringify({ value: 'Prayer => 20s:Hymn', source: 'file' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.variable.value, 'Prayer');
    assert.equal(res.body.variable.source, 'file');
    assert.ok(res.body.variable.expiresAt);
    assert.equal(res.body.variable.revertMode, 'literal');
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

  test('GET /variables/events is retired', async () => {
    const res = await fetch(`${baseUrl}/variables/events`);
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Constant poll — session-long, pointer-independent background refresh
// (plan_live_variables.md §2). Deliberately separate from !api:/api:/api!:,
// which stay pointer-scoped and frontend-owned — this only covers the new
// opt-in toggle route. Uses a fake engine (no real fetch) wired directly
// through createPollScheduler, independent of initConnectors' real engine.
// ---------------------------------------------------------------------------

const { createPollScheduler } = await import('../src/poll-scheduler.js');

describe('lcyt-connectors routes — constant poll toggle', () => {
  let server, baseUrl, fireCalls, scheduler;

  before(async () => {
    const db = new Database(':memory:');
    const { runMigrations } = await import('../src/db.js');
    runMigrations(db);
    fireCalls = [];
    const fakeEngine = {
      fireRequest: async (apiKey, connectorSlug, requestSlug) => {
        fireCalls.push([apiKey, connectorSlug, requestSlug]);
        return { ok: true, variables: [] };
      },
    };
    scheduler = createPollScheduler({ db, engine: fakeEngine });
    const app = express();
    app.use(express.json());
    app.use('/connectors', createConnectorsRouter(db, fakeAuth, scheduler));
    await new Promise((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    scheduler.stopAll();
    return new Promise((resolve) => server.close(resolve));
  });

  async function json(path, opts) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1' },
      ...opts,
    });
    return { status: res.status, body: await res.json() };
  }

  test('PUT .../poll {enabled:true} starts the scheduler and reports constantPollEnabled', async () => {
    await json('/connectors', { method: 'POST', body: JSON.stringify({ name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' }) });
    await json('/connectors/weather/requests', { method: 'POST', body: JSON.stringify({ name: 'Current', slug: 'current', method: 'GET', path: '/current' }) });

    const res = await json('/connectors/weather/requests/current/poll', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.request.constantPollEnabled, true);
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), true);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(fireCalls, [['key1', 'weather', 'current']]);
  });

  test('PUT .../poll {enabled:false} stops the scheduler', async () => {
    await json('/connectors/weather/requests/current/poll', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    const res = await json('/connectors/weather/requests/current/poll', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.request.constantPollEnabled, false);
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), false);
  });

  test('deleting the request stops its poll', async () => {
    await json('/connectors/weather/requests/current/poll', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), true);
    const res = await json('/connectors/weather/requests/current', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), false);
  });

  test('PUT .../poll 501s without a pollScheduler wired', async () => {
    const db = new Database(':memory:');
    const { runMigrations } = await import('../src/db.js');
    runMigrations(db);
    const app = express();
    app.use(express.json());
    app.use('/connectors', createConnectorsRouter(db, fakeAuth)); // no scheduler passed
    const s = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const url = `http://127.0.0.1:${s.address().port}`;
    await fetch(`${url}/connectors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1' },
      body: JSON.stringify({ name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' }),
    });
    await fetch(`${url}/connectors/weather/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1' },
      body: JSON.stringify({ name: 'Current', slug: 'current', method: 'GET', path: '/current' }),
    });
    const res = await fetch(`${url}/connectors/weather/requests/current/poll`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(res.status, 501);
    await new Promise((resolve) => s.close(resolve));
  });
});
