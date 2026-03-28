import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// In-memory SQLite for realistic testing
// ---------------------------------------------------------------------------

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  // If better-sqlite3 is not installed, skip these tests gracefully
  console.log('# better-sqlite3 not available — skipping CueEngine DB tests');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CueEngine', () => {
  let CueEngine, runMigrations, insertCueRule, listCueRules, getRecentCueEvents;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ runMigrations, insertCueRule, listCueRules, getRecentCueEvents } = await import('../src/db.js'));
  });

  function createDb() {
    const db = new Database(':memory:');
    runMigrations(db);
    return db;
  }

  test('evaluate returns empty array when no rules exist', () => {
    const db = createDb();
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'Hello world');
    assert.deepEqual(fired, []);
  });

  test('phrase match fires when text contains the phrase', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'amen-rule',
      match_type: 'phrase', pattern: 'amen',
      action: { type: 'event', label: 'amen' },
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'And all the people said amen');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'amen');
    assert.equal(fired[0].rule.name, 'amen-rule');
  });

  test('phrase match is case-insensitive', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'Amen',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'AMEN TO THAT');
    assert.equal(fired.length, 1);
  });

  test('phrase match does not fire when phrase is absent', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hallelujah',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'Hello world');
    assert.equal(fired.length, 0);
  });

  test('regex match fires on pattern match', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'number-rule',
      match_type: 'regex', pattern: '\\d{3,}',
      action: { type: 'event' },
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'Psalm 119 is long');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, '119');
  });

  test('regex match does not fire when no match', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'regex', pattern: '^EXACT$',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'not exact');
    assert.equal(fired.length, 0);
  });

  test('invalid regex pattern does not crash', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'bad-regex',
      match_type: 'regex', pattern: '[invalid',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'anything');
    assert.equal(fired.length, 0);
  });

  test('section match fires when section code matches', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'prayer-cue',
      match_type: 'section', pattern: 'Prayer',
      action: { type: 'event', label: 'prayer' },
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'some text', { section: 'Prayer' });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'Prayer');
  });

  test('section match is case-insensitive', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'section', pattern: 'chorus',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', '', { section: 'CHORUS' });
    assert.equal(fired.length, 1);
  });

  test('section match does not fire for different section', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'section', pattern: 'Prayer',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'text', { section: 'Sermon' });
    assert.equal(fired.length, 0);
  });

  test('disabled rules are not evaluated', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hello',
      enabled: 0,
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'hello world');
    assert.equal(fired.length, 0);
  });

  test('cooldown prevents repeated firing within window', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'amen',
      cooldown_ms: 60000, // 60 seconds
    });
    const engine = new CueEngine(db);

    // First evaluation — should fire
    const fired1 = engine.evaluate('key1', 'amen');
    assert.equal(fired1.length, 1);

    // Second evaluation immediately — should be suppressed by cooldown
    const fired2 = engine.evaluate('key1', 'amen again');
    assert.equal(fired2.length, 0);
  });

  test('multiple rules can fire from the same text', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'amen-rule',
      match_type: 'phrase', pattern: 'amen',
    });
    insertCueRule(db, {
      id: 'r2', api_key: 'key1', name: 'prayer-rule',
      match_type: 'phrase', pattern: 'prayer',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'Let us say amen after this prayer');
    assert.equal(fired.length, 2);
  });

  test('rules from different API keys are isolated', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hello',
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key2', 'hello world');
    assert.equal(fired.length, 0);
  });

  test('events are persisted to the DB', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'amen-rule',
      match_type: 'phrase', pattern: 'amen',
      action: { type: 'event', label: 'amen' },
    });
    const engine = new CueEngine(db);
    engine.evaluate('key1', 'amen');

    const events = getRecentCueEvents(db, 'key1');
    assert.equal(events.length, 1);
    assert.equal(events[0].rule_id, 'r1');
    assert.equal(events[0].rule_name, 'amen-rule');
    assert.equal(events[0].matched, 'amen');
  });

  test('invalidate clears the rule cache', () => {
    const db = createDb();
    const engine = new CueEngine(db);

    // First evaluate populates cache
    engine.evaluate('key1', 'hello');

    // Add a rule
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hello',
    });

    // Without invalidation, cache still has no rules
    const fired1 = engine.evaluate('key1', 'hello');
    assert.equal(fired1.length, 0);

    // After invalidation, new rule is picked up
    engine.invalidate('key1');
    const fired2 = engine.evaluate('key1', 'hello');
    assert.equal(fired2.length, 1);
  });

  test('evaluate with null/empty text returns empty', () => {
    const db = createDb();
    const engine = new CueEngine(db);
    assert.deepEqual(engine.evaluate('key1', null), []);
    assert.deepEqual(engine.evaluate('key1', ''), []);
  });

  test('fuzzy match fires for similar text (Jaro-Winkler)', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'fuzzy-amen',
      match_type: 'fuzzy', pattern: 'we beseech thee',
      fuzzy_threshold: 0.75,
    });
    const engine = new CueEngine(db);
    // Exact match
    const fired1 = engine.evaluate('key1', 'we beseech thee o lord');
    assert.equal(fired1.length, 1);
    assert.ok(fired1[0].matched.includes('beseech'));
  });

  test('fuzzy match does not fire for very different text', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'fuzzy-test',
      match_type: 'fuzzy', pattern: 'hallelujah praise god',
      fuzzy_threshold: 0.75,
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'the cat sat on the mat');
    assert.equal(fired.length, 0);
  });

  test('fuzzy match respects threshold', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'strict-fuzzy',
      match_type: 'fuzzy', pattern: 'amen',
      fuzzy_threshold: 0.99, // very strict
    });
    const engine = new CueEngine(db);
    // Close but not exact enough for 0.99 threshold
    const fired = engine.evaluate('key1', 'ameen');
    assert.equal(fired.length, 0);
  });

  test('fuzzy match fires with lenient threshold', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'lenient-fuzzy',
      match_type: 'fuzzy', pattern: 'amen',
      fuzzy_threshold: 0.5,
    });
    const engine = new CueEngine(db);
    const fired = engine.evaluate('key1', 'ameen');
    assert.equal(fired.length, 1);
  });
});

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

