import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db/index.js';
import { ensurePluginTables } from './helpers/plugin-tables.js';
import { getAiConfig, getAiConfigRaw, setAiConfig, VALID_PROVIDERS } from '../src/ai/config.js';

const opened = [];
after(async () => { for (const d of opened) await d.close(); });

async function createDb() {
  const db = await initDb(':memory:');
  opened.push(db);
  ensurePluginTables(db);
  return db;
}

describe('AI config DB', () => {
  test('getAiConfig returns null for unconfigured key', async () => {
    const db = await createDb();
    assert.equal(await getAiConfig(db, 'key1'), null);
  });

  test('setAiConfig creates new config', async () => {
    const db = await createDb();
    await setAiConfig(db, 'key1', {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingApiKey: 'sk-test-123',
      embeddingApiUrl: '',
      fuzzyThreshold: 0.8,
    });
    const config = await getAiConfig(db, 'key1');
    assert.ok(config);
    assert.equal(config.embeddingProvider, 'openai');
    assert.equal(config.embeddingModel, 'text-embedding-3-small');
    // API key should be masked
    assert.equal(config.embeddingApiKey, '***');
    assert.equal(config.fuzzyThreshold, 0.8);
  });

  test('getAiConfigRaw returns actual API key', async () => {
    const db = await createDb();
    await setAiConfig(db, 'key1', {
      embeddingProvider: 'openai',
      embeddingApiKey: 'sk-secret-key',
    });
    const raw = await getAiConfigRaw(db, 'key1');
    assert.equal(raw.embeddingApiKey, 'sk-secret-key');
  });

  test('setAiConfig updates existing config', async () => {
    const db = await createDb();
    await setAiConfig(db, 'key1', { embeddingProvider: 'openai', embeddingApiKey: 'sk-old' });
    await setAiConfig(db, 'key1', { embeddingProvider: 'custom', fuzzyThreshold: 0.9 });

    const config = await getAiConfigRaw(db, 'key1');
    assert.equal(config.embeddingProvider, 'custom');
    assert.equal(config.fuzzyThreshold, 0.9);
    // API key should NOT be overwritten since we didn't pass it
    assert.equal(config.embeddingApiKey, 'sk-old');
  });

  test('setAiConfig with no updates is a no-op', async () => {
    const db = await createDb();
    await setAiConfig(db, 'key1', { embeddingProvider: 'openai' });
    await setAiConfig(db, 'key1', {}); // empty update
    const config = await getAiConfig(db, 'key1');
    assert.equal(config.embeddingProvider, 'openai');
  });

  test('different API keys are isolated', async () => {
    const db = await createDb();
    await setAiConfig(db, 'key1', { embeddingProvider: 'openai' });
    await setAiConfig(db, 'key2', { embeddingProvider: 'custom' });

    assert.equal((await getAiConfig(db, 'key1')).embeddingProvider, 'openai');
    assert.equal((await getAiConfig(db, 'key2')).embeddingProvider, 'custom');
  });

  test('VALID_PROVIDERS includes expected values', () => {
    assert.ok(VALID_PROVIDERS.includes('none'));
    assert.ok(VALID_PROVIDERS.includes('server'));
    assert.ok(VALID_PROVIDERS.includes('openai'));
    assert.ok(VALID_PROVIDERS.includes('custom'));
  });
});
