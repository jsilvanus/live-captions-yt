import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';

const opened = [];
after(async () => { for (const d of opened) await d.close(); });


describe('provider registry', () => {
  let reg;

  before(async () => {
    reg = await import('../src/provider-registry.js');
  });

  async function createDb() {
    const db = await initDb(':memory:');
    opened.push(db);
    return db;
  }

  test('createProvider + getProvider round-trips a site provider', async () => {
    const db = await createDb();
    const created = await reg.createProvider(db, {
      scope: 'site', kind: 'ollama', vendor: 'ollama',
      name: 'Office GPU box', baseUrl: 'http://10.0.0.5:11434',
    });
    assert.ok(created.id);
    assert.equal(created.scope, 'site');
    assert.equal(created.reachability, 'direct');
    const raw = await reg.getProvider(db, created.id);
    assert.equal(raw.name, 'Office GPU box');
    assert.equal(raw.owner_api_key, null);
  });

  test('maskProvider strips api_key_ref and exposes credentialConfigured', async () => {
    const db = await createDb();
    const created = await reg.createProvider(db, {
      scope: 'site', kind: 'api', vendor: 'openai',
      name: 'Shared OpenAI', baseUrl: 'https://api.openai.com', apiKeyRef: 'sk-secret',
    });
    assert.equal(created.apiKeyRef, undefined);
    assert.equal(created.api_key_ref, undefined);
    assert.equal(created.credentialConfigured, true);
    const noCred = await reg.createProvider(db, {
      scope: 'site', kind: 'ollama', name: 'No cred', baseUrl: 'http://x:11434',
    });
    assert.equal(noCred.credentialConfigured, false);
  });

  test('bridge_instance_id derives reachability: bridge', async () => {
    const db = await createDb();
    const created = await reg.createProvider(db, {
      scope: 'project', ownerApiKey: 'key1', kind: 'ollama',
      name: 'LAN Ollama', baseUrl: 'http://ollama:11434', bridgeInstanceId: 'bridge-1',
    });
    assert.equal(created.reachability, 'bridge');
    const updated = await reg.updateProvider(db, created.id, { bridgeInstanceId: null });
    assert.equal(updated.reachability, 'direct');
  });

  test("kind 'deer' is a valid, inert enum value from day one", async () => {
    const db = await createDb();
    assert.equal(reg.validateProviderInput({ scope: 'site', kind: 'deer', name: 'Deer', baseUrl: '' }), null);
  });

  test('validateProviderInput rejects bad scope/kind/vendor and missing fields', async () => {
    assert.match(reg.validateProviderInput({ scope: 'global', kind: 'api', name: 'x', baseUrl: 'u' }), /scope/);
    assert.match(reg.validateProviderInput({ scope: 'site', kind: 'llm', name: 'x', baseUrl: 'u' }), /kind/);
    assert.match(reg.validateProviderInput({ scope: 'site', kind: 'api', vendor: 'aws', name: 'x', baseUrl: 'u' }), /vendor/);
    assert.match(reg.validateProviderInput({ scope: 'site', kind: 'api', baseUrl: 'u' }), /name/);
    assert.match(reg.validateProviderInput({ scope: 'site', kind: 'api', name: 'x' }), /baseUrl/);
    assert.match(reg.validateProviderInput({ scope: 'project', kind: 'api', name: 'x', baseUrl: 'u' }), /ownerApiKey/);
  });

  test('grant-based visibility: site+granted vs. project-own vs. neither', async () => {
    const db = await createDb();
    const site = await reg.createProvider(db, { scope: 'site', kind: 'ollama', name: 'Shared', baseUrl: 'http://s:11434' });
    const own = await reg.createProvider(db, { scope: 'project', ownerApiKey: 'key1', kind: 'api', vendor: 'openai', name: 'Mine', baseUrl: 'https://api.openai.com' });
    await reg.createProvider(db, { scope: 'project', ownerApiKey: 'key2', kind: 'api', vendor: 'openai', name: 'Theirs', baseUrl: 'https://api.openai.com' });

    // Site provider invisible until granted (default-deny)
    let visible = await reg.listVisibleProviders(db, 'key1');
    assert.deepEqual(visible.map((p) => p.id), [own.id]);

    await reg.setGrant(db, site.id, 'key1', true);
    visible = await reg.listVisibleProviders(db, 'key1');
    assert.deepEqual(visible.map((p) => p.id).sort(), [site.id, own.id].sort());

    // Revoking the grant hides it again
    await reg.setGrant(db, site.id, 'key1', false);
    visible = await reg.listVisibleProviders(db, 'key1');
    assert.deepEqual(visible.map((p) => p.id), [own.id]);

    // Another project never sees key1's private provider
    const other = await reg.listVisibleProviders(db, 'key2');
    assert.equal(other.some((p) => p.id === own.id), false);
  });

  test('isProviderVisible matches listVisibleProviders semantics', async () => {
    const db = await createDb();
    const site = await reg.createProvider(db, { scope: 'site', kind: 'ollama', name: 'Shared', baseUrl: 'http://s:11434' });
    const own = await reg.createProvider(db, { scope: 'project', ownerApiKey: 'key1', kind: 'ollama', name: 'Mine', baseUrl: 'http://m:11434' });
    assert.equal(await reg.isProviderVisible(db, await reg.getProvider(db, site.id), 'key1'), false);
    await reg.setGrant(db, site.id, 'key1', true);
    assert.equal(await reg.isProviderVisible(db, await reg.getProvider(db, site.id), 'key1'), true);
    assert.equal(await reg.isProviderVisible(db, await reg.getProvider(db, own.id), 'key1'), true);
    assert.equal(await reg.isProviderVisible(db, await reg.getProvider(db, own.id), 'key2'), false);
  });

  test('deleteProvider cascades models and grants', async () => {
    const db = await createDb();
    const p = await reg.createProvider(db, { scope: 'site', kind: 'ollama', name: 'Doomed', baseUrl: 'http://d:11434' });
    await reg.addManualModel(db, p.id, { modelName: 'llama3.1:8b', capabilities: ['chat'] });
    await reg.setGrant(db, p.id, 'key1', true);
    assert.equal(await reg.deleteProvider(db, p.id), true);
    assert.equal(await reg.getProvider(db, p.id), null);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) c FROM ai_provider_models').get()).c), 0);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) c FROM ai_provider_grants').get()).c), 0);
  });

  test('model catalog: manual add, duplicate rejection, update, delete', async () => {
    const db = await createDb();
    const p = await reg.createProvider(db, { scope: 'site', kind: 'ollama', name: 'Cat', baseUrl: 'http://c:11434' });
    const m = await reg.addManualModel(db, p.id, { modelName: 'nomic-embed-text', capabilities: ['embedding'] });
    assert.equal(m.source, 'manual');
    assert.deepEqual(m.capabilities, ['embedding']);
    assert.equal(await reg.addManualModel(db, p.id, { modelName: 'nomic-embed-text' }), null);

    const updated = await reg.updateModel(db, p.id, m.id, { capabilities: ['embedding', 'chat'], enabled: false });
    assert.deepEqual(updated.capabilities, ['embedding', 'chat']);
    assert.equal(updated.enabled, false);
    assert.equal(await reg.updateModel(db, p.id, 9999, { enabled: true }), null);

    assert.equal(await reg.deleteModel(db, p.id, m.id), true);
    assert.equal(await reg.deleteModel(db, p.id, m.id), false);
    assert.deepEqual(await reg.listProviderModels(db, p.id), []);
  });
});
