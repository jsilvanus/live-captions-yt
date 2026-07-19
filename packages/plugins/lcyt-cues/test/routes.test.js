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

async function del(path) {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE' });
}

async function get(path) {
  return fetch(`${baseUrl}${path}`);
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

describe('/cues/rules — composite and track match types (Phase 9)', () => {
  test('creates a composite rule with a valid condition_tree', async () => {
    const res = await post('/cues/rules', {
      name: 'prayer-ending',
      match_type: 'composite',
      condition_tree: {
        op: 'or',
        children: [
          { type: 'match', matchType: 'phrase', pattern: 'amen' },
          { type: 'match', matchType: 'section', pattern: 'prayer' },
        ],
      },
      action: { type: 'event', label: 'prayer-ending' },
    });
    assert.equal(res.status, 201);
  });

  test('rejects a composite rule with an unknown leaf match type', async () => {
    const res = await post('/cues/rules', {
      name: 'bad-composite',
      match_type: 'composite',
      condition_tree: { type: 'match', matchType: 'nonsense', pattern: 'x' },
    });
    assert.equal(res.status, 400);
  });

  test('rejects a composite rule where "not" has more than one child', async () => {
    const res = await post('/cues/rules', {
      name: 'bad-not',
      match_type: 'composite',
      condition_tree: {
        op: 'not',
        children: [
          { type: 'match', matchType: 'phrase', pattern: 'a' },
          { type: 'match', matchType: 'phrase', pattern: 'b' },
        ],
      },
    });
    assert.equal(res.status, 400);
  });

  test('creates a track rule and defaults its cooldown to a non-zero value', async () => {
    const res = await post('/cues/rules', {
      name: 'presenter-standing',
      match_type: 'track',
      pattern: 'presenter-standing',
      action: { type: 'event', label: 'presenter-standing' },
    });
    assert.equal(res.status, 201);
    const created = await res.json();

    const listRes = await get('/cues/rules');
    const { rules } = await listRes.json();
    const row = rules.find(r => r.id === created.id);
    assert.ok(row.cooldown_ms > 0, 'track rules should default to a non-zero cooldown');
  });

  test('rejects a track rule missing a pattern', async () => {
    const res = await post('/cues/rules', { name: 'no-pattern-track', match_type: 'track' });
    assert.equal(res.status, 400);
  });
});

describe('/cues/rules — composite condition_tree fixes', () => {
  test('GET /cues/rules returns condition_tree as a parsed object, not a JSON string', async () => {
    const createRes = await post('/cues/rules', {
      name: 'parsed-tree-check',
      match_type: 'composite',
      condition_tree: { type: 'match', matchType: 'phrase', pattern: 'hallelujah' },
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const listRes = await get('/cues/rules');
    const { rules } = await listRes.json();
    const row = rules.find(r => r.id === created.id);
    assert.equal(typeof row.condition_tree, 'object');
    assert.equal(row.condition_tree.pattern, 'hallelujah');
  });

  test('a save round trip on the parsed condition_tree does not corrupt it', async () => {
    const createRes = await post('/cues/rules', {
      name: 'roundtrip-check',
      match_type: 'composite',
      condition_tree: { type: 'match', matchType: 'phrase', pattern: 'grace' },
    });
    const created = await createRes.json();

    const listRes = await get('/cues/rules');
    const { rules } = await listRes.json();
    const loaded = rules.find(r => r.id === created.id).condition_tree;

    // Simulate the UI's "open edit dialog, save without changes" round trip.
    const updateRes = await put(`/cues/rules/${created.id}`, { condition_tree: loaded });
    assert.equal(updateRes.status, 200);

    const listAfter = await get('/cues/rules');
    const { rules: rulesAfter } = await listAfter.json();
    const reloaded = rulesAfter.find(r => r.id === created.id).condition_tree;
    assert.equal(typeof reloaded, 'object');
    assert.equal(reloaded.pattern, 'grace');
  });

  test('PUT rejects switching match_type to composite with no existing or provided condition_tree', async () => {
    const createRes = await post('/cues/rules', {
      name: 'switch-to-composite',
      match_type: 'phrase',
      pattern: 'x',
    });
    const created = await createRes.json();

    const updateRes = await put(`/cues/rules/${created.id}`, { match_type: 'composite' });
    assert.equal(updateRes.status, 400);
  });

  test('PUT allows switching match_type to composite when a condition_tree is provided', async () => {
    const createRes = await post('/cues/rules', {
      name: 'switch-to-composite-with-tree',
      match_type: 'phrase',
      pattern: 'x',
    });
    const created = await createRes.json();

    const updateRes = await put(`/cues/rules/${created.id}`, {
      match_type: 'composite',
      condition_tree: { type: 'match', matchType: 'phrase', pattern: 'y' },
    });
    assert.equal(updateRes.status, 200);
  });

  test('rejects an unsafe regex pattern inside a composite leaf', async () => {
    const res = await post('/cues/rules', {
      name: 'redos-composite',
      match_type: 'composite',
      condition_tree: { type: 'match', matchType: 'regex', pattern: '(a+)+$' },
    });
    assert.equal(res.status, 400);
  });

  test('rejects a bare ref-name string as the top-level condition_tree', async () => {
    const res = await post('/cues/rules', {
      name: 'bare-string-root',
      match_type: 'composite',
      condition_tree: 'some-named-condition',
    });
    assert.equal(res.status, 400);
  });

  test('a composite rule whose only track leaf is behind a ref still gets the non-zero cooldown default', async () => {
    await post('/cues/defs', {
      name: 'track-behind-ref',
      condition_tree: { type: 'match', matchType: 'track', pattern: 'presenter-standing' },
    });

    const res = await post('/cues/rules', {
      name: 'composite-with-ref-track',
      match_type: 'composite',
      condition_tree: { type: 'ref', name: 'track-behind-ref' },
    });
    assert.equal(res.status, 201);
    const created = await res.json();

    const listRes = await get('/cues/rules');
    const { rules } = await listRes.json();
    const row = rules.find(r => r.id === created.id);
    assert.ok(row.cooldown_ms > 0, 'composite rules referencing a track leaf via ref should default to a non-zero cooldown');
  });
});

describe('/cues/defs — named conditions (Phase 9)', () => {
  test('creates a named condition', async () => {
    const res = await post('/cues/defs', {
      name: 'prayer-ending',
      condition_tree: {
        op: 'or',
        children: [
          { type: 'match', matchType: 'phrase', pattern: 'amen' },
          { type: 'match', matchType: 'semantic', pattern: 'end of the prayer' },
        ],
      },
    });
    assert.equal(res.status, 201);
  });

  test('rejects a duplicate name for the same API key', async () => {
    await post('/cues/defs', { name: 'dupe-name', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'x' } });
    const res = await post('/cues/defs', { name: 'dupe-name', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'y' } });
    assert.equal(res.status, 409);
  });

  test('rejects a condition_tree with an unknown leaf match type', async () => {
    const res = await post('/cues/defs', { name: 'bad-leaf', condition_tree: { type: 'match', matchType: 'nonsense', pattern: 'x' } });
    assert.equal(res.status, 400);
  });

  test('rejects a self-referencing named condition', async () => {
    const res = await post('/cues/defs', { name: 'self-ref', condition_tree: { type: 'ref', name: 'self-ref' } });
    assert.equal(res.status, 400);
  });

  test('rejects a two-hop reference cycle across two named conditions', async () => {
    const first = await post('/cues/defs', { name: 'cycle-a', condition_tree: { type: 'ref', name: 'cycle-b' } });
    assert.equal(first.status, 201);

    const second = await post('/cues/defs', { name: 'cycle-b', condition_tree: { type: 'ref', name: 'cycle-a' } });
    assert.equal(second.status, 400);
  });

  test('lists, updates, and deletes a named condition', async () => {
    const createRes = await post('/cues/defs', { name: 'lifecycle-test', condition_tree: { type: 'match', matchType: 'phrase', pattern: 'a' } });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const listRes = await get('/cues/defs');
    const { defs } = await listRes.json();
    assert.ok(defs.some(d => d.id === created.id));

    const updateRes = await put(`/cues/defs/${created.id}`, { condition_tree: { type: 'match', matchType: 'phrase', pattern: 'b' } });
    assert.equal(updateRes.status, 200);

    const deleteRes = await del(`/cues/defs/${created.id}`);
    assert.equal(deleteRes.status, 200);

    const listAfter = await get('/cues/defs');
    const { defs: defsAfter } = await listAfter.json();
    assert.ok(!defsAfter.some(d => d.id === created.id));
  });

  test('404s updating/deleting a condition that does not exist', async () => {
    const updateRes = await put('/cues/defs/does-not-exist', { condition_tree: { type: 'match', matchType: 'phrase', pattern: 'a' } });
    assert.equal(updateRes.status, 404);
    const deleteRes = await del('/cues/defs/does-not-exist');
    assert.equal(deleteRes.status, 404);
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
