import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping resolution engine tests');
  process.exit(0);
}

const { runMigrations, createConnector, createRequest, createMapping, getVariable } = await import('../src/db.js');
const { createResolutionEngine } = await import('../src/resolution-engine.js');
const { VariablesBus } = await import('../src/variables-bus.js');

function createDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolution engine', () => {
  test('fireRequest maps a JSON response onto variables and emits SSE', async () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current', responseType: 'json' });
    createMapping(db, 'r1', { id: 'm1', jsonPath: '$.temp', variableName: 'temp' });

    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://example.com/current');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ temp: 21 }),
      };
    };

    const events = [];
    const bus = new VariablesBus();
    bus.emitVariableUpdated = (apiKey, data) => events.push({ apiKey, data });

    const engine = createResolutionEngine({ db, bus });
    const result = await engine.fireRequest('key1', 'weather', 'current');

    assert.equal(result.ok, true);
    assert.equal(getVariable(db, 'key1', 'temp').current_value, '21');
    assert.equal(events.length, 1);
    assert.equal(events[0].data.name, 'temp');
  });

  test('fireRequest interpolates {{ }} into path from the current variable snapshot', async () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'API', slug: 'api', baseUrl: 'https://example.com' });
    createRequest(db, 'c1', { id: 'r1', name: 'Get', slug: 'get', method: 'GET', path: '/users/{{userId}}', responseType: 'text' });
    createMapping(db, 'r1', { id: 'm1', jsonPath: '$', variableName: 'result' });

    const { upsertManualVariable } = await import('../src/db.js');
    upsertManualVariable(db, 'key1', 'userId', { value: '42' });

    let requestedUrl;
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'ok' };
    };

    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    await engine.fireRequest('key1', 'api', 'get');

    assert.equal(requestedUrl, 'https://example.com/users/42');
  });

  test('fireRequest returns an error for an unknown connector', async () => {
    const db = createDb();
    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    const result = await engine.fireRequest('key1', 'missing', 'missing');
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown connector/);
  });

  test('fireRequest surfaces a non-2xx HTTP status as an error without throwing', async () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'API', slug: 'api', baseUrl: 'https://example.com' });
    createRequest(db, 'c1', { id: 'r1', name: 'Get', slug: 'get', method: 'GET', path: '/x', responseType: 'json' });

    globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => 'application/json' }, text: async () => '{}' });

    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    const result = await engine.fireRequest('key1', 'api', 'get');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'HTTP 404');
  });

  test('bearer auth adds an Authorization header', async () => {
    const db = createDb();
    createConnector(db, 'key1', {
      id: 'c1', name: 'API', slug: 'api', baseUrl: 'https://example.com',
      authType: 'bearer', authConfig: { token: 'sekret' },
    });
    createRequest(db, 'c1', { id: 'r1', name: 'Get', slug: 'get', method: 'GET', path: '/x', responseType: 'text' });

    let seenHeaders;
    globalThis.fetch = async (_url, opts) => {
      seenHeaders = opts.headers;
      return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => 'ok' };
    };

    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    await engine.fireRequest('key1', 'api', 'get');

    assert.equal(seenHeaders.Authorization, 'Bearer sekret');
  });
});
