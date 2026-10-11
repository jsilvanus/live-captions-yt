import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// One database for the whole file (a PostgreSQL schema per initDb is slow); createDb() empties the cue tables.
let sharedDb;
before(async () => {
  const { initDb } = await import('lcyt-backend/db');
  sharedDb = await initDb(':memory:');
});
after(async () => { await sharedDb?.close(); });

async function createDb() {
  await sharedDb.cue_events.deleteMany({});
  await sharedDb.cue_rules.deleteMany({});
  await sharedDb.cue_named_conditions.deleteMany({});
  return sharedDb;
}


describe('CueEngine — tracker-state cues (match_type: track)', () => {
  let CueEngine, insertCueRule;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ insertCueRule } = await import('../src/db.js'));
  });

  test('track rule fires when the label is present in tracker state above threshold', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
      action: { type: 'event', label: 'presenter-standing' },
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 0.95 }] });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'track:presenter-standing');
  });

  test('track rule does not fire when the label is absent', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-seated', confidence: 0.95 }] });
    assert.equal(fired.length, 0);
  });

  test('track rule respects a below-threshold confidence miss', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
      fuzzy_threshold: 0.8,
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 0.3 }] });
    assert.equal(fired.length, 0);
  });

  test('cooldown prevents repeated track firing across state updates', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
      cooldown_ms: 60000,
    });
    const engine = new CueEngine(db);
    const fired1 = await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 1 }] });
    assert.equal(fired1.length, 1);
    const fired2 = await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 1 }] });
    assert.equal(fired2.length, 0);
  });

  test('evaluateTrackerEvent caches state for track: leaves inside composite trees', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'slide-change', confidence: 1 }] });
    const result = await engine.evaluateComposite('key1', { type: 'match', matchType: 'track', pattern: 'slide-change' }, { apiKey: 'key1' });
    assert.equal(result.matched, true);
  });

  test('evaluateTrackerEvent returns empty array when no matching rules', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    const fired = await engine.evaluateTrackerEvent('key1', { labels: [] });
    assert.deepEqual(fired, []);
  });
});

describe('CueEngine — track rules with a place (label@place)', () => {
  let CueEngine, insertCueRule;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ insertCueRule } = await import('../src/db.js'));
  });

  async function engineWith(pattern) {
    const db = await createDb();
    await insertCueRule(db, { id: 'r1', api_key: 'key1', name: 'r', match_type: 'track', pattern, action: { type: 'event', label: 'x' } });
    return new CueEngine(db);
  }
  const left = { label: 'person', confidence: 0.9, region: { zone: 'left', vertical: 'middle' } };
  const right = { label: 'person', confidence: 0.9, region: { zone: 'right', vertical: 'top' } };

  test('person@left fires for a person in the left third, not for one on the right', async () => {
    assert.equal((await (await engineWith('person@left')).evaluateTrackerEvent('key1', { labels: [left] })).length, 1);
    assert.equal((await (await engineWith('person@left')).evaluateTrackerEvent('key1', { labels: [right] })).length, 0);
  });

  test('person@top matches the vertical third; a plain person rule matches anywhere', async () => {
    assert.equal((await (await engineWith('person@top')).evaluateTrackerEvent('key1', { labels: [right] })).length, 1);
    assert.equal((await (await engineWith('person')).evaluateTrackerEvent('key1', { labels: [right] })).length, 1);
  });

  test('an entry without a region never matches a rule that names a place', async () => {
    assert.equal((await (await engineWith('person@left')).evaluateTrackerEvent('key1', { labels: [{ label: 'person', confidence: 0.9 }] })).length, 0);
  });

  test('place match is case-insensitive and still honours the label', async () => {
    assert.equal((await (await engineWith('Person@LEFT')).evaluateTrackerEvent('key1', { labels: [left] })).length, 1);
    assert.equal((await (await engineWith('cross@left')).evaluateTrackerEvent('key1', { labels: [left] })).length, 0);
  });
});
