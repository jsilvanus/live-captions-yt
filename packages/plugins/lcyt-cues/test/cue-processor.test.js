import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock DB — tracks inserts without real SQLite. */
function makeMockDb() {
  const inserts = [];
  function makeStmt() {
    return {
      run(...args) { inserts.push(args); return { lastInsertRowid: inserts.length }; },
      all() { return []; },
    };
  }
  return {
    exec() {},
    prepare() { return makeStmt(); },
    inserts,
  };
}

/** Build a minimal mock store with one session for the given apiKey. */
function makeMockStore(apiKey) {
  const emitter = new EventEmitter();
  const emitted = [];
  emitter.on('event', (e) => emitted.push(e));
  const session = { apiKey, emitter };
  return {
    getByApiKey(key) { return key === apiKey ? session : null; },
    emitter,
    emitted,
    session,
  };
}

/** Build a minimal mock CueEngine. */
function makeMockEngine(results = []) {
  return {
    evaluate(apiKey, text, codes) {
      return results;
    },
    invalidate() {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCueProcessor', () => {
  let createCueProcessor;

  before(async () => {
    ({ createCueProcessor } = await import('../src/cue-processor.js'));
  });

  test('strips cue metacode and returns clean text', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    const result = proc('test-key', 'Hello <!-- cue:prayer-start --> world');
    assert.equal(result, 'Hello  world');
  });

  test('strips multiple cue metacodes', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    const result = proc('test-key', '<!-- cue:start --> text <!-- cue:end -->');
    assert.equal(result, 'text');
  });

  test('returns unchanged text when no metacodes present', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    const result = proc('test-key', 'Normal caption text');
    assert.equal(result, 'Normal caption text');
  });

  test('returns empty string for pure-metacode captions', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    const result = proc('test-key', '<!-- cue:prayer-start -->');
    assert.equal(result, '');
  });

  test('returns empty string for null/undefined input', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    assert.equal(proc('test-key', null), '');
    assert.equal(proc('test-key', undefined), '');
    assert.equal(proc('test-key', ''), '');
  });

  test('emits cue_fired SSE event for explicit cue metacode', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    proc('test-key', '<!-- cue:prayer-start -->');

    const evt = store.emitted.find(e => e.type === 'cue_fired');
    assert.ok(evt, 'cue_fired event should be emitted');
    assert.equal(evt.data.label, 'prayer-start');
    assert.equal(evt.data.source, 'explicit');
  });

  test('emits cue_fired SSE event for each explicit cue', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    proc('test-key', '<!-- cue:start --> <!-- cue:lights -->');

    const cueEvents = store.emitted.filter(e => e.type === 'cue_fired');
    assert.equal(cueEvents.length, 2);
    assert.equal(cueEvents[0].data.label, 'start');
    assert.equal(cueEvents[1].data.label, 'lights');
  });

  test('emits cue_fired SSE events for auto rules', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine([
      { rule: { id: 'r1', name: 'amen-rule', match_type: 'phrase', action: '{"type":"event"}' }, matched: 'amen' },
    ]);
    const proc = createCueProcessor({ store, db, engine });

    proc('test-key', 'And all the people said amen');

    const autoEvt = store.emitted.find(e => e.type === 'cue_fired' && e.data.source === 'auto');
    assert.ok(autoEvt, 'auto cue_fired event should be emitted');
    assert.equal(autoEvt.data.label, 'amen-rule');
    assert.equal(autoEvt.data.matched, 'amen');
  });

  test('does not emit SSE events for unknown session key', () => {
    const db = makeMockDb();
    const store = makeMockStore('other-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    proc('unknown-key', '<!-- cue:test -->');

    assert.equal(store.emitted.length, 0);
  });

  test('persists explicit cue events to DB', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    proc('test-key', '<!-- cue:offering -->');

    assert.ok(db.inserts.length > 0, 'DB insert should have been called');
    assert.equal(db.inserts[0][0], 'test-key');
  });

  test('handles gracefully when store is null', () => {
    const db = makeMockDb();
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store: null, db, engine });

    const result = proc('any-key', '<!-- cue:test -->');
    assert.equal(result, '');
  });

  test('handles gracefully when db is null', () => {
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db: null, engine });

    const result = proc('test-key', '<!-- cue:test -->');
    assert.equal(result, '');
    // SSE event should still be emitted
    const evt = store.emitted.find(e => e.type === 'cue_fired');
    assert.ok(evt);
  });

  test('handles gracefully when engine is null', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createCueProcessor({ store, db, engine: null });

    const result = proc('test-key', 'Normal text');
    assert.equal(result, 'Normal text');
  });

  test('case-insensitive: CUE in caps', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    const result = proc('test-key', '<!-- CUE:OFFERING --> text');
    assert.equal(result, 'text');
    const evt = store.emitted.find(e => e.type === 'cue_fired');
    assert.ok(evt);
    assert.equal(evt.data.label, 'OFFERING');
  });

  test('preserves surrounding text after stripping metacodes', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const engine = makeMockEngine();
    const proc = createCueProcessor({ store, db, engine });

    const result = proc('test-key', 'Before <!-- cue:mid --> After');
    assert.equal(result, 'Before  After');
  });

  test('passes codes to engine.evaluate', () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    let receivedCodes = null;
    const engine = {
      evaluate(apiKey, text, codes) {
        receivedCodes = codes;
        return [];
      },
      invalidate() {},
    };
    const proc = createCueProcessor({ store, db, engine });

    proc('test-key', 'text', { section: 'Intro' });
    assert.deepEqual(receivedCodes, { section: 'Intro' });
  });
});
