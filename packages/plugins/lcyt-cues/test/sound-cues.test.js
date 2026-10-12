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


describe('CueEngine — sound detection cues', () => {
  let CueEngine, insertCueRule;

  before(async () => {
    ({ CueEngine } = await import('../src/cue-engine.js'));
    ({ insertCueRule } = await import('../src/db.js'));
  });

  test('music_start fires on transition from speech to music', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-on',
      match_type: 'music_start', pattern: '',
      action: { type: 'event', label: 'music_start' },
    });
    const engine = new CueEngine(db);
    // Start with speech
    await engine.evaluateSoundEvent('key1', 'speech');
    // Transition to music
    const fired = await engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'music_start');
  });

  test('music_start does not fire when already in music', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-on',
      match_type: 'music_start', pattern: '',
    });
    const engine = new CueEngine(db);
    await engine.evaluateSoundEvent('key1', 'music');
    // Second music label — no transition
    const fired = await engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired.length, 0);
  });

  test('music_stop fires on transition from music to speech', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-off',
      match_type: 'music_stop', pattern: '',
      action: { type: 'event', label: 'music_stop' },
    });
    const engine = new CueEngine(db);
    await engine.evaluateSoundEvent('key1', 'music');
    const fired = await engine.evaluateSoundEvent('key1', 'speech');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].matched, 'music_stop');
  });

  test('music_stop does not fire when not coming from music', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-off',
      match_type: 'music_stop', pattern: '',
    });
    const engine = new CueEngine(db);
    await engine.evaluateSoundEvent('key1', 'speech');
    const fired = await engine.evaluateSoundEvent('key1', 'silence');
    assert.equal(fired.length, 0);
  });

  test('silence cue fires after minimum duration', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'sl1', api_key: 'key1', name: 'silence-5s',
      match_type: 'silence', pattern: '0.05', // 50ms for test
      action: { type: 'event', label: 'silence_detected' },
    });
    const engine = new CueEngine(db);

    let callbackFired = false;
    let callbackResults = [];
    await engine.evaluateSoundEvent('key1', 'silence', (results) => {
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
    const db = await createDb();
    await insertCueRule(db, {
      id: 'sl1', api_key: 'key1', name: 'silence-long',
      match_type: 'silence', pattern: '1', // 1 second
    });
    const engine = new CueEngine(db);

    let callbackFired = false;
    await engine.evaluateSoundEvent('key1', 'silence', () => {
      callbackFired = true;
    });

    // Break silence immediately
    await engine.evaluateSoundEvent('key1', 'speech');

    // Wait past the silence duration
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(!callbackFired, 'Silence callback should NOT have fired (silence was broken)');

    engine.clearSilenceTimers();
  });

  test('clearSilenceTimers cleans up state', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'sl1', api_key: 'key1', name: 'silence-test',
      match_type: 'silence', pattern: '10',
    });
    const engine = new CueEngine(db);
    await engine.evaluateSoundEvent('key1', 'silence');
    engine.clearSilenceTimers();
    assert.equal(engine._silenceState.size, 0);
  });

  test('evaluateSoundEvent returns empty array when no matching rules', async () => {
    const db = await createDb();
    const engine = new CueEngine(db);
    const fired = await engine.evaluateSoundEvent('key1', 'music');
    assert.deepEqual(fired, []);
  });

  test('cooldown prevents repeated music_start firing', async () => {
    const db = await createDb();
    await insertCueRule(db, {
      id: 'ms1', api_key: 'key1', name: 'music-on',
      match_type: 'music_start', pattern: '',
      cooldown_ms: 60000,
    });
    const engine = new CueEngine(db);
    await engine.evaluateSoundEvent('key1', 'speech');
    const fired1 = await engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired1.length, 1);

    // Quick transition back and forth
    await engine.evaluateSoundEvent('key1', 'speech');
    const fired2 = await engine.evaluateSoundEvent('key1', 'music');
    assert.equal(fired2.length, 0); // cooldown blocks it
  });
});
