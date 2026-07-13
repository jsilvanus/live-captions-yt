/**
 * Tests for POST /events — external event publishing (Phase 3).
 * Covers: external.* namespace fencing, internal topic rejection, scope
 * checking, size limits, rate limits, and provenance stamping.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventBus } from 'lcyt/event-bus';
import { initDb, createKey } from '../src/db.js';
import { createMcpToken } from '../src/db/mcp-tokens.js';
import { createProjectAccessMiddleware } from '../src/middleware/project-access.js';
import { createEventsPublishRouter } from '../src/routes/events-publish.js';

const JWT_SECRET = 'test-events-publish-secret';

let server, baseUrl, db, bus, apiKey;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  bus = new EventBus();
  apiKey = createKey(db, { owner: 'PublishUser' }).key;

  const app = express();
  app.use(express.json());
  app.use(
    '/events',
    createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'events:write' }),
    createEventsPublishRouter(bus),
  );
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

function memberToken() {
  return jwt.sign({ apiKey }, JWT_SECRET, { expiresIn: '1h' });
}

async function postEvent(body, token) {
  const authToken = token || memberToken();
  const res = await fetch(`${baseUrl}/events?token=${authToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /events — external event publishing', () => {
  it('requires events:write scope', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'read-only', scopes: ['events:read'] });
    const res = await fetch(`${baseUrl}/events?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'external.test', data: {} }),
    });
    assert.equal(res.status, 403);
  });

  it('publishes external.* events successfully', async () => {
    const received = [];
    const unsub = bus.subscribe(apiKey, ['external.*'], (env) => received.push(env));

    const { token } = createMcpToken(db, apiKey, { label: 'writer', scopes: ['events:write'] });
    const { status, body } = await postEvent({ topic: 'external.trigger', data: { key: 'value' } }, token);

    assert.equal(status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.topic, 'external.trigger');
    assert.equal(received.length, 1);
    assert.equal(received[0].topic, 'external.trigger');
    assert.deepEqual(received[0].data, { key: 'value' });
    assert.equal(received[0].source, 'external');
    unsub();
  });

  it('rejects internal topic domains', async () => {
    const internalTopics = ['caption.sent', 'dsk.changed', 'cue.fired', 'session.closed', 'role.action', 'variable.x', 'stt.transcript', 'bridge.cmd'];
    for (const topic of internalTopics) {
      const { status, body } = await postEvent({ topic, data: {} });
      assert.equal(status, 403, `Expected 403 for ${topic}`);
      assert(body.error.includes('internal') || body.error.includes('external.*'), `Error message for ${topic}: ${body.error}`);
    }
  });

  it('rejects missing topic', async () => {
    const { status } = await postEvent({ data: {} });
    assert.equal(status, 400);
  });

  it('enforces payload size limit', async () => {
    const bigData = { x: 'A'.repeat(5000) };
    const { status, body } = await postEvent({ topic: 'external.big', data: bigData });
    assert.equal(status, 413);
    assert(body.error.includes('limit'));
  });

  it('stamps provenance on published events', async () => {
    const received = [];
    const unsub = bus.subscribe(apiKey, ['external.*'], (env) => received.push(env));

    const { token, id: tokenId } = createMcpToken(db, apiKey, { label: 'stamped', scopes: ['events:write'] });
    await postEvent({ topic: 'external.stamped', data: { test: 1 } }, token);

    assert.equal(received.length, 1);
    assert.equal(received[0].source, 'external');
    assert.equal(received[0].tokenId, tokenId);
    unsub();
  });

  it('allows null data', async () => {
    const { status, body } = await postEvent({ topic: 'external.null' });
    assert.equal(status, 202);
    assert.equal(body.ok, true);
  });

  it('allows session JWT members', async () => {
    const { status } = await postEvent({ topic: 'external.member', data: { from: 'member' } });
    assert.equal(status, 202);
  });
});
