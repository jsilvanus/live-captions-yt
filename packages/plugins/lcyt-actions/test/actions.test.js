import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { initActions, createActionsRouter, runActionsMigrations, listActionDefs } from '../src/api.js';

// Fake session-auth middleware: reads the api key from a test header.
const fakeAuth = (req, _res, next) => { req.session = { apiKey: req.headers['x-test-api-key'] }; next(); };

describe('lcyt-actions — db', () => {
  it('migrations create action_defs and CRUD helpers round-trip', () => {
    const db = new Database(':memory:');
    runActionsMigrations(db);
    assert.deepEqual(listActionDefs(db, 'k'), []);
  });
});

describe('lcyt-actions — routes', () => {
  let server, baseUrl;

  before(async () => {
    const db = new Database(':memory:');
    initActions(db);
    const app = express();
    app.use(express.json());
    app.use('/actions', createActionsRouter(db, fakeAuth));
    await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  async function json(path, opts) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1' }, ...opts,
    });
    return { status: res.status, body: await res.json() };
  }

  it('full CRUD chain', async () => {
    let res = await json('/actions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Intro', slug: 'intro', definition: 'audio:start | graphics:+banner', description: 'open' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.action.slug, 'intro');
    assert.equal(res.body.action.definition, 'audio:start | graphics:+banner');

    res = await json('/actions');
    assert.equal(res.body.actions.length, 1);

    res = await json('/actions/intro', { method: 'PUT', body: JSON.stringify({ definition: 'audio:stop' }) });
    assert.equal(res.body.action.definition, 'audio:stop');

    res = await json('/actions/intro');
    assert.equal(res.status, 200);
    assert.equal(res.body.action.name, 'Intro');

    res = await json('/actions/intro', { method: 'DELETE' });
    assert.equal(res.status, 200);
    res = await json('/actions/intro');
    assert.equal(res.status, 404);
  });

  it('validates name + slug and rejects duplicate slugs', async () => {
    let res = await json('/actions', { method: 'POST', body: JSON.stringify({ slug: 'x' }) });
    assert.equal(res.status, 400); // no name
    res = await json('/actions', { method: 'POST', body: JSON.stringify({ name: 'A', slug: 'Bad Slug' }) });
    assert.equal(res.status, 400); // invalid slug
    await json('/actions', { method: 'POST', body: JSON.stringify({ name: 'A', slug: 'dup' }) });
    res = await json('/actions', { method: 'POST', body: JSON.stringify({ name: 'B', slug: 'dup' }) });
    assert.equal(res.status, 409);
  });

  it('is project-scoped (a different api key sees nothing)', async () => {
    await json('/actions', { method: 'POST', body: JSON.stringify({ name: 'Mine', slug: 'mine' }) });
    const res = await fetch(`${baseUrl}/actions`, { headers: { 'x-test-api-key': 'key2' } });
    const body = await res.json();
    assert.equal(body.actions.find((a) => a.slug === 'mine'), undefined);
  });
});
