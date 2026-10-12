import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';


const { createConnector, createRequest, createMapping, getVariable } = await import('../src/db.js');
const { createResolutionEngine } = await import('../src/resolution-engine.js');
const { VariablesBus } = await import('../src/variables-bus.js');

const opened = [];
after(async () => { for (const d of opened) await d.close(); });

async function createDb() {
  const db = await initDb(':memory:');
  opened.push(db);
  return db;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolution engine', () => {
  test('fireRequest maps a JSON response onto variables and emits SSE', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    await createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current', responseType: 'json' });
    await createMapping(db, 'r1', { id: 'm1', jsonPath: '$.temp', variableName: 'temp' });

    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://example.com/current');
      return new Response(JSON.stringify({ temp: 21 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const events = [];
    const bus = new VariablesBus();
    bus.emitVariableUpdated = (apiKey, data) => events.push({ apiKey, data });

    const engine = createResolutionEngine({ db, bus });
    const result = await engine.fireRequest('key1', 'weather', 'current');

    assert.equal(result.ok, true);
    assert.equal((await getVariable(db, 'key1', 'temp')).current_value, '21');
    assert.equal(events.length, 1);
    assert.equal(events[0].data.name, 'temp');
  });

  test('fireRequest interpolates {{ }} into path from the current variable snapshot', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', { id: 'c1', name: 'API', slug: 'api', baseUrl: 'https://example.com' });
    await createRequest(db, 'c1', { id: 'r1', name: 'Get', slug: 'get', method: 'GET', path: '/users/{{userId}}', responseType: 'text' });
    await createMapping(db, 'r1', { id: 'm1', jsonPath: '$', variableName: 'result' });

    const { upsertManualVariable } = await import('../src/db.js');
    await upsertManualVariable(db, 'key1', 'userId', { value: '42' });

    let requestedUrl;
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    };

    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    await engine.fireRequest('key1', 'api', 'get');

    assert.equal(requestedUrl, 'https://example.com/users/42');
  });

  test('fireRequest returns an error for an unknown connector', async () => {
    const db = await createDb();
    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    const result = await engine.fireRequest('key1', 'missing', 'missing');
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown connector/);
  });

  test('fireRequest surfaces a non-2xx HTTP status as an error without throwing', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', { id: 'c1', name: 'API', slug: 'api', baseUrl: 'https://example.com' });
    await createRequest(db, 'c1', { id: 'r1', name: 'Get', slug: 'get', method: 'GET', path: '/x', responseType: 'json' });

    globalThis.fetch = async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });

    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    const result = await engine.fireRequest('key1', 'api', 'get');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'HTTP 404');
  });

  test('bearer auth adds an Authorization header', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', {
      id: 'c1', name: 'API', slug: 'api', baseUrl: 'https://example.com',
      authType: 'bearer', authConfig: { token: 'sekret' },
    });
    await createRequest(db, 'c1', { id: 'r1', name: 'Get', slug: 'get', method: 'GET', path: '/x', responseType: 'text' });

    let seenHeaders;
    globalThis.fetch = async (_url, opts) => {
      seenHeaders = opts.headers;
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    };

    const bus = new VariablesBus();
    const engine = createResolutionEngine({ db, bus });
    await engine.fireRequest('key1', 'api', 'get');

    assert.equal(seenHeaders.Authorization, 'Bearer sekret');
  });

  test('image responses are stored through filesControl and the variable holds the reference', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', { id: 'c1', name: 'Img', slug: 'img', baseUrl: 'https://example.com' });
    await createRequest(db, 'c1', { id: 'r1', name: 'Logo', slug: 'logo', method: 'GET', path: '/logo.png', responseType: 'image' });
    await createMapping(db, 'r1', { id: 'm1', jsonPath: '$', variableName: 'logo' });

    globalThis.fetch = async () => new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });

    const stored = [];
    const filesControl = {
      resolveStorage: async () => ({
        putObject: async (_key, objectKey, buffer, type) => { stored.push({ objectKey, bytes: [...buffer], type }); return { storedKey: objectKey }; },
        publicUrl: () => 'https://files.example/logo.png',
      }),
    };
    const engine = createResolutionEngine({ db, bus: new VariablesBus(), filesControl });
    const result = await engine.fireRequest('key1', 'img', 'logo');

    assert.equal(result.ok, true);
    assert.deepEqual(stored[0].bytes, [1, 2, 3]);
    assert.equal(stored[0].type, 'image/png');
    assert.equal((await getVariable(db, 'key1', 'logo')).current_value, 'https://files.example/logo.png');
  });
});
