import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// In-memory SQLite for testing sound/silence cue rules
// ---------------------------------------------------------------------------

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping sound cue tests');
  process.exit(0);
}

describe('CueEngine — sound detection cues', () => {
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

  test('music_start fires on transition from speech to music', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-on',
      match_type: 'music_start', pattern: '',
      action: { type: 'event', label: 'music_start' },
    });
    const engine = new CueEngine(db);
    // Start with speech
    engine.evaluateSoundEvent('key1', 'speech');
    // Transition to music
    const fired = engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'music_start');
  });

  test('music_start does not fire when already in music', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-on',
      match_type: 'music_start', pattern: '',
    });
    const engine = new CueEngine(db);
    engine.evaluateSoundEvent('key1', 'music');
    // Second music label — no transition
    const fired = engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired.length, 0);
  });

  test('music_stop fires on transition from music to speech', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-off',
      match_type: 'music_stop', pattern: '',
      action: { type: 'event', label: 'music_stop' },
    });
    const engine = new CueEngine(db);
    engine.evaluateSoundEvent('key1', 'music');
    const fired = engine.evaluateSoundEvent('key1', 'speech');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'music_stop');
  });

  test('music_stop does not fire when not coming from music', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-off',
      match_type: 'music_stop', pattern: '',
    });
    const engine = new CueEngine(db);
    engine.evaluateSoundEvent('key1', 'speech');
    const fired = engine.evaluateSoundEvent('key1', 'silence');
    assert.equal(fired.length, 0);
  });

  test('silence cue fires after minimum duration', async () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'sl1', api_key: 'key1', name: 'silence-5s',
      match_type: 'silence', pattern: '0.05', // 50ms for test
      action: { type: 'event', label: 'silence_detected' },
    });
    const engine = new CueEngine(db);

    let callbackFired = false;
    let callbackResults = [];
    engine.evaluateSoundEvent('key1', 'silence', (results) => {
      callbackFired = true;
      callbackResults = results;
    });

    // Wait for the timer to fire
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(callbackFired, 'Silence callback should have fired');
    assert.equal(callbackResults.length, 1);
    assert.ok(callbackResults[0].matched.startsWith('silence:'));

    engine.clearSilenceTimers();
  });

  test('silence cue cancels when silence is broken', async () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'sl1', api_key: 'key1', name: 'silence-long',
      match_type: 'silence', pattern: '1', // 1 second
    });
    const engine = new CueEngine(db);

    let callbackFired = false;
    engine.evaluateSoundEvent('key1', 'silence', () => {
      callbackFired = true;
    });

    // Break silence immediately
    engine.evaluateSoundEvent('key1', 'speech');

    // Wait past the silence duration
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(!callbackFired, 'Silence callback should NOT have fired (silence was broken)');

    engine.clearSilenceTimers();
  });

  test('clearSilenceTimers cleans up state', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'sl1', api_key: 'key1', name: 'silence-test',
      match_type: 'silence', pattern: '10',
    });
    const engine = new CueEngine(db);
    engine.evaluateSoundEvent('key1', 'silence');
    engine.clearSilenceTimers();
    assert.equal(engine._silenceState.size, 0);
  });

  test('evaluateSoundEvent returns empty array when no matching rules', () => {
    const db = createDb();
    const engine = new CueEngine(db);
    const fired = engine.evaluateSoundEvent('key1', 'music');
    assert.deepEqual(fired, []);
  });

  test('cooldown prevents repeated music_start firing', () => {
    const db = createDb();
    insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-on',
      match_type: 'music_start', pattern: '',
      cooldown_ms: 60000,
    });
    const engine = new CueEngine(db);
    engine.evaluateSoundEvent('key1', 'speech');
    const fired1 = engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired1.length, 1);

    // Quick transition back and forth
    engine.evaluateSoundEvent('key1', 'speech');
    const fired2 = engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired2.length, 0); // cooldown blocks it
  });
});
