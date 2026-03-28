import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// In-memory SQLite for realistic testing
// ---------------------------------------------------------------------------

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping AI config tests');
  process.exit(0);
}

let runAiMigrations, getAiConfig, getAiConfigRaw, setAiConfig, VALID_PROVIDERS;

before(async () => {
  ({ runAiMigrations, getAiConfig, getAiConfigRaw, setAiConfig, VALID_PROVIDERS } = await import('../src/ai/config.js'));
});

function createDb() {
  const db = new Database(':memory:');
  runAiMigrations(db);
  return db;
}

describe('AI config DB', () => {
  test('getAiConfig returns null for unconfigured key', () => {
    const db = createDb();
    assert.equal(getAiConfig(db, 'key1'), null);
  });

  test('setAiConfig creates new config', () => {
    const db = createDb();
    setAiConfig(db, 'key1', {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingApiKey: 'sk-test-123',
      embeddingApiUrl: '',
      fuzzyThreshold: 0.8,
    });
    const config = getAiConfig(db, 'key1');
    assert.ok(config);
    assert.equal(config.embeddingProvider, 'openai');
    assert.equal(config.embeddingModel, 'text-embedding-3-small');
    // API key should be masked
    assert.equal(config.embeddingApiKey, '***');
    assert.equal(config.fuzzyThreshold, 0.8);
  });

  test('getAiConfigRaw returns actual API key', () => {
    const db = createDb();
    setAiConfig(db, 'key1', {
      embeddingProvider: 'openai',
      embeddingApiKey: 'sk-secret-key',
    });
    const raw = getAiConfigRaw(db, 'key1');
    assert.equal(raw.embeddingApiKey, 'sk-secret-key');
  });

  test('setAiConfig updates existing config', () => {
    const db = createDb();
    setAiConfig(db, 'key1', { embeddingProvider: 'openai', embeddingApiKey: 'sk-old' });
    setAiConfig(db, 'key1', { embeddingProvider: 'custom', fuzzyThreshold: 0.9 });

    const config = getAiConfigRaw(db, 'key1');
    assert.equal(config.embeddingProvider, 'custom');
    assert.equal(config.fuzzyThreshold, 0.9);
    // API key should NOT be overwritten since we didn't pass it
    assert.equal(config.embeddingApiKey, 'sk-old');
  });

  test('setAiConfig with no updates is a no-op', () => {
    const db = createDb();
    setAiConfig(db, 'key1', { embeddingProvider: 'openai' });
    setAiConfig(db, 'key1', {}); // empty update
    const config = getAiConfig(db, 'key1');
    assert.equal(config.embeddingProvider, 'openai');
  });

  test('different API keys are isolated', () => {
    const db = createDb();
    setAiConfig(db, 'key1', { embeddingProvider: 'openai' });
    setAiConfig(db, 'key2', { embeddingProvider: 'custom' });

    assert.equal(getAiConfig(db, 'key1').embeddingProvider, 'openai');
    assert.equal(getAiConfig(db, 'key2').embeddingProvider, 'custom');
  });

  test('VALID_PROVIDERS includes expected values', () => {
    assert.ok(VALID_PROVIDERS.includes('none'));
    assert.ok(VALID_PROVIDERS.includes('server'));
    assert.ok(VALID_PROVIDERS.includes('openai'));
    assert.ok(VALID_PROVIDERS.includes('custom'));
  });
});
