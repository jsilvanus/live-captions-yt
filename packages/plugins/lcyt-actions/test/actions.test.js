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

describe('lcyt-actions — POST /actions/run', () => {
  let server, baseUrl, role = true, runs;
  before(async () => {
    const db = new Database(':memory:');
    initActions(db);
    runs = [];
    const executor = {
      run: async (apiKey, target, opts) => {
        runs.push({ apiKey, target, opts });
        if (target.ref === 'ghost') return { ok: false, code: 'not_found', error: 'Unknown named action', runId: 'r' };
        return { ok: true, runId: 'r', steps: [], clientAtoms: [], warnings: [] };
      },
    };
    const userAuth = (req, _res, next) => {
      req.session = { apiKey: 'key1' };
      if (req.headers['x-test-user']) req.user = { userId: 7 };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use('/actions', createActionsRouter(db, userAuth, { executor, checkProjectRole: () => role }));
    app.use('/noexec', createActionsRouter(db, userAuth));
    await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));
  const post = async (path, body, headers = {}) => {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('runs an expression for the session project', async () => {
    const r = await post('/actions/run', { expr: 'camera:a.b', stopOnError: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(runs.at(-1), { apiKey: 'key1', target: { ref: undefined, expr: 'camera:a.b' }, opts: { source: 'api', stopOnError: true } });
  });

  it('400 without ref/expr, 404 for unknown ref, 503 without executor', async () => {
    assert.equal((await post('/actions/run', {})).status, 400);
    assert.equal((await post('/actions/run', { ref: 'ghost' })).status, 404);
    assert.equal((await post('/noexec/run', { ref: 'x' })).status, 503);
  });

  it('user callers need the production tier', async () => {
    role = false;
    assert.equal((await post('/actions/run', { ref: 'x' }, { 'x-test-user': '1' })).status, 403);
    assert.equal((await post('/actions/run', { ref: 'x' })).status, 200); // session caller
    role = true;
    assert.equal((await post('/actions/run', { ref: 'x' }, { 'x-test-user': '1' })).status, 200);
  });
});

describe('lcyt-actions — device authoring guard', () => {
  let server, baseUrl, allowed = false;
  before(async () => {
    const db = new Database(':memory:');
    initActions(db);
    const auth = (req, _res, next) => {
      req.session = { apiKey: 'key1' };
      if (req.headers['x-test-user']) req.user = { userId: 7 };
      next();
    };
    const executor = { run: async () => ({ ok: true, steps: [] }), isDeviceAtom: (m) => m === 'camera' };
    const app = express();
    app.use(express.json());
    app.use('/actions', createActionsRouter(db, auth, { executor, checkProjectRole: (tier) => tier === 'setup' && allowed }));
    await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));
  const send = async (method, path, body, user = true) => {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': '1' } : {}) }, body: JSON.stringify(body) });
    return res.status;
  };

  it('saving a device action needs the setup tier for user callers; other actions do not', async () => {
    assert.equal(await send('POST', '/actions', { name: 'A', slug: 'a', definition: 'audio:start' }), 201);
    assert.equal(await send('POST', '/actions', { name: 'B', slug: 'b', definition: 'audio:start | camera:pulpit.wide' }), 403);
    assert.equal(await send('PUT', '/actions/a', { definition: 'camera:pulpit.wide' }), 403);
    assert.equal(await send('POST', '/actions', { name: 'B', slug: 'b', definition: 'camera:pulpit.wide' }, false), 201); // session caller
    allowed = true;
    assert.equal(await send('PUT', '/actions/a', { definition: 'camera:pulpit.wide' }), 200);
  });
});
