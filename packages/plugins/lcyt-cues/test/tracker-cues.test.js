import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// In-memory SQLite for testing tracker-state cue rules (Phase 9)
// ---------------------------------------------------------------------------

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping tracker cue tests');
  process.exit(0);
}

describe('CueEngine — tracker-state cues (match_type: track)', () => {
  let CueEngine, runMigrations, insertCueRule;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ runMigrations, insertCueRule } = await import('../src/db.js'));
  });

  function createDb() {
    const db = new Database(':memory:');
    runMigrations(db);
    return db;
  }

  test('track rule fires when the label is present in tracker state above threshold', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
      action: { type: 'event', label: 'presenter-standing' },
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 0.95 }] });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'track:presenter-standing');
  });

  test('track rule does not fire when the label is absent', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-seated', confidence: 0.95 }] });
    assert.equal(fired.length, 0);
  });

  test('track rule respects a below-threshold confidence miss', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
      fuzzy_threshold: 0.8,
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 0.3 }] });
    assert.equal(fired.length, 0);
  });

  test('cooldown prevents repeated track firing across state updates', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 't1', api_key: 'key1', name: 'presenter-standing',
      match_type: 'track', pattern: 'presenter-standing',
      cooldown_ms: 60000,
    });
    const engine = new CueEngine(db);
    const fired1 = engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 1 }] });
    assert.equal(fired1.length, 1);
    const fired2 = engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 1 }] });
    assert.equal(fired2.length, 0);
  });

  test('evaluateTrackerEvent caches state for track: leaves inside composite trees', async () => {
    const db = createDb();
    const engine = new CueEngine(db);
    engine.evaluateTrackerEvent('key1', { labels: [{ label: 'slide-change', confidence: 1 }] });
    const result = await engine.evaluateComposite('key1', { type: 'match', matchType: 'track', pattern: 'slide-change' }, { apiKey: 'key1' });
    assert.equal(result.matched, true);
  });

  test('evaluateTrackerEvent returns empty array when no matching rules', () => {
    const db = createDb();
    const engine = new CueEngine(db);
    const fired = engine.evaluateTrackerEvent('key1', { labels: [] });
    assert.deepEqual(fired, []);
  });
});

describe('CueEngine — track rules with a place (label@place)', () => {
  let CueEngine, runMigrations, insertCueRule;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ runMigrations, insertCueRule } = await import('../src/db.js'));
  });

  function engineWith(pattern) {
    const db = new Database(':memory:');
    runMigrations(db);
    insertCueRule(db, { id: 'r1', api_key: 'key1', name: 'r', match_type: 'track', pattern, action: { type: 'event', label: 'x' } });
    return new CueEngine(db);
  }
  const left = { label: 'person', confidence: 0.9, region: { zone: 'left', vertical: 'middle' } };
  const right = { label: 'person', confidence: 0.9, region: { zone: 'right', vertical: 'top' } };

  test('person@left fires for a person in the left third, not for one on the right', () => {
    assert.equal(engineWith('person@left').evaluateTrackerEvent('key1', { labels: [left] }).length, 1);
    assert.equal(engineWith('person@left').evaluateTrackerEvent('key1', { labels: [right] }).length, 0);
  });

  test('person@top matches the vertical third; a plain person rule matches anywhere', () => {
    assert.equal(engineWith('person@top').evaluateTrackerEvent('key1', { labels: [right] }).length, 1);
    assert.equal(engineWith('person').evaluateTrackerEvent('key1', { labels: [right] }).length, 1);
  });

  test('an entry without a region never matches a rule that names a place', () => {
    assert.equal(engineWith('person@left').evaluateTrackerEvent('key1', { labels: [{ label: 'person', confidence: 0.9 }] }).length, 0);
  });

  test('place match is case-insensitive and still honours the label', () => {
    assert.equal(engineWith('Person@LEFT').evaluateTrackerEvent('key1', { labels: [left] }).length, 1);
    assert.equal(engineWith('cross@left').evaluateTrackerEvent('key1', { labels: [left] }).length, 0);
  });
});
