/**
 * Feature flags for capabilities that existed before they had a flag
 * (broadcast-platforms, mcp-access, ai-agent): codes, deps, policies and the
 * backfill that keeps existing projects working.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { createKey } from '../src/db/keys.js';
import { createUser } from '../src/db/users.js';
import {
  KNOWN_FEATURE_CODES, BINARY_ONLY_FEATURES, FEATURE_DEPS,
  applyFeatureDeps, backfillCapabilityFeatures, hasFeature,
} from '../src/db/project-features.js';

const NEW_CODES = ['broadcast-platforms', 'mcp-access', 'ai-agent'];

async function addUser(db, email) {
  return (await createUser(db, { email, passwordHash: 'x' })).id;
}

describe('capability feature flags', () => {
  it('are known feature codes', async () => {
    for (const code of NEW_CODES) assert.ok(KNOWN_FEATURE_CODES.has(code), code);
  });

  it('ai-agent is operator-granted only; the others can be self-service', async () => {
    assert.ok(BINARY_ONLY_FEATURES.has('ai-agent'));
    assert.ok(!BINARY_ONLY_FEATURES.has('broadcast-platforms'));
    assert.ok(!BINARY_ONLY_FEATURES.has('mcp-access'));
  });

  it('broadcast-platforms needs captions', async () => {
    assert.deepEqual(FEATURE_DEPS['broadcast-platforms'], ['captions']);
    const map = { 'broadcast-platforms': true };
    assert.deepEqual(applyFeatureDeps(map), ['captions']);
  });

  it('seeds the site policies', async () => {
    const db = await initDb(':memory:');
    const mode = async code => (await db.prepare('SELECT mode FROM site_feature_policies WHERE feature_code = ?').get(code))?.mode;
    assert.equal(await mode('broadcast-platforms'), 'self_service');
    assert.equal(await mode('mcp-access'), 'self_service');
    assert.equal(await mode('ai-agent'), 'denied');
  });
});

describe('backfillCapabilityFeatures', () => {
  let db, userId, key;
  beforeEach(async () => {
    db = await initDb(':memory:');
    userId = await addUser(db, 'a@example.com');
    key = (await createKey(db, { owner: "Owner", user_id: userId })).key;
  });

  it('does nothing for a project that uses none of them', async () => {
    assert.deepEqual(await backfillCapabilityFeatures(db), { projects: 0, users: 0 });
    for (const code of NEW_CODES) assert.equal(await hasFeature(db, key, code), false);
  });

  it('enables mcp-access for a project with a live token, not a revoked one', async () => {
    const otherKey = (await createKey(db, { owner: "B", user_id: userId })).key;
    await db.prepare("INSERT INTO mcp_tokens (api_key, label, token_hash) VALUES (?, 'a', 'h1')").run(key);
    await db.prepare("INSERT INTO mcp_tokens (api_key, label, token_hash, revoked_at) VALUES (?, 'b', 'h2', datetime('now'))").run(otherKey);
    const added = await backfillCapabilityFeatures(db);
    assert.equal(added.projects, 1);
    assert.equal(await hasFeature(db, key, 'mcp-access'), true);
    assert.equal(await hasFeature(db, otherKey, 'mcp-access'), false);
    assert.equal((await db.prepare("SELECT enabled FROM user_features WHERE user_id = ? AND feature_code = 'mcp-access'").get(userId))?.enabled, 1);
  });

  it('is idempotent and keeps an explicit disable', async () => {
    await db.prepare("INSERT INTO mcp_tokens (api_key, label, token_hash) VALUES (?, 'a', 'h1')").run(key);
    await db.prepare("INSERT INTO project_features (api_key, feature_code, enabled) VALUES (?, 'mcp-access', 0)").run(key);
    assert.equal((await backfillCapabilityFeatures(db)).projects, 0);
    assert.equal(await hasFeature(db, key, 'mcp-access'), false);
    await db.prepare("DELETE FROM project_features WHERE api_key = ? AND feature_code = 'mcp-access'").run(key);
    assert.equal((await backfillCapabilityFeatures(db)).projects, 1);
    assert.equal((await backfillCapabilityFeatures(db)).projects, 0);
  });

  it('enables ai-agent for a project with an enabled AI role or an embedding provider', async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ai_config (api_key TEXT PRIMARY KEY, embedding_provider TEXT NOT NULL DEFAULT 'none')`);
    await db.prepare("INSERT INTO ai_config (api_key, embedding_provider) VALUES (?, 'openai')").run(key);
    await backfillCapabilityFeatures(db);
    assert.equal(await hasFeature(db, key, 'ai-agent'), true);
  });

  it('skips tables that do not exist', async () => {
    await db.exec('DROP TABLE mcp_tokens');
    await assert.doesNotReject(() => backfillCapabilityFeatures(db));
  });
});
