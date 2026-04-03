import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// In-memory SQLite for realistic testing
// ---------------------------------------------------------------------------

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping AgentEngine tests');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentEngine', () => {
  let AgentEngine, runMigrations, runAiMigrations, setAiConfig, insertAgentEvent, getRecentAgentEvents;

  before(async () => {
    ({ AgentEngine } = await import('../src/agent-engine.js'));
    ({ runMigrations, insertAgentEvent, getRecentAgentEvents } = await import('../src/db.js'));
    ({ runAiMigrations, setAiConfig } = await import('../src/ai-config.js'));
  });

  function createDb() {
    const db = new Database(':memory:');
    runMigrations(db);
    runAiMigrations(db);
    return db;
  }

  test('context window starts empty', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    assert.deepEqual(agent.getContext('key1'), []);
  });

  test('addContext adds entries to the context window', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    agent.addContext('key1', 'transcript', 'Hello world');
    agent.addContext('key1', 'explanation', 'Speaker is greeting the audience');
    const ctx = agent.getContext('key1');
    assert.equal(ctx.length, 2);
    assert.equal(ctx[0].type, 'transcript');
    assert.equal(ctx[0].text, 'Hello world');
    assert.equal(ctx[1].type, 'explanation');
  });

  test('context window per API key is isolated', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    agent.addContext('key1', 'transcript', 'Hello');
    agent.addContext('key2', 'transcript', 'World');
    assert.equal(agent.getContext('key1').length, 1);
    assert.equal(agent.getContext('key2').length, 1);
    assert.equal(agent.getContext('key1')[0].text, 'Hello');
    assert.equal(agent.getContext('key2')[0].text, 'World');
  });

  test('clearContext removes all entries for a key', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    agent.addContext('key1', 'transcript', 'Hello');
    agent.addContext('key1', 'transcript', 'World');
    assert.equal(agent.getContext('key1').length, 2);
    agent.clearContext('key1');
    assert.deepEqual(agent.getContext('key1'), []);
  });

  test('context window trims to max entries', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    agent._maxContextEntries = 5;
    for (let i = 0; i < 10; i++) {
      agent.addContext('key1', 'transcript', `Entry ${i}`);
    }
    const ctx = agent.getContext('key1');
    assert.equal(ctx.length, 5);
    assert.equal(ctx[0].text, 'Entry 5'); // oldest trimmed
    assert.equal(ctx[4].text, 'Entry 9');
  });

  test('analyseImage returns stub result', async () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    const result = await agent.analyseImage('key1', Buffer.from('fake-jpeg'));
    assert.equal(result.description, '');
    assert.equal(result.confidence, 0);
  });

  test('evaluateEventCue returns not-configured when no AI config', async () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    const result = await agent.evaluateEventCue('key1', 'speaker stands up');
    assert.equal(result.matched, false);
    assert.equal(result.confidence, 0);
    assert.ok(result.reasoning.includes('not configured'));
  });

  test('evaluateEventCue returns not-configured when provider is none', async () => {
    const db = createDb();
    setAiConfig(db, 'key1', { embeddingProvider: 'none' });
    const agent = new AgentEngine(db);
    const result = await agent.evaluateEventCue('key1', 'speaker stands up');
    assert.equal(result.matched, false);
    assert.ok(result.reasoning.includes('not configured'));
  });

  test('evaluateEventCue returns no context when context window is empty', async () => {
    const db = createDb();
    setAiConfig(db, 'key1', {
      embeddingProvider: 'openai',
      embeddingApiKey: 'sk-test',
    });
    const agent = new AgentEngine(db);
    const result = await agent.evaluateEventCue('key1', 'speaker stands up');
    assert.equal(result.matched, false);
    assert.ok(result.reasoning.includes('No context'));
  });

  test('_resolveApiSettings uses env vars for server provider', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    const origUrl = process.env.EMBEDDING_API_URL;
    const origKey = process.env.EMBEDDING_API_KEY;
    const origModel = process.env.EMBEDDING_MODEL;
    try {
      process.env.EMBEDDING_API_URL = 'https://my-server.com';
      process.env.EMBEDDING_API_KEY = 'server-key';
      process.env.EMBEDDING_MODEL = 'gpt-4o';
      const settings = agent._resolveApiSettings({ embeddingProvider: 'server' });
      assert.equal(settings.apiUrl, 'https://my-server.com');
      assert.equal(settings.apiKey, 'server-key');
      assert.equal(settings.model, 'gpt-4o');
    } finally {
      if (origUrl !== undefined) process.env.EMBEDDING_API_URL = origUrl; else delete process.env.EMBEDDING_API_URL;
      if (origKey !== undefined) process.env.EMBEDDING_API_KEY = origKey; else delete process.env.EMBEDDING_API_KEY;
      if (origModel !== undefined) process.env.EMBEDDING_MODEL = origModel; else delete process.env.EMBEDDING_MODEL;
    }
  });

  test('_resolveApiSettings uses user config for custom provider', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    const settings = agent._resolveApiSettings({
      embeddingProvider: 'custom',
      embeddingApiUrl: 'https://custom.ai',
      embeddingApiKey: 'user-key',
      embeddingModel: 'custom-model',
    });
    assert.equal(settings.apiUrl, 'https://custom.ai');
    assert.equal(settings.apiKey, 'user-key');
    assert.equal(settings.model, 'custom-model');
  });

  test('getAiConfig returns null when no config exists', async () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    assert.equal(agent.getAiConfig('key1'), null);
  });

  test('getAiConfig returns config after setAiConfig', async () => {
    const db = createDb();
    setAiConfig(db, 'key1', {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingApiKey: 'sk-test-123',
    });
    const agent = new AgentEngine(db);
    const cfg = agent.getAiConfig('key1');
    assert.equal(cfg.embeddingProvider, 'openai');
    assert.equal(cfg.embeddingModel, 'text-embedding-3-small');
    assert.equal(cfg.embeddingApiKey, 'sk-test-123');
  });

  test('isServerEmbeddingAvailable reflects env', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    const orig = process.env.EMBEDDING_API_KEY;
    try {
      delete process.env.EMBEDDING_API_KEY;
      assert.equal(agent.isServerEmbeddingAvailable(), false);
    } finally {
      if (orig !== undefined) process.env.EMBEDDING_API_KEY = orig;
    }
  });

  test('cosineSimilarity returns 1 for identical vectors', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    assert.equal(agent.cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  });

  test('cosineSimilarity returns 0 for orthogonal vectors', () => {
    const db = createDb();
    const agent = new AgentEngine(db);
    assert.equal(agent.cosineSimilarity([1, 0], [0, 1]), 0);
  });
});

