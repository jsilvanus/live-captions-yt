import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { createCueRouter } from '../src/routes/cues.js';
import { runMigrations } from '../src/db.js';

let server;
let baseUrl;
let db;
let lastInlineSnapshot;

before(() => new Promise((resolve) => {
  db = new Database(':memory:');
  runMigrations(db);

  const app = express();
  app.use(express.json());

  const auth = (req, _res, next) => {
    req.session = { apiKey: 'cue-api-key' };
    next();
  };

  const engine = {
    invalidate() {},
    setInlineSnapshot(apiKey, snapshot) {
      lastInlineSnapshot = { apiKey, snapshot };
    },
  };

  app.use('/cues', createCueRouter(db, auth, engine));

  server = createServer(app);
  server.listen(0, () => {
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db?.close();
  server?.close(resolve);
}));

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function put(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/cues/rules', () => {
  test('accepts semantic, event_cue and sound cue match types', async () => {
    const cases = [
      ['semantic', 'prayer for healing'],
      ['event_cue', 'speaker stands up'],
      ['music_start', ''],
      ['music_stop', ''],
      ['silence', '5'],
    ];

    for (const [matchType, pattern] of cases) {
      const res = await post('/cues/rules', {
        name: `${matchType}-rule`,
        match_type: matchType,
        pattern,
        action: { type: 'event', label: matchType },
      });
      assert.equal(res.status, 201, `${matchType} should be accepted`);
    }
  });

  test('allows updating a sound cue to a new match type', async () => {
    const createRes = await post('/cues/rules', {
      name: 'music-start-rule',
      match_type: 'music_start',
      pattern: '',
      action: { type: 'event', label: 'music' },
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const updateRes = await put(`/cues/rules/${created.id}`, {
      match_type: 'music_stop',
      pattern: '',
    });
    assert.equal(updateRes.status, 200);
  });
});

describe('/cues/inline', () => {
  test('stores inline semantic cues from the sync payload', async () => {
    const res = await post('/cues/inline', {
      fileName: 'rundown.txt',
      fileId: 'file-1',
      cues: [{ line: 12, phrase: 'healing prayer', matchType: 'semantic', action: { type: 'event', label: 'healing' } }],
    });

    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.count, 1);
    assert.equal(lastInlineSnapshot?.snapshot?.fileName, 'rundown.txt');
    assert.equal(lastInlineSnapshot?.snapshot?.cues?.[0]?.match_type, 'semantic');
    assert.equal(lastInlineSnapshot?.snapshot?.cues?.[0]?.source, 'inline');
  });

  test('stores composite trees and cue definitions from the sync payload', async () => {
    const res = await post('/cues/inline', {
      fileName: 'rundown.txt',
      fileId: 'file-2',
      cues: [{ line: 18, phrase: 'healing prayer', matchType: 'composite', cueDef: 'prayer-and-healing', action: { type: 'event', label: 'healing' } }],
      cueDefs: {
        'prayer-and-healing': { op: 'and', children: [{ type: 'match', matchType: 'phrase', pattern: 'prayer' }, { type: 'match', matchType: 'phrase', pattern: 'healing' }] },
      },
    });

    assert.equal(res.status, 200);
    assert.equal(lastInlineSnapshot?.snapshot?.cueDefs?.['prayer-and-healing']?.op, 'and');
    assert.equal(lastInlineSnapshot?.snapshot?.cues?.[0]?.match_type, 'composite');
  });
});
