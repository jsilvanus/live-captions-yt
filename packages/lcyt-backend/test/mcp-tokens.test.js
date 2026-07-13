/**
 * Tests for personal MCP access tokens (plan/mcp):
 * db helpers (create/list/update/revoke/verify) and the /mcp-tokens router.
 *
 * The router is project-settings style (user JWT Bearer + explicit
 * X-Api-Key header, same convention as /ai/models) — no live caption
 * session required, matching the Setup Hub "MCP access" card's usage.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { createMcpToken, listMcpTokens, updateMcpToken, revokeMcpToken, verifyMcpToken, tokenAllowsTopic } from '../src/db/mcp-tokens.js';
import { createUserAuthMiddleware } from '../src/middleware/user-auth.js';
import { createMcpTokensRouter } from '../src/routes/mcp-tokens.js';

const JWT_SECRET = 'test-mcp-tokens-secret';

let server, baseUrl, db, apiKey, otherKey, userToken;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const userAuth = createUserAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/external-tokens', createMcpTokensRouter(db, userAuth));
  app.use('/mcp-tokens', createMcpTokensRouter(db, userAuth));

  apiKey = createKey(db, { owner: 'McpUser' }).key;
  otherKey = createKey(db, { owner: 'OtherUser' }).key;
  userToken = jwt.sign({ type: 'user', userId: 1, email: 'mcp@example.com' }, JWT_SECRET, { expiresIn: '1h' });

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

function headers(key = apiKey) {
  return { Authorization: `Bearer ${userToken}`, 'X-Api-Key': key, 'Content-Type': 'application/json' };
}

describe('mcp-tokens db helpers', () => {
  it('createMcpToken returns a raw lcytmcp_ token and stores only a hash', () => {
    const { id, token: raw } = createMcpToken(db, apiKey, { label: 'Helper test' });
    assert.ok(id > 0);
    assert.match(raw, /^lcytmcp_[0-9a-f]{64}$/);
    const row = db.prepare('SELECT * FROM mcp_tokens WHERE id = ?').get(id);
    assert.notEqual(row.token_hash, raw);
    assert.equal(row.token_hash.length, 64); // sha256 hex
    assert.equal(row.active, 1);
  });

  it('verifyMcpToken resolves the raw token to its api_key and stamps last_used_at', () => {
    const { token: raw } = createMcpToken(db, apiKey, { label: 'Verify test' });
    const hit = verifyMcpToken(db, raw);
    assert.equal(hit.apiKey, apiKey);
    assert.equal(hit.label, 'Verify test');
    const row = db.prepare('SELECT last_used_at FROM mcp_tokens WHERE id = ?').get(hit.id);
    assert.ok(row.last_used_at);
  });

  it('verifyMcpToken returns null for unknown, deactivated, and revoked tokens', () => {
    assert.equal(verifyMcpToken(db, 'lcytmcp_' + 'ab'.repeat(32)), null);
    assert.equal(verifyMcpToken(db, null), null);

    const { id: revokedId, token: revokedRaw } = createMcpToken(db, apiKey, { label: 'Revoke test' });
    assert.equal(revokeMcpToken(db, apiKey, revokedId), true);
    assert.equal(verifyMcpToken(db, revokedRaw), null);

    const { id: deactivatedId, token: deactivatedRaw } = createMcpToken(db, apiKey, { label: 'Deactivate test' });
    updateMcpToken(db, apiKey, deactivatedId, { active: false });
    assert.equal(verifyMcpToken(db, deactivatedRaw), null);
  });

  it('revokeMcpToken refuses another project\'s token and double revocation', () => {
    const { id } = createMcpToken(db, apiKey, { label: 'Ownership test' });
    assert.equal(revokeMcpToken(db, otherKey, id), false);
    assert.equal(revokeMcpToken(db, apiKey, id), true);
    assert.equal(revokeMcpToken(db, apiKey, id), false);
  });

  it('updateMcpToken can relabel and toggle active without revoking', () => {
    const { id } = createMcpToken(db, apiKey, { label: 'Toggle test' });
    const deactivated = updateMcpToken(db, apiKey, id, { active: false });
    assert.equal(deactivated.active, false);
    assert.equal(deactivated.revokedAt, null);
    const relabeled = updateMcpToken(db, apiKey, id, { label: 'Renamed', active: true });
    assert.equal(relabeled.label, 'Renamed');
    assert.equal(relabeled.active, true);
  });

  it('listMcpTokens never includes hash or raw token, and excludes revoked rows', () => {
    const { id: revokedId } = createMcpToken(db, apiKey, { label: 'To exclude' });
    revokeMcpToken(db, apiKey, revokedId);
    const list = listMcpTokens(db, apiKey);
    assert.ok(list.length > 0);
    assert.ok(!list.find((t) => t.id === revokedId));
    for (const t of list) {
      assert.deepEqual(
        Object.keys(t).sort(),
        ['active', 'createdAt', 'createdByName', 'id', 'label', 'lastUsedAt', 'revokedAt'],
      );
    }
  });
});

describe('POST /external-tokens', () => {
  it('creates a token through the renamed external-token route', async () => {
    const res = await fetch(`${baseUrl}/external-tokens`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ label: 'External token route' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.token, /^lcytmcp_/);
  });
});

describe('POST /mcp-tokens', () => {
  it('creates a token and returns the raw value once', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ label: "Alice's Claude Desktop" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.token, /^lcytmcp_/);
    assert.equal(body.active, true);
  });

  it('rejects a missing label', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('persists a scopes array from the request body', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ label: 'Scoped', scopes: ['events:read', 'dsk.*'] }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    // The token now gates /events/stream: events:read granted, only dsk.* topics.
    const row = db.prepare('SELECT scopes FROM mcp_tokens WHERE id = ?').get(body.id);
    assert.deepEqual(JSON.parse(row.scopes), ['events:read', 'dsk.*']);
  });

  it('requires a user auth token', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'No auth' }),
    });
    assert.equal(res.status, 401);
  });

  it('requires an api key', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'No api key' }),
    });
    assert.equal(res.status, 400);
  });
});

describe('GET /mcp-tokens', () => {
  it('lists only the given project\'s tokens, without raw values', async () => {
    await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(otherKey),
      body: JSON.stringify({ label: 'Other project token' }),
    });
    const res = await fetch(`${baseUrl}/mcp-tokens`, { headers: headers() });
    assert.equal(res.status, 200);
    const { tokens } = await res.json();
    assert.ok(tokens.length > 0);
    for (const t of tokens) {
      assert.equal(t.token, undefined);
      assert.notEqual(t.label, 'Other project token');
    }
  });
});

describe('PATCH /mcp-tokens/:id', () => {
  it('toggles active without revoking', async () => {
    const createRes = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ label: 'To deactivate' }),
    });
    const { id, token: raw } = await createRes.json();
    const res = await fetch(`${baseUrl}/mcp-tokens/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ active: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.active, false);
    assert.equal(verifyMcpToken(db, raw), null);
    const list = await (await fetch(`${baseUrl}/mcp-tokens`, { headers: headers() })).json();
    assert.ok(list.tokens.find((t) => t.id === id));
  });

  it('404s on unknown ids', async () => {
    const res = await fetch(`${baseUrl}/mcp-tokens/999999`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ active: false }),
    });
    assert.equal(res.status, 404);
  });
});

describe('DELETE /mcp-tokens/:id', () => {
  it('revokes an owned token; the token stops verifying and drops off the list', async () => {
    const createRes = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ label: 'To revoke' }),
    });
    const { id, token: raw } = await createRes.json();
    const res = await fetch(`${baseUrl}/mcp-tokens/${id}`, { method: 'DELETE', headers: headers() });
    assert.equal(res.status, 200);
    assert.equal(verifyMcpToken(db, raw), null);
    const list = listMcpTokens(db, apiKey);
    assert.ok(!list.find((t) => t.id === id));
  });

  it('404s on another project\'s token and on unknown ids', async () => {
    const createRes = await fetch(`${baseUrl}/mcp-tokens`, {
      method: 'POST',
      headers: headers(otherKey),
      body: JSON.stringify({ label: 'Not yours' }),
    });
    const { id } = await createRes.json();
    const res = await fetch(`${baseUrl}/mcp-tokens/${id}`, { method: 'DELETE', headers: headers() });
    assert.equal(res.status, 404);
    const res2 = await fetch(`${baseUrl}/mcp-tokens/999999`, { method: 'DELETE', headers: headers() });
    assert.equal(res2.status, 404);
  });
});

describe('tokenAllowsTopic (event-bus topic scoping)', () => {
  it('null/empty scopes allow every topic (full access)', () => {
    assert.equal(tokenAllowsTopic(null, 'dsk.graphics_changed'), true);
    assert.equal(tokenAllowsTopic([], 'cue.fired'), true);
  });

  it('scopes with only resource:verb entries impose no topic restriction', () => {
    assert.equal(tokenAllowsTopic(['events:read'], 'dsk.graphics_changed'), true);
    assert.equal(tokenAllowsTopic(['events:read', 'dsk:read'], 'anything.at.all'), true);
  });

  it('a dotted-topic pattern narrows to matching topics', () => {
    assert.equal(tokenAllowsTopic(['events:read', 'dsk.*'], 'dsk.graphics_changed'), true);
    assert.equal(tokenAllowsTopic(['events:read', 'dsk.*'], 'dsk.text'), true);
    assert.equal(tokenAllowsTopic(['events:read', 'dsk.*'], 'cue.fired'), false);
    assert.equal(tokenAllowsTopic(['events:read', 'dsk.*'], 'dskx.y'), false);
  });

  it('exact topic pattern matches only that topic', () => {
    assert.equal(tokenAllowsTopic(['cue.fired'], 'cue.fired'), true);
    assert.equal(tokenAllowsTopic(['cue.fired'], 'cue.other'), false);
  });

  it('bare * allows any topic', () => {
    assert.equal(tokenAllowsTopic(['*'], 'literally.anything'), true);
  });

  it('accepts a JSON-string scope list (as stored)', () => {
    assert.equal(tokenAllowsTopic('["events:read","dsk.*"]', 'dsk.text'), true);
    assert.equal(tokenAllowsTopic('["events:read","dsk.*"]', 'cue.fired'), false);
  });
});
