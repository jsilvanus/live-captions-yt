import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createCueRouter } from '../src/routes/cues.js';
import { runMigrations } from '../src/db.js';

describe('cue rules — executable action.run authoring guard', () => {
  let server, baseUrl, db;
  const seen = [];
  before(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    const app = express();
    app.use(express.json());
    const auth = (req, _res, next) => { req.session = { apiKey: 'k' }; next(); };
    const engine = { invalidate() {}, setInlineSnapshot() {} };
    const authoringGuard = (_req, apiKey, expr) => {
      seen.push([apiKey, expr]);
      return typeof expr === 'string' && expr.includes('camera:') ? { status: 403, error: 'setup tier required' } : null;
    };
    app.use('/cues', createCueRouter(db, auth, engine, { authoringGuard }));
    await new Promise((r) => { server = app.listen(0, r); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => { db.close(); server.close(r); }));
  const send = (method, path, body) => fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('asks the guard about action.run on create and update', async () => {
    let res = await send('POST', '/cues/rules', { name: 'a', pattern: 'amen', action: { run: 'audio:start' } });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    res = await send('POST', '/cues/rules', { name: 'b', pattern: 'amen', action: { run: 'camera:a.b' } });
    assert.equal(res.status, 403);
    res = await send('PUT', `/cues/rules/${id}`, { action: { run: 'camera:a.b' } });
    assert.equal(res.status, 403);
    assert.deepEqual(seen.at(-1), ['k', 'camera:a.b']);
  });

  it('rejects a non-string run and leaves descriptive actions alone', async () => {
    assert.equal((await send('POST', '/cues/rules', { name: 'c', pattern: 'x', action: { run: 5 } })).status, 400);
    const before = seen.length;
    assert.equal((await send('POST', '/cues/rules', { name: 'd', pattern: 'x', action: { type: 'goto' } })).status, 201);
    assert.equal(seen[before][1], undefined);
  });
});
