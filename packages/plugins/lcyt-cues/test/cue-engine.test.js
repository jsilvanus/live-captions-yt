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


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CueEngine', () => {
  let CueEngine, insertCueRule, listCueRules, getRecentCueEvents, insertNamedCondition;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ insertCueRule, listCueRules, getRecentCueEvents, insertNamedCondition } = await import('../src/db.js'));
  });

  test('evaluate returns empty array when no rules exist', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'Hello world');
    assert.deepEqual(fired, []);
  });

  test('inline semantic cues are evaluated when embedding support is available', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    engine.setInlineSnapshot('key1', {
      cues: [{
        phrase: 'prayer for healing',
        matchType: 'semantic',
        action: { type: 'event', label: 'healing' },
      }],
    });
    engine.setEmbeddingFn(async () => [[1, 0, 0], [0.9, 0.1, 0]]);

    const fired = await engine.evaluateInlineCues('key1', 'prayer for healing');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].rule.match_type, 'semantic');
    assert.equal(fired[0].rule.source, 'inline');
  });

  test('inline composite cues evaluate simple and/or/not trees', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    engine.setInlineSnapshot('key1', {
      cueDefs: {
        'prayer-and-healing': {
          op: 'and',
          children: [
            { type: 'match', matchType: 'phrase', pattern: 'prayer' },
            { type: 'match', matchType: 'phrase', pattern: 'healing' },
          ],
        },
      },
      cues: [{
        phrase: 'composite cue',
        matchType: 'composite',
        cueDef: 'prayer-and-healing',
        action: { type: 'event', label: 'composite' },
      }],
    });

    const fired = await engine.evaluateInlineCues('key1', 'prayer and healing');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].rule.match_type, 'composite');
    assert.equal(fired[0].rule.source, 'inline');
  });

  test('inline composite cues evaluate fuzzy context leaves', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    engine.setInlineSnapshot('key1', {
      cueDefs: {
        'fuzzy-section': {
          type: 'match',
          matchType: 'context',
          path: 'section',
          pattern: 'amen',
          fuzzy: true,
          fuzzy_threshold: 0.8,
        },
      },
      cues: [{
        phrase: 'fuzzy context cue',
        matchType: 'composite',
        cueDef: 'fuzzy-section',
        action: { type: 'event', label: 'fuzzy-context' },
      }],
    });

    const fired = await engine.evaluateInlineCues('key1', 'text', { section: 'ameen' });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].rule.match_type, 'composite');
    assert.equal(fired[0].rule.source, 'inline');
  });

  // -------------------------------------------------------------------------
  // Phase 9 — composite & named conditions
  // -------------------------------------------------------------------------

  test('evaluateComposite resolves and/or/not trees synchronously for cheap leaves', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);

    const orResult = await engine.evaluateComposite('key1', {
      op: 'or',
      children: [
        { type: 'match', matchType: 'phrase', pattern: 'amen' },
        { type: 'match', matchType: 'phrase', pattern: 'hallelujah' },
      ],
    }, { text: 'we said hallelujah' });
    assert.equal(orResult.matched, true);
    assert.equal(orResult.leaf.pattern, 'hallelujah');

    const andResult = await engine.evaluateComposite('key1', {
      op: 'and',
      children: [
        { type: 'match', matchType: 'phrase', pattern: 'prayer' },
        { type: 'match', matchType: 'phrase', pattern: 'healing' },
      ],
    }, { text: 'a prayer for healing' });
    assert.equal(andResult.matched, true);

    const notResult = await engine.evaluateComposite('key1', {
      op: 'not',
      children: [{ type: 'match', matchType: 'phrase', pattern: 'amen' }],
    }, { text: 'no match here' });
    assert.equal(notResult.matched, true);
  });

  test('evaluateComposite treats a "not" group with zero children as a no-match, not always-true', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);

    // A malformed tree (e.g. from an unvalidated inline-sync payload) with an
    // empty "not" group must never resolve `matched: true` no matter the text.
    const result = await engine.evaluateComposite('key1', {
      op: 'not',
      children: [],
    }, { text: 'anything at all' });
    assert.equal(result.matched, false);
  });

  test('evaluateComposite track leaf respects a fuzzy_threshold confidence cutoff (not confidence_threshold)', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 0.4 }] });

    const belowThreshold = await engine.evaluateComposite('key1', {
      type: 'match', matchType: 'track', pattern: 'presenter-standing', fuzzy_threshold: 0.8,
    }, { apiKey: 'key1' });
    assert.equal(belowThreshold.matched, false, 'a fuzzy_threshold above the cached confidence should reject the match');

    const aboveThreshold = await engine.evaluateComposite('key1', {
      type: 'match', matchType: 'track', pattern: 'presenter-standing', fuzzy_threshold: 0.3,
    }, { apiKey: 'key1' });
    assert.equal(aboveThreshold.matched, true);
  });

  test('evaluateComposite named ref resolves against the DB-backed cue_named_conditions table', async () => {
    const db = await createDb();
    await insertNamedCondition(db, {
      id: 'def1', api_key: 'key1', name: 'prayer-ending',
      condition_tree: {
        op: 'or',
        children: [
          { type: 'match', matchType: 'phrase', pattern: 'amen' },
          { type: 'match', matchType: 'phrase', pattern: 'end of the prayer' },
        ],
      },
    });
    const engine = new CueEngine(db);

    const result = await engine.evaluateComposite('key1', { type: 'ref', name: 'prayer-ending' }, { text: 'and so we said amen' });
    assert.equal(result.matched, true);
    assert.equal(result.leaf.pattern, 'amen');

    const miss = await engine.evaluateComposite('key1', { type: 'ref', name: 'prayer-ending' }, { text: 'welcome everyone' });
    assert.equal(miss.matched, false);
  });

  test('evaluateComposite treats a self-referencing named condition as a no-match, not an infinite loop', async () => {
    const db = await createDb();
    await insertNamedCondition(db, {
      id: 'def1', api_key: 'key1', name: 'cyclic',
      condition_tree: { type: 'ref', name: 'cyclic' },
    });
    const engine = new CueEngine(db);

    const result = await engine.evaluateComposite('key1', { type: 'ref', name: 'cyclic' }, { text: 'anything' });
    assert.equal(result.matched, false);
  });

  test('evaluateComposite evaluates cheap sync leaves before async (semantic) leaves regardless of source order', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    let embedCalled = false;
    engine.setEmbeddingFn(async () => {
      embedCalled = true;
      throw new Error('embedding fn should not have been called');
    });

    const result = await engine.evaluateComposite('key1', {
      op: 'or',
      children: [
        { type: 'match', matchType: 'semantic', pattern: 'end of the prayer' },
        { type: 'match', matchType: 'phrase', pattern: 'amen' },
      ],
    }, { text: 'and all the people said amen', apiKey: 'key1' });

    assert.equal(result.matched, true);
    assert.equal(result.leaf.type, 'phrase');
    assert.equal(embedCalled, false, 'the async semantic leaf should not run once the cheap sync leaf already matched');
  });

  test('evaluateComposite track leaf reads cached tracker state', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    await engine.evaluateTrackerEvent('key1', { labels: [{ label: 'presenter-standing', confidence: 0.9 }] });

    const hit = await engine.evaluateComposite('key1', { type: 'match', matchType: 'track', pattern: 'presenter-standing' }, { apiKey: 'key1' });
    assert.equal(hit.matched, true);

    const miss = await engine.evaluateComposite('key1', { type: 'match', matchType: 'track', pattern: 'presenter-seated' }, { apiKey: 'key1' });
    assert.equal(miss.matched, false);
  });

  test('evaluateCompositeRules fires DB-backed composite rules and respects cooldown', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'comp1', api_key: 'key1', name: 'prayer-ending-rule',
      match_type: 'composite', pattern: '',
      condition_tree: {
        op: 'or',
        children: [
          { type: 'match', matchType: 'phrase', pattern: 'amen' },
          { type: 'match', matchType: 'section', pattern: 'prayer' },
        ],
      },
      action: { type: 'event', label: 'prayer-ending' },
      cooldown_ms: 60000,
    });
    const engine = new CueEngine(db);

    const fired1 = await engine.evaluateCompositeRules('key1', 'and all the people said amen', {});
    assert.equal(fired1.length, 1);
    assert.equal(fired1[0].rule.match_type, 'composite');

    const fired2 = await engine.evaluateCompositeRules('key1', 'and all the people said amen', {});
    assert.equal(fired2.length, 0, 'cooldown should block an immediate repeat');
  });

  test('evaluateCompositeRules still evaluates cheap leaves before async ones once the ordering is precomputed at rule load', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'comp-precompute', api_key: 'key1', name: 'cheap-before-async',
      match_type: 'composite', pattern: '',
      condition_tree: {
        op: 'or',
        children: [
          { type: 'match', matchType: 'semantic', pattern: 'end of the prayer' },
          { type: 'match', matchType: 'phrase', pattern: 'amen' },
        ],
      },
      action: {},
    });
    const engine = new CueEngine(db);
    let embedCalled = false;
    engine.setEmbeddingFn(async () => {
      embedCalled = true;
      throw new Error('embedding fn should not have been called');
    });

    // Triggers `_loadRules()` → `_precomputeOrder()`, which pre-sorts this
    // rule's tree so the cheap phrase leaf is tried before the async
    // semantic leaf despite the source order above.
    const fired = await engine.evaluateCompositeRules('key1', 'and all the people said amen', {});
    assert.equal(fired.length, 1);
    assert.equal(embedCalled, false, 'the async semantic leaf should not run once the precomputed-cheap-first phrase leaf already matched');
  });

  test('phrase match fires when text contains the phrase', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'amen-rule',
      match_type: 'phrase', pattern: 'amen',
      action: { type: 'event', label: 'amen' },
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'And all the people said amen');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'amen');
    assert.equal(fired[0].rule.name, 'amen-rule');
  });

  test('phrase match is case-insensitive', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'Amen',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'AMEN TO THAT');
    assert.equal(fired.length, 1);
  });

  test('phrase match does not fire when phrase is absent', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hallelujah',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'Hello world');
    assert.equal(fired.length, 0);
  });

  test('regex match fires on pattern match', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'number-rule',
      match_type: 'regex', pattern: '\\d{3,}',
      action: { type: 'event' },
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'Psalm 119 is long');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, '119');
  });

  test('regex match does not fire when no match', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'regex', pattern: '^EXACT$',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'not exact');
    assert.equal(fired.length, 0);
  });

  test('invalid regex pattern does not crash', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'bad-regex',
      match_type: 'regex', pattern: '[invalid',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'anything');
    assert.equal(fired.length, 0);
  });

  test('section match fires when section code matches', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'prayer-cue',
      match_type: 'section', pattern: 'Prayer',
      action: { type: 'event', label: 'prayer' },
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'some text', { section: 'Prayer' });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'Prayer');
  });

  test('section match is case-insensitive', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'section', pattern: 'chorus',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', '', { section: 'CHORUS' });
    assert.equal(fired.length, 1);
  });

  test('section match does not fire for different section', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'section', pattern: 'Prayer',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'text', { section: 'Sermon' });
    assert.equal(fired.length, 0);
  });

  test('disabled rules are not evaluated', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hello',
      enabled: 0,
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'hello world');
    assert.equal(fired.length, 0);
  });

  test('cooldown prevents repeated firing within window', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'amen',
      cooldown_ms: 60000, // 60 seconds
    });
    const engine = new CueEngine(db);

    // First evaluation — should fire
    const fired1 = await engine.evaluate('key1', 'amen');
    assert.equal(fired1.length, 1);

    // Second evaluation immediately — should be suppressed by cooldown
    const fired2 = await engine.evaluate('key1', 'amen again');
    assert.equal(fired2.length, 0);
  });

  test('multiple rules can fire from the same text', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'amen-rule',
      match_type: 'phrase', pattern: 'amen',
    });
    await insertCueRule(db, {
      id: 'r2', api_key: 'key1', name: 'prayer-rule',
      match_type: 'phrase', pattern: 'prayer',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'Let us say amen after this prayer');
    assert.equal(fired.length, 2);
  });

  test('rules from different API keys are isolated', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hello',
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key2', 'hello world');
    assert.equal(fired.length, 0);
  });

  test('events are persisted to the DB', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'amen-rule',
      match_type: 'phrase', pattern: 'amen',
      action: { type: 'event', label: 'amen' },
    });
    const engine = new CueEngine(db);
    await engine.evaluate('key1', 'amen');

    const events = await getRecentCueEvents(db, 'key1');
    assert.equal(events.length, 1);
    assert.equal(events[0].rule_id, 'r1');
    assert.equal(events[0].rule_name, 'amen-rule');
    assert.equal(events[0].matched, 'amen');
  });

  test('invalidate clears the rule cache', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);

    // First evaluate populates cache
    await engine.evaluate('key1', 'hello');

    // Add a rule
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'test',
      match_type: 'phrase', pattern: 'hello',
    });

    // Without invalidation, cache still has no rules
    const fired1 = await engine.evaluate('key1', 'hello');
    assert.equal(fired1.length, 0);

    // After invalidation, new rule is picked up
    engine.invalidate('key1');
    const fired2 = await engine.evaluate('key1', 'hello');
    assert.equal(fired2.length, 1);
  });

  test('evaluate with null/empty text returns empty', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    assert.deepEqual(await engine.evaluate('key1', null), []);
    assert.deepEqual(await engine.evaluate('key1', ''), []);
  });

  test('fuzzy match fires for similar text (Jaro-Winkler)', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'fuzzy-amen',
      match_type: 'fuzzy', pattern: 'we beseech thee',
      fuzzy_threshold: 0.75,
    });
    const engine = new CueEngine(db);
    // Exact match
    const fired1 = await engine.evaluate('key1', 'we beseech thee o lord');
    assert.equal(fired1.length, 1);
    assert.ok(fired1[0].matched.includes('beseech'));
  });

  test('fuzzy match does not fire for very different text', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'fuzzy-test',
      match_type: 'fuzzy', pattern: 'hallelujah praise god',
      fuzzy_threshold: 0.75,
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'the cat sat on the mat');
    assert.equal(fired.length, 0);
  });

  test('fuzzy match respects threshold', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'strict-fuzzy',
      match_type: 'fuzzy', pattern: 'amen',
      fuzzy_threshold: 0.99, // very strict
    });
    const engine = new CueEngine(db);
    // Close but not exact enough for 0.99 threshold
    const fired = await engine.evaluate('key1', 'ameen');
    assert.equal(fired.length, 0);
  });

  test('fuzzy match fires with lenient threshold', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'lenient-fuzzy',
      match_type: 'fuzzy', pattern: 'amen',
      fuzzy_threshold: 0.5,
    });
    const engine = new CueEngine(db);
    const fired = await engine.evaluate('key1', 'ameen');
    assert.equal(fired.length, 1);
  });
});

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

