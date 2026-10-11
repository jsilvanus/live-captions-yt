import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';

const opened = [];
after(async () => { for (const d of opened) await d.close(); });


const TAGS_RESPONSE = {
  models: [
    {
      name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4920000000,
      details: { family: 'llama', families: ['llama'], parameter_size: '8.0B', quantization_level: 'Q4_0' },
    },
    {
      name: 'nomic-embed-text', model: 'nomic-embed-text',
      details: { family: 'nomic-bert', parameter_size: '137M', quantization_level: 'F16' },
    },
    {
      name: 'llava:13b', model: 'llava:13b',
      details: { family: 'llama', families: ['llama', 'clip'], parameter_size: '13B', quantization_level: 'Q4_0' },
    },
  ],
};

describe('discovery', () => {
  let reg, disc;
  const realFetch = global.fetch;

  before(async () => {
    reg = await import('../src/provider-registry.js');
    disc = await import('../src/discovery.js');
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  async function createDb() {
    const db = await initDb(':memory:');
    opened.push(db);
    return db;
  }

  async function makeOllamaProvider(db, extra = {}) {
    const masked = await reg.createProvider(db, {
      scope: 'site', kind: 'ollama', vendor: 'ollama',
      name: 'Test Ollama', baseUrl: 'http://ollama.test:11434', ...extra,
    });
    return await reg.getProvider(db, masked.id);
  }

  describe('inferCapabilities', () => {
    test('embed in name or family → embedding', async () => {
      assert.deepEqual(disc.inferCapabilities({ name: 'nomic-embed-text' }), ['embedding']);
      assert.deepEqual(disc.inferCapabilities({ name: 'mystery', details: { family: 'bert-embed' } }), ['embedding']);
    });

    test('known vision families → vision + chat', async () => {
      assert.deepEqual(disc.inferCapabilities({ name: 'llava:13b' }), ['vision', 'chat']);
      assert.deepEqual(disc.inferCapabilities({ name: 'moondream' }), ['vision', 'chat']);
      assert.deepEqual(disc.inferCapabilities({ name: 'x', details: { families: ['bakllava'] } }), ['vision', 'chat']);
    });

    test('everything else → chat', async () => {
      assert.deepEqual(disc.inferCapabilities({ name: 'llama3.1:70b' }), ['chat']);
      assert.deepEqual(disc.inferCapabilities({}), ['chat']);
    });
  });

  describe('discoverProvider — direct', () => {
    test('upserts discovered models from /api/tags', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db);
      let requestedUrl = null;
      global.fetch = async (url) => {
        requestedUrl = url;
        return { ok: true, json: async () => TAGS_RESPONSE };
      };

      const result = await disc.discoverProvider(db, provider);
      assert.equal(result.ok, true);
      assert.equal(result.discovered, 3);
      assert.equal(requestedUrl, 'http://ollama.test:11434/api/tags');

      const models = await reg.listProviderModels(db, provider.id);
      assert.equal(models.length, 3);
      const llama = models.find((m) => m.modelName === 'llama3.1:8b');
      assert.equal(llama.source, 'discovered');
      assert.equal(llama.parameterSize, '8.0B');
      assert.equal(llama.quantization, 'Q4_0');
      assert.deepEqual(llama.capabilities, ['chat']);
      assert.deepEqual(models.find((m) => m.modelName === 'llava:13b').capabilities, ['vision', 'chat']);
      assert.ok((await reg.getProvider(db, provider.id)).last_discovery_at);
      assert.equal((await reg.getProvider(db, provider.id)).last_discovery_error, null);
    });

    test('absent models are kept with a stale last_seen_at, reappeared models bump it', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db);
      global.fetch = async () => ({ ok: true, json: async () => TAGS_RESPONSE });
      await disc.discoverProvider(db, provider);

      // Mark the first sweep older so the second sweep's timestamps differ
      await db.prepare("UPDATE ai_provider_models SET last_seen_at = '2020-01-01 00:00:00'").run();

      // Second sweep: llama3.1:8b removed, others still present
      const secondSweep = { models: TAGS_RESPONSE.models.filter((m) => m.name !== 'llama3.1:8b') };
      global.fetch = async () => ({ ok: true, json: async () => secondSweep });
      await disc.discoverProvider(db, provider);

      const models = await reg.listProviderModels(db, provider.id);
      assert.equal(models.length, 3, 'absent model is not deleted');
      const gone = models.find((m) => m.modelName === 'llama3.1:8b');
      const still = models.find((m) => m.modelName === 'llava:13b');
      assert.equal(gone.lastSeenAt, '2020-01-01 00:00:00');
      assert.notEqual(still.lastSeenAt, '2020-01-01 00:00:00');
    });

    test('a discovery sweep does not resurrect an admin-disabled model', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db);
      global.fetch = async () => ({ ok: true, json: async () => TAGS_RESPONSE });
      await disc.discoverProvider(db, provider);
      const model = (await reg.listProviderModels(db, provider.id)).find((m) => m.modelName === 'llama3.1:8b');
      await reg.updateModel(db, provider.id, model.id, { enabled: false });

      await disc.discoverProvider(db, provider);
      const after = (await reg.listProviderModels(db, provider.id)).find((m) => m.modelName === 'llama3.1:8b');
      assert.equal(after.enabled, false);
    });

    test('records last_discovery_error on failure', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db);
      global.fetch = async () => ({ ok: false, status: 502 });
      const result = await disc.discoverProvider(db, provider);
      assert.equal(result.ok, false);
      assert.match(result.error, /502/);
      assert.match((await reg.getProvider(db, provider.id)).last_discovery_error, /502/);
    });
  });

  describe('discoverProvider — bridge-relayed', () => {
    test('dispatches http_request through the bridge manager', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db, { bridgeInstanceId: 'bridge-1' });
      let sentCommand = null;
      const bridgeManager = {
        isConnected: () => true,
        sendCommand: async (instanceId, command) => {
          sentCommand = { instanceId, command };
          return { ok: true, status: 200, body: TAGS_RESPONSE };
        },
      };

      const result = await disc.discoverProvider(db, provider, { bridgeManager });
      assert.equal(result.ok, true);
      assert.equal(result.discovered, 3);
      assert.equal(sentCommand.instanceId, 'bridge-1');
      assert.equal(sentCommand.command.type, 'http_request');
      assert.equal(sentCommand.command.url, 'http://ollama.test:11434/api/tags');
    });

    test('parses a string body from the bridge', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db, { bridgeInstanceId: 'bridge-1' });
      const bridgeManager = {
        isConnected: () => true,
        sendCommand: async () => ({ ok: true, status: 200, body: JSON.stringify(TAGS_RESPONSE) }),
      };
      const result = await disc.discoverProvider(db, provider, { bridgeManager });
      assert.equal(result.ok, true);
      assert.equal(result.discovered, 3);
    });

    test('fails immediately when the bridge is disconnected', async () => {
      const db = await createDb();
      const provider = await makeOllamaProvider(db, { bridgeInstanceId: 'bridge-1' });
      const bridgeManager = { isConnected: () => false, sendCommand: async () => { throw new Error('should not be called'); } };
      const result = await disc.discoverProvider(db, provider, { bridgeManager });
      assert.equal(result.ok, false);
      assert.match(result.error, /bridge disconnected/);
    });
  });

  describe('discoverProvider — non-ollama kinds', () => {
    test("'api' and 'deer' providers short-circuit to a no-op", async () => {
      const db = await createDb();
      const apiP = await reg.getProvider(db, (await reg.createProvider(db, {
        scope: 'site', kind: 'api', vendor: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com',
      })).id);
      const deerP = await reg.getProvider(db, (await reg.createProvider(db, {
        scope: 'site', kind: 'deer', vendor: 'deer', name: 'Deer', baseUrl: '',
      })).id);
      global.fetch = async () => { throw new Error('should not fetch'); };

      for (const p of [apiP, deerP]) {
        const result = await disc.discoverProvider(db, p);
        assert.deepEqual(result, { ok: true, discovered: 0, skipped: true });
      }
      assert.equal(Number((await db.prepare('SELECT COUNT(*) c FROM ai_provider_models').get()).c), 0);
    });
  });
});