describe('agent DB helpers', () => {
  let runMigrations, insertAgentEvent, getRecentAgentEvents;

  before(async () => {
    ({ runMigrations, insertAgentEvent, getRecentAgentEvents } = await import('../src/db.js'));
  });

  function createDb() {
    const db = new Database(':memory:');
    runMigrations(db);
    return db;
  }

  test('insertAgentEvent and retrieve', () => {
    const db = createDb();
    insertAgentEvent(db, 'key1', {
      event_type: 'scene_description',
      description: 'Speaker at podium',
      confidence: 0.95,
      context: { source: 'preview' },
    });
    const events = getRecentAgentEvents(db, 'key1');
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'scene_description');
    assert.equal(events[0].description, 'Speaker at podium');
  });

  test('getRecentAgentEvents respects limit', () => {
    const db = createDb();
    for (let i = 0; i < 10; i++) {
      insertAgentEvent(db, 'key1', {
        event_type: 'test',
        description: `Event ${i}`,
      });
    }
    const events = getRecentAgentEvents(db, 'key1', 3);
    assert.equal(events.length, 3);
  });

  test('migrations are idempotent', () => {
    const db = createDb();
    runMigrations(db);
    const events = getRecentAgentEvents(db, 'key1');
    assert.deepEqual(events, []);
  });

  test('events are isolated by API key', () => {
    const db = createDb();
    insertAgentEvent(db, 'key1', { event_type: 'test', description: 'A' });
    insertAgentEvent(db, 'key2', { event_type: 'test', description: 'B' });
    assert.equal(getRecentAgentEvents(db, 'key1').length, 1);
    assert.equal(getRecentAgentEvents(db, 'key2').length, 1);
  });
});

