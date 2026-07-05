import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping lcyt-connectors DB tests');
  process.exit(0);
}

const {
  runMigrations, createConnector, getConnectorBySlug, updateConnector, deleteConnector, maskConnector,
  createRequest, getRequestBySlug, listRequests,
  createMapping, listMappings,
  upsertManualVariable, getVariable, setConnectorVariable, deleteVariable, resolveVariableValue, listVariables,
} = await import('../src/db.js');

function createDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('connectors CRUD', () => {
  test('createConnector + getConnectorBySlug round-trip', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    const row = getConnectorBySlug(db, 'key1', 'weather');
    assert.equal(row.name, 'Weather');
    assert.equal(row.base_url, 'https://example.com');
    assert.equal(row.auth_type, 'none');
  });

  test('maskConnector never exposes auth_config', () => {
    const db = createDb();
    createConnector(db, 'key1', {
      id: 'c1', name: 'Secure', slug: 'secure', baseUrl: 'https://example.com',
      authType: 'bearer', authConfig: { token: 'super-secret' },
    });
    const row = getConnectorBySlug(db, 'key1', 'secure');
    const masked = maskConnector(row);
    assert.equal(masked.authConfigured, true);
    assert.equal(JSON.stringify(masked).includes('super-secret'), false);
  });

  test('updateConnector patches only provided fields', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'a', baseUrl: 'https://a.example' });
    updateConnector(db, 'c1', { name: 'B' });
    const row = getConnectorBySlug(db, 'key1', 'a');
    assert.equal(row.name, 'B');
    assert.equal(row.base_url, 'https://a.example');
  });

  test('deleteConnector removes the row', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'a', baseUrl: 'https://a.example' });
    assert.equal(deleteConnector(db, 'c1'), true);
    assert.equal(getConnectorBySlug(db, 'key1', 'a'), undefined);
  });

  test('connector slugs are scoped per api_key (UNIQUE api_key+slug)', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'weather', baseUrl: 'https://a.example' });
    createConnector(db, 'key2', { id: 'c2', name: 'A2', slug: 'weather', baseUrl: 'https://b.example' });
    assert.ok(getConnectorBySlug(db, 'key1', 'weather'));
    assert.ok(getConnectorBySlug(db, 'key2', 'weather'));
  });
});

describe('requests CRUD', () => {
  test('createRequest scopes slugs per connector, not globally', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'a', baseUrl: 'https://a.example' });
    createConnector(db, 'key1', { id: 'c2', name: 'B', slug: 'b', baseUrl: 'https://b.example' });
    createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current' });
    createRequest(db, 'c2', { id: 'r2', name: 'Current', slug: 'current', method: 'GET', path: '/current' });
    assert.equal(listRequests(db, 'c1').length, 1);
    assert.equal(listRequests(db, 'c2').length, 1);
    assert.equal(getRequestBySlug(db, 'c1', 'current').id, 'r1');
  });

  test('timeout_ms is clamped to 150-250', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'a', baseUrl: 'https://a.example' });
    const r1 = createRequest(db, 'c1', { id: 'r1', name: 'X', slug: 'x', method: 'GET', path: '/x', timeoutMs: 10 });
    const r2 = createRequest(db, 'c1', { id: 'r2', name: 'Y', slug: 'y', method: 'GET', path: '/y', timeoutMs: 9999 });
    assert.equal(r1.timeout_ms, 150);
    assert.equal(r2.timeout_ms, 250);
  });
});

describe('response mappings CRUD', () => {
  test('createMapping + listMappings ordered by sort_order', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'a', baseUrl: 'https://a.example' });
    createRequest(db, 'c1', { id: 'r1', name: 'X', slug: 'x', method: 'GET', path: '/x' });
    createMapping(db, 'r1', { id: 'm2', jsonPath: '$.b', variableName: 'b', sortOrder: 2 });
    createMapping(db, 'r1', { id: 'm1', jsonPath: '$.a', variableName: 'a', sortOrder: 1 });
    const mappings = listMappings(db, 'r1');
    assert.deepEqual(mappings.map(m => m.variable_name), ['a', 'b']);
  });
});

describe('variables CRUD', () => {
  test('upsertManualVariable creates then updates', () => {
    const db = createDb();
    upsertManualVariable(db, 'key1', 'greeting', { value: 'hello', defaultValue: 'hi' });
    let row = getVariable(db, 'key1', 'greeting');
    assert.equal(row.current_value, 'hello');
    assert.equal(row.source, 'manual');

    upsertManualVariable(db, 'key1', 'greeting', { value: 'howdy' });
    row = getVariable(db, 'key1', 'greeting');
    assert.equal(row.current_value, 'howdy');
    assert.equal(row.default_value, 'hi'); // untouched
  });

  test('resolveVariableValue falls back current -> default -> empty string', () => {
    assert.equal(resolveVariableValue(null), '');
    assert.equal(resolveVariableValue({ current_value: null, default_value: null }), '');
    assert.equal(resolveVariableValue({ current_value: null, default_value: 'd' }), 'd');
    assert.equal(resolveVariableValue({ current_value: 'v', default_value: 'd' }), 'v');
  });

  test('setConnectorVariable marks source as connector and stamps resolved_at', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'A', slug: 'a', baseUrl: 'https://a.example' });
    createRequest(db, 'c1', { id: 'req1', name: 'R', slug: 'r', method: 'GET', path: '/x' });
    setConnectorVariable(db, 'key1', 'temp', '21', 'req1');
    const row = getVariable(db, 'key1', 'temp');
    assert.equal(row.current_value, '21');
    assert.equal(row.source, 'connector');
    assert.equal(row.source_request_id, 'req1');
    assert.ok(row.resolved_at);
  });

  test('deleteVariable removes the row', () => {
    const db = createDb();
    upsertManualVariable(db, 'key1', 'x', { value: '1' });
    assert.equal(deleteVariable(db, 'key1', 'x'), true);
    assert.equal(getVariable(db, 'key1', 'x'), undefined);
  });

  test('listVariables scoped per api_key', () => {
    const db = createDb();
    upsertManualVariable(db, 'key1', 'a', { value: '1' });
    upsertManualVariable(db, 'key2', 'b', { value: '2' });
    assert.equal(listVariables(db, 'key1').length, 1);
    assert.equal(listVariables(db, 'key2').length, 1);
  });
});
