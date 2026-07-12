/**
 * Tests for GET /events/stream — the unified external event surface over the
 * shared EventBus. Covers: JWT member access, external-token scope gating
 * (events:read) and per-topic narrowing (tokenAllowsTopic), and the ?topics
 * filter. The bespoke per-plugin SSE endpoints are covered by their own suites.
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
import { createEventsStreamRouter } from '../src/routes/events-stream.js';

const JWT_SECRET = 'test-events-stream-secret';

let server, baseUrl, db, bus, apiKey;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  bus = new EventBus();
  apiKey = createKey(db, { owner: 'StreamUser' }).key;

  const app = express();
  app.use(
    '/events/stream',
    createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'events:read' }),
    createEventsStreamRouter(bus),
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
  // Session-style JWT: the project-access middleware treats { apiKey } as a
  // session credential and grants full (unfiltered) project access.
  return jwt.sign({ apiKey }, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Open an SSE connection, wait for `connected`, run `onReady` (to publish), then
 * collect frames for a short window and abort. Returns parsed { event, data }[]
 * excluding the connected frame.
 */
async function collectStream(url, { onReady, windowMs = 120 } = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  if (res.status !== 200) {
    controller.abort();
    return { status: res.status, events: [] };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  let ready = false;

  const readLoop = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx + 2);
          buffer = buffer.slice(idx + 2);
          const m = /^event: (.*)\ndata: (.*)\n\n$/s.exec(frame);
          if (!m) continue;
          if (m[1] === 'connected') {
            ready = true;
            continue;
          }
          events.push({ event: m[1], data: JSON.parse(m[2]) });
        }
      }
    } catch { /* aborted */ }
  })();

  // wait for connected
  const t0 = Date.now();
  while (!ready && Date.now() - t0 < 1000) await new Promise((r) => setTimeout(r, 5));
  if (onReady) onReady();
  await new Promise((r) => setTimeout(r, windowMs));
  controller.abort();
  await readLoop;
  return { status: 200, events };
}

describe('GET /events/stream', () => {
  it('401s without a token', async () => {
    const res = await fetch(`${baseUrl}/events/stream`);
    assert.equal(res.status, 401);
  });

  it('member JWT receives canonical envelopes, filtered by ?topics', async () => {
    const url = `${baseUrl}/events/stream?topics=dsk.*&token=${memberToken()}`;
    const { events } = await collectStream(url, {
      onReady: () => {
        bus.publish(apiKey, 'dsk.graphics_changed', { layers: ['a'] });
        bus.publish(apiKey, 'variable.updated', { name: 'x' }); // filtered out by ?topics
      },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'dsk.graphics_changed');
    assert.equal(events[0].data.topic, 'dsk.graphics_changed');
    assert.equal(events[0].data.projectId, apiKey);
    assert.deepEqual(events[0].data.data, { layers: ['a'] });
  });

  it('external token scoped events:read + dsk.* only sees dsk.* (even without ?topics)', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'dsk-only', scopes: ['events:read', 'dsk.*'] });
    const url = `${baseUrl}/events/stream?token=${token}`;
    const { events } = await collectStream(url, {
      onReady: () => {
        bus.publish(apiKey, 'dsk.text', { text: 'hi' });
        bus.publish(apiKey, 'cue.fired', { id: 1 }); // not permitted by scopes
      },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'dsk.text');
  });

  it('external token without events:read is 403', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'no-events', scopes: ['dsk.*'] });
    const res = await fetch(`${baseUrl}/events/stream?token=${token}`);
    assert.equal(res.status, 403);
  });

  it('unscoped external token (NULL scopes) receives everything', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'full' }); // no scopes => full access
    const url = `${baseUrl}/events/stream?token=${token}`;
    const { events } = await collectStream(url, {
      onReady: () => {
        bus.publish(apiKey, 'dsk.text', { text: 'hi' });
        bus.publish(apiKey, 'cue.fired', { id: 1 });
      },
    });
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.event).sort(), ['cue.fired', 'dsk.text']);
  });

  it('another project\'s events are not delivered', async () => {
    const url = `${baseUrl}/events/stream?token=${memberToken()}`;
    const { events } = await collectStream(url, {
      onReady: () => bus.publish('some-other-project', 'dsk.text', { text: 'nope' }),
    });
    assert.equal(events.length, 0);
  });
});