describe('cue DB helpers', () => {
  let CueEngine;
  let insertCueRule, getCueRule, updateCueRule, deleteCueRule, listCueRules, insertCueEvent, getRecentCueEvents;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({
      insertCueRule, getCueRule, updateCueRule,
      deleteCueRule, listCueRules, insertCueEvent, getRecentCueEvents,
    } = await import('../src/db.js'));
  });

  test('CRUD cycle for cue rules', async () => {
    const db = await createDb();

    // Create
    await insertCueRule(db, {
      id: 'r1', api_key: 'key1', name: 'Test Rule',
      match_type: 'phrase', pattern: 'hello',
      action: { type: 'event' },
    });

    // Read
    const rule = await getCueRule(db, 'r1');
    assert.ok(rule);
    assert.equal(rule.name, 'Test Rule');
    assert.equal(rule.match_type, 'phrase');
    assert.equal(rule.pattern, 'hello');
    assert.equal(rule.enabled, 1);

    // List
    const rules = await listCueRules(db, 'key1');
    assert.equal(rules.length, 1);

    // Update
    await updateCueRule(db, 'r1', { name: 'Updated Rule', enabled: 0 });
    const updated = await getCueRule(db, 'r1');
    assert.equal(updated.name, 'Updated Rule');
    assert.equal(updated.enabled, 0);

    // Delete
    await deleteCueRule(db, 'r1');
    const deleted = await getCueRule(db, 'r1');
    assert.equal(deleted, undefined);
  });

  test('insert and retrieve cue events', async () => {
    const db = await createDb();

    await insertCueEvent(db, 'key1', {
      rule_id: 'r1',
      rule_name: 'Test',
      matched: 'hello',
      action: { type: 'event' },
    });

    const events = await getRecentCueEvents(db, 'key1');
    assert.equal(events.length, 1);
    assert.equal(events[0].rule_name, 'Test');
    assert.equal(events[0].matched, 'hello');
  });

  test('getRecentCueEvents respects limit', async () => {
    const db = await createDb();

    for (let i = 0; i < 5; i++) {
      await insertCueEvent(db, 'key1', {
        rule_id: `r${i}`, rule_name: `Rule ${i}`, matched: `m${i}`,
      });
    }

    const events = await getRecentCueEvents(db, 'key1', 3);
    assert.equal(events.length, 3);
  });

  test('migrations are idempotent', async () => {
    const db = await createDb();
    // Plugin migrations are a no-op now — still must not throw
    const { runMigrations } = await import('../src/db.js');
    await runMigrations(db);
    const rules = await listCueRules(db, 'key1');
    assert.deepEqual(rules, []);
  });

  test('evaluateEventCues does nothing without agentEvaluateFn', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    await insertCueRule(db, {
      id: 'ev1', api_key: 'key1',
      name: 'event1',
      match_type: 'event_cue',
      pattern: 'speaker stands up',
      action: {},
      cooldown_ms: 0,
    });
    const results = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => results.push(...fired));
    assert.equal(results.length, 0);
  });

  test('evaluateEventCues calls agent for event_cue rules', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    await insertCueRule(db, {
      id: 'ev2', api_key: 'key1',
      name: 'stand-up',
      match_type: 'event_cue',
      pattern: 'speaker stands up',
      action: { type: 'event' },
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
    const db = await createDb();
    const engine = new CueEngine(db);
    await insertCueRule(db, {
      id: 'ev3', api_key: 'key1',
      name: 'event2',
      match_type: 'event_cue',
      pattern: 'slides change',
      action: {},
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
    const db = await createDb();
    const engine = new CueEngine(db);
    await insertCueRule(db, {
      id: 'ev4', api_key: 'key1',
      name: 'phrase-rule',
      match_type: 'phrase',
      pattern: 'amen',
      action: {},
      cooldown_ms: 0,
    });
    let called = false;
    engine.setAgentEvaluateFn(async () => { called = true; return { matched: true, confidence: 0.9, reasoning: 'ok' }; });
    await engine.evaluateEventCues('key1', 'amen', () => {});
    assert.equal(called, false);
  });

  test('evaluateEventCues handles agent returning not matched', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    await insertCueRule(db, {
      id: 'ev5', api_key: 'key1',
      name: 'event3',
      match_type: 'event_cue',
      pattern: 'applause',
      action: {},
      cooldown_ms: 0,
    });
    engine.setAgentEvaluateFn(async () => ({ matched: false, confidence: 0.2, reasoning: 'not detected' }));
    const r = [];
    await engine.evaluateEventCues('key1', 'text', (fired) => r.push(...fired));
    assert.equal(r.length, 0);
  });
});
