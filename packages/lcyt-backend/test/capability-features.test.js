/**
 * Feature flags for capabilities that existed before they had a flag
 * (broadcast-platforms, mcp-access, ai-agent): codes, deps, policies and the
 * backfill that keeps existing projects working.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { createKey } from '../src/db/keys.js';
import {
  KNOWN_FEATURE_CODES, BINARY_ONLY_FEATURES, FEATURE_DEPS,
  applyFeatureDeps, backfillCapabilityFeatures, hasFeature,
} from '../src/db/project-features.js';

const NEW_CODES = ['broadcast-platforms', 'mcp-access', 'ai-agent'];

function addUser(db, email) {
  return Number(db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, 'x').lastInsertRowid);
}

describe('capability feature flags', () => {
  it('are known feature codes', () => {
    for (const code of NEW_CODES) assert.ok(KNOWN_FEATURE_CODES.has(code), code);
  });

  it('ai-agent is operator-granted only; the others can be self-service', () => {
    assert.ok(BINARY_ONLY_FEATURES.has('ai-agent'));
    assert.ok(!BINARY_ONLY_FEATURES.has('broadcast-platforms'));
    assert.ok(!BINARY_ONLY_FEATURES.has('mcp-access'));
  });

  it('broadcast-platforms needs captions', () => {
    assert.deepEqual(FEATURE_DEPS['broadcast-platforms'], ['captions']);
    const map = { 'broadcast-platforms': true };
    assert.deepEqual(applyFeatureDeps(map), ['captions']);
  });

  it('seeds the site policies', () => {
    const db = initDb(':memory:');
    const mode = code => db.prepare('SELECT mode FROM site_feature_policies WHERE feature_code = ?').get(code)?.mode;
    assert.equal(mode('broadcast-platforms'), 'self_service');
    assert.equal(mode('mcp-access'), 'self_service');
    assert.equal(mode('ai-agent'), 'denied');
  });
});

describe('backfillCapabilityFeatures', () => {
  let db, userId, key;
  beforeEach(() => {
    db = initDb(':memory:');
    userId = addUser(db, 'a@example.com');
    key = createKey(db, { owner: "Owner", user_id: userId }).key;
  });

  it('does nothing for a project that uses none of them', () => {
    assert.deepEqual(backfillCapabilityFeatures(db), { projects: 0, users: 0 });
    for (const code of NEW_CODES) assert.equal(hasFeature(db, key, code), false);
  });

  it('enables mcp-access for a project with a live token, not a revoked one', () => {
    const otherKey = createKey(db, { owner: "B", user_id: userId }).key;
    db.prepare("INSERT INTO mcp_tokens (api_key, label, token_hash) VALUES (?, 'a', 'h1')").run(key);
    db.prepare("INSERT INTO mcp_tokens (api_key, label, token_hash, revoked_at) VALUES (?, 'b', 'h2', datetime('now'))").run(otherKey);
    const added = backfillCapabilityFeatures(db);
    assert.equal(added.projects, 1);
    assert.equal(hasFeature(db, key, 'mcp-access'), true);
    assert.equal(hasFeature(db, otherKey, 'mcp-access'), false);
    assert.equal(db.prepare("SELECT enabled FROM user_features WHERE user_id = ? AND feature_code = 'mcp-access'").get(userId)?.enabled, 1);
  });

  it('is idempotent and keeps an explicit disable', () => {
    db.prepare("INSERT INTO mcp_tokens (api_key, label, token_hash) VALUES (?, 'a', 'h1')").run(key);
    db.prepare("INSERT INTO project_features (api_key, feature_code, enabled) VALUES (?, 'mcp-access', 0)").run(key);
    assert.equal(backfillCapabilityFeatures(db).projects, 0);
    assert.equal(hasFeature(db, key, 'mcp-access'), false);
    db.prepare("DELETE FROM project_features WHERE api_key = ? AND feature_code = 'mcp-access'").run(key);
    assert.equal(backfillCapabilityFeatures(db).projects, 1);
    assert.equal(backfillCapabilityFeatures(db).projects, 0);
  });

  it('enables ai-agent for a project with an enabled AI role or an embedding provider', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_config (api_key TEXT PRIMARY KEY, embedding_provider TEXT NOT NULL DEFAULT 'none')`);
    db.prepare("INSERT INTO ai_config (api_key, embedding_provider) VALUES (?, 'openai')").run(key);
    backfillCapabilityFeatures(db);
    assert.equal(hasFeature(db, key, 'ai-agent'), true);
  });

  it('skips tables that do not exist', () => {
    db.exec('DROP TABLE mcp_tokens');
    assert.doesNotThrow(() => backfillCapabilityFeatures(db));
  });
});
