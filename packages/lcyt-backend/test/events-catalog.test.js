import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createEventsCatalogRouter, EVENT_TOPIC_CATALOG } from '../src/routes/events-catalog.js';

let server, baseUrl;

before(() => new Promise((resolve) => {
  const app = express();
  app.use('/events/topics', createEventsCatalogRouter());
  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
}));

after(() => new Promise((resolve) => server.close(resolve)));

describe('GET /events/topics', () => {
  it('returns the baseScope gate and the topic list (public, no auth)', async () => {
    const res = await fetch(`${baseUrl}/events/topics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.baseScope.value, 'events:read');
    assert.ok(Array.isArray(body.topics) && body.topics.length > 0);
    assert.ok(body.topics.every(t => typeof t.topic === 'string' && typeof t.label === 'string'));
  });

  it('advertises the per-variable topic form via variable.* + example', () => {
    const variables = EVENT_TOPIC_CATALOG.topics.find(t => t.topic === 'variable.*');
    assert.ok(variables, 'catalog includes variable.*');
    assert.match(variables.example, /^variable\..+\.changed$/);
  });
});