// Phase 5 & 6 tests
describe('AgentEngine — Phase 5 & 6', () => {
  async function createDb() {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    const { runMigrations } = await import('../src/db.js');
    const { runAiMigrations } = await import('../src/ai-config.js');
    runMigrations(db);
    runAiMigrations(db);
    return db;
  }

  test('generateTemplate returns fallback when no AI config', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const agent = new AgentEngine(db);
    const tpl = await agent.generateTemplate('key1', 'A lower-third with speaker name');
    assert.ok(tpl && Array.isArray(tpl.layers));
    assert.equal(tpl.layers.length, 0);
  });

  test('generateTemplate returns fallback when provider is none', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const { setAiConfig } = await import('../src/ai-config.js');
    setAiConfig(db, 'key1', { embeddingProvider: 'none' });
    const agent = new AgentEngine(db);
    const tpl = await agent.generateTemplate('key1', 'Lower third');
    assert.ok(tpl && Array.isArray(tpl.layers));
    assert.equal(tpl.layers.length, 0);
  });

  test('editTemplate returns fallback when no AI config', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const agent = new AgentEngine(db);
    const original = { background: 'transparent', width: 1920, height: 1080, groups: [], layers: [] };
    const out = await agent.editTemplate('key1', original, 'Make background darker');
    assert.deepEqual(out, original);
  });

  test('editTemplate returns fallback when provider is none', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const { setAiConfig } = await import('../src/ai-config.js');
    setAiConfig(db, 'key1', { embeddingProvider: 'none' });
    const agent = new AgentEngine(db);
    const original = { background: 'transparent', width: 1920, height: 1080, groups: [], layers: [] };
    const out = await agent.editTemplate('key1', original, 'Change color');
    assert.deepEqual(out, original);
  });

  test('suggestStyles returns empty array when no AI config', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const agent = new AgentEngine(db);
    const out = await agent.suggestStyles('key1', { background: 'transparent', layers: [] });
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 0);
  });

  test('generateRundown returns empty string when no AI config', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const agent = new AgentEngine(db);
    const out = await agent.generateRundown('key1', 'A church service');
    assert.equal(out, '');
  });

  test('generateRundown returns empty string when provider is none', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const { setAiConfig } = await import('../src/ai-config.js');
    setAiConfig(db, 'key1', { embeddingProvider: 'none' });
    const agent = new AgentEngine(db);
    const out = await agent.generateRundown('key1', 'Service');
    assert.equal(out, '');
  });

  test('editRundown returns original content when no AI config', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const agent = new AgentEngine(db);
    const content = 'Original rundown';
    const out = await agent.editRundown('key1', content, 'Add a pause');
    assert.equal(out, content);
  });

  test('editRundown returns original content when provider is none', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const { setAiConfig } = await import('../src/ai-config.js');
    setAiConfig(db, 'key1', { embeddingProvider: 'none' });
    const agent = new AgentEngine(db);
    const content = 'Original rundown';
    const out = await agent.editRundown('key1', content, 'Add a pause');
    assert.equal(out, content);
  });

  test('_callChatCompletion opts.maxTokens and opts.temperature are forwarded', async () => {
    const db = await createDb();
    const { AgentEngine } = await import('../src/agent-engine.js');
    const agent = new AgentEngine(db);
    let seenBody = null;
    const origFetch = global.fetch;
    global.fetch = async (url, { method, headers, body }) => {
      seenBody = JSON.parse(body);
      return {
        ok: true,
        json: async () => ({ choices: [ { message: { content: 'hi' } } ] }),
      };
    };
    try {
      const res = await agent._callChatCompletion({ apiUrl: 'https://api.test', apiKey: 'k', model: 'm' }, 'sys', 'usr', { temperature: 0.55, maxTokens: 1234 });
      assert.equal(res, 'hi');
      assert.equal(seenBody.temperature, 0.55);
      assert.equal(seenBody.max_tokens, 1234);
    } finally {
      global.fetch = origFetch;
    }
  });
});
