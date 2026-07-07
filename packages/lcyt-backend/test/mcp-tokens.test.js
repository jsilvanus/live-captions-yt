/**
 * Tests for personal MCP access tokens (plan/mcp):
 * db helpers (create/list/revoke/verify) and the /mcp-tokens router.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { createMcpToken, listMcpTokens, revokeMcpToken, verifyMcpToken } from '../src/db/mcp-tokens.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createMcpTokensRouter } from '../src/routes/mcp-tokens.js';

const JWT_SECRET = 'test-mcp-tokens-secret';

let server, baseUrl, db, apiKey, otherKey, token, otherToken;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/mcp-tokens', createMcpTokensRouter(db, auth));

  apiKey = createKey(db, { owner: 'McpUser' }).key;
  otherKey = createKey(db, { owner: 'OtherUser' }).key;
  token = jwt.sign({ sessionId: 's1', apiKey }, JWT_SECRET, { expiresIn: '1h' });
  otherToken = jwt.sign({ sessionId: 's2', apiKey: otherKey }, JWT_SECRET, { expiresIn: '1h' });

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

function bearer(tok = token) {
  return { Authorization: `Bearer ${tok}` };
}

describe('mcp-tokens db helpers', () => {
  it('createMcpToken returns a raw lcytmcp_ token and stores only a hash', () => {
    const { id, token: raw } = createMcpToken(db, apiKey, 'Helper test');
    assert.ok(id > 0);
    assert.match(raw, /^lcytmcp_[0-9a-f]{64}$/);
    const row = db.prepare('SELECT * FROM mcp_tokens WHERE id = ?').get(id);
    assert.notEqual(row.token_hash, raw);
    assert.equal(row.token_hash.length, 64); // sha256 hex
  });

  it('verifyMcpToken resolves the raw token to its api_key and stamps last_used_at', () => {
    const { token: raw } = createMcpToken(db, apiKey, 'Verify test');
    const hit = verifyMcpToken(db, raw);
    assert.equal(hit.apiKey, apiKey);
    assert.equal(hit.label, 'Verify test');
    const row = db.prepare('SELECT last_used_at FROM mcp_tokens WHERE id = ?').get(hit.id);
    assert.ok(row.last_used_at);
  });

  it('verifyMcpToken returns null for unknown and revoked tokens', () => {
    assert.equal(verifyMcpToken(db, 'lcytmcp_' + 'ab'.repeat(32)), null);
    assert.equal(verifyMcpToken(db, null), null);
    const { id, token: raw } = createMcpToken(db, apiKey, 'Revoke test');
    assert.equal(revokeMcpToken(db, apiKey, id), true);
    assert.equal(verifyMcpToken(db, raw), null);
  });

  it('revokeMcpToken refuses another project\'s token and double revocation', () => {
    const { id } = createMcpToken(db, apiKey, 'Ownership test');
    assert.equal(revokeMcpToken(db, otherKey, id), false);
    assert.equal(revokeMcpToken(db, apiKey, id), true);
    assert.equal(revokeMcpToken(db, apiKey, id), false);
  });

  it('listMcpTokens never includes hash or raw token', () => {
    const list = listMcpTokens(db, apiKey);
    assert.ok(list.length > 0);
    for (const t of list) {
      assert.deepEqual(
        Object.keys(t).sort(),
        ['createdAt', 'id', 'label', 'lastUsedAt', 'revokedAt'],
      );
    }
  });
});

describe('POST /mcp-tokens', () => {
  it('creates a token and returns the raw value once', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: "Alice's Claude Desktop" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.token, /^lcytmcp_/);
  });

  it('rejects a missing label', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'No auth' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('GET /mcp-tokens', () => {
  it('lists only the session project\'s tokens, without raw values', async () => {
    await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { ...bearer(otherToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Other project token' }),
    });
    const res = await fetch(`${baseUrl}/mcp-tokens`, { headers: bearer() });
    assert.equal(res.status, 200);
    const { tokens } = await res.json();
    assert.ok(tokens.length > 0);
    for (const t of tokens) {
      assert.equal(t.token, undefined);
      assert.notEqual(t.label, 'Other project token');
    }
  });
});

describe('DELETE /mcp-tokens/:id', () => {
  it('revokes an owned token; the token stops verifying', async () => {
    const createRes = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'To revoke' }),
    });
    const { id, token: raw } = await createRes.json();
    const res = await fetch(`${baseUrl}/mcp-tokens/${id}`, { method: 'DELETE', headers: bearer() });
    assert.equal(res.status, 200);
    assert.equal(verifyMcpToken(db, raw), null);
    const list = listMcpTokens(db, apiKey);
    assert.ok(list.find((t) => t.id === id).revokedAt);
  });

  it('404s on another project\'s token and on unknown ids', async () => {
    const createRes = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { ...bearer(otherToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Not yours' }),
    });
    const { id } = await createRes.json();
    const res = await fetch(`${baseUrl}/mcp-tokens/${id}`, { method: 'DELETE', headers: bearer() });
    assert.equal(res.status, 404);
    const res2 = await fetch(`${baseUrl}/mcp-tokens/999999`, { method: 'DELETE', headers: bearer() });
    assert.equal(res2.status, 404);
  });
});