describe('cue DB helpers', () => {
  let runMigrations, insertCueRule, getCueRule, updateCueRule, deleteCueRule, listCueRules, insertCueEvent, getRecentCueEvents;

  before(async () => {
    ({
      runMigrations, insertCueRule, getCueRule, updateCueRule,
      deleteCueRule, listCueRules, insertCueEvent, getRecentCueEvents,
    } = await import('../src/db.js'));
  });

  function createDb() {
    const db = new Database(':memory:');
    runMigrations(db);
    return db;
  }

  test('CRUD cycle for cue rules', () => {
    const db = createDb();

    // Create
    insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'Test Rule',
      match_type: 'phrase', pattern: 'hello',
      action: { type: 'event' },
    });

    // Read
    const rule = getCueRule(db, 'r1');
    assert.ok(rule);
    assert.equal(rule.name, 'Test Rule');
    assert.equal(rule.match_type, 'phrase');
    assert.equal(rule.pattern, 'hello');
    assert.equal(rule.enabled, 1);

    // List
    const rules = listCueRules(db, 'key1');
    assert.equal(rules.length, 1);

    // Update
    updateCueRule(db, 'r1', { name: 'Updated Rule', enabled: 0 });
    const updated = getCueRule(db, 'r1');
    assert.equal(updated.name, 'Updated Rule');
    assert.equal(updated.enabled, 0);

    // Delete
    deleteCueRule(db, 'r1');
    const deleted = getCueRule(db, 'r1');
    assert.equal(deleted, undefined);
  });

  test('insert and retrieve cue events', () => {
    const db = createDb();

    insertCueEvent(db, 'key1', {
      rule_id: 'r1',
      rule_name: 'Test',
      matched: 'hello',
      action: { type: 'event' },
    });

    const events = getRecentCueEvents(db, 'key1');
    assert.equal(events.length, 1);
    assert.equal(events[0].rule_name, 'Test');
    assert.equal(events[0].matched, 'hello');
  });

  test('getRecentCueEvents respects limit', () => {
    const db = createDb();

    for (let i = 0; i < 5; i++) {
      insertCueEvent(db, 'key1', {
        rule_id: `r${i}`, rule_name: `Rule ${i}`, matched: `m${i}`,
      });
    }

    const events = getRecentCueEvents(db, 'key1', 3);
    assert.equal(events.length, 3);
  });

  test('migrations are idempotent', () => {
    const db = createDb();
    // Run again — should not throw
    runMigrations(db);
    const rules = listCueRules(db, 'key1');
    assert.deepEqual(rules, []);
  });

  test('evaluateEventCues does nothing without agentEvaluateFn', async () => {
    const db = createDb();
    const engine = new CueEngine(db);
    insertCueRule(db, 'key1', {
      name: 'event1',
      match_type: 'event_cue',
      pattern: 'speaker stands up',
      action: '{}',
      cooldown_ms: 0,
    });
    const results = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => results.push(...fired));
    assert.equal(results.length, 0);
  });

  test('evaluateEventCues calls agent for event_cue rules', async () => {
    const db = createDb();
    const engine = new CueEngine(db);
    insertCueRule(db, 'key1', {
      name: 'stand-up',
      match_type: 'event_cue',
      pattern: 'speaker stands up',
      action: '{"type":"event"}',
      cooldown_ms: 0,
    });
    engine.setAgentEvaluateFn(async (apiKey, desc) => {
      return { matched: true, confidence: 0.9, reasoning: 'detected' };
    });
    const results = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => results.push(...fired));
    assert.equal(results.length, 1);
    assert.ok(results[0].matched.includes('speaker stands up'));
  });

  test('evaluateEventCues respects cooldown', async () => {
    const db = createDb();
    const engine = new CueEngine(db);
    insertCueRule(db, 'key1', {
      name: 'event2',
      match_type: 'event_cue',
      pattern: 'slides change',
      action: '{}',
      cooldown_ms: 60000,
    });
    engine.setAgentEvaluateFn(async () => ({ matched: true, confidence: 0.9, reasoning: 'ok' }));
    const r1 = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => r1.push(...fired));
    assert.equal(r1.length, 1);
    // Second call within cooldown should not fire
    const r2 = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => r2.push(...fired));
    assert.equal(r2.length, 0);
  });

  test('evaluateEventCues skips non-event_cue rules', async () => {
    const db = createDb();
    const engine = new CueEngine(db);
    insertCueRule(db, 'key1', {
      name: 'phrase-rule',
      match_type: 'phrase',
      pattern: 'amen',
      action: '{}',
      cooldown_ms: 0,
    });
    let called = false;
    engine.setAgentEvaluateFn(async () => { called = true; return { matched: true, confidence: 0.9, reasoning: 'ok' }; });
    await engine.evaluateEventCues('key1', 'amen', () => {});
    assert.equal(called, false);
  });

  test('evaluateEventCues handles agent returning not matched', async () => {
    const db = createDb();
    const engine = new CueEngine(db);
    insertCueRule(db, 'key1', {
      name: 'event3',
      match_type: 'event_cue',
      pattern: 'applause',
      action: '{}',
      cooldown_ms: 0,
    });
    engine.setAgentEvaluateFn(async () => ({ matched: false, confidence: 0.2, reasoning: 'not detected' }));
    const r = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => r.push(...fired));
    assert.equal(r.length, 0);
  });
});
