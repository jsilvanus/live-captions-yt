import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock Prisma client — tracks music_events inserts without a real database. */
function makeMockDb() {
  const inserts = [];
  return {
    music_events: {
      create: async ({ data }) => { inserts.push(data); return { id: inserts.length, ...data }; },
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSoundCaptionProcessor', () => {
  let createSoundCaptionProcessor;

  before(async () => {
    ({ createSoundCaptionProcessor } = await import('../src/sound-caption-processor.js'));
  });

  test('strips sound metacode and returns clean text', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    const result = await proc('test-key', 'Hello <!-- sound:music --> world');
    assert.equal(result, 'Hello  world'.trim());
  });

  test('strips bpm metacode', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    const result = await proc('test-key', 'Text <!-- bpm:128 --> here');
    assert.equal(result, 'Text  here'.trim());
  });

  test('strips both metacodes from same caption', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    const result = await proc('test-key', '<!-- sound:music --> <!-- bpm:140 -->');
    assert.equal(result, '');
  });

  test('returns unchanged text when no metacodes present', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    const result = await proc('test-key', 'Normal caption text');
    assert.equal(result, 'Normal caption text');
  });

  test('returns empty string for null/undefined input', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    // null/undefined → return as-is (falsy passthrough)
    assert.equal(await proc('test-key', null), null);
    assert.equal(await proc('test-key', undefined), undefined);
    assert.equal(await proc('test-key', ''), '');
  });

  test('emits sound_label SSE event for sound metacode', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    await proc('test-key', '<!-- sound:music -->');

    const soundEvt = store.emitted.find(e => e.type === 'sound_label');
    assert.ok(soundEvt, 'sound_label event should be emitted');
    assert.equal(soundEvt.data.label, 'music');
  });

  test('emits bpm_update SSE event for bpm metacode', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    await proc('test-key', '<!-- bpm:128 -->');

    const bpmEvt = store.emitted.find(e => e.type === 'bpm_update');
    assert.ok(bpmEvt, 'bpm_update event should be emitted');
    assert.equal(bpmEvt.data.bpm, 128);
  });

  test('emits both SSE events when both metacodes are present', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    await proc('test-key', '<!-- sound:speech --> <!-- bpm:75 -->');

    const types = store.emitted.map(e => e.type);
    assert.ok(types.includes('sound_label'), 'sound_label should be emitted');
    assert.ok(types.includes('bpm_update'), 'bpm_update should be emitted');
  });

  test('does not emit SSE events when no metacodes present', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    await proc('test-key', 'No metacodes here');

    assert.equal(store.emitted.length, 0);
  });

  test('does not emit SSE event for unknown session key', async () => {
    const db = makeMockDb();
    const store = makeMockStore('other-key');
    const proc = createSoundCaptionProcessor({ store, db });

    // Using a different apiKey — session won't be found
    await proc('unknown-key', '<!-- sound:silence -->');

    assert.equal(store.emitted.length, 0);
  });

  test('inserts label_change event into DB', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    await proc('test-key', '<!-- sound:music -->');

    assert.ok(db.inserts.length > 0, 'DB insert should have been called');
    assert.equal(db.inserts[0].api_key, 'test-key');
    assert.equal(db.inserts[0].event_type, 'label_change');
  });

  test('handles gracefully when store is null', async () => {
    const db = makeMockDb();
    const proc = createSoundCaptionProcessor({ store: null, db });

    // Should not throw even with no store
    const result = await proc('any-key', '<!-- sound:music -->');
    assert.equal(result, '');
  });

  test('handles gracefully when db is null', async () => {
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db: null });

    // Should not throw even with no db
    const result = await proc('test-key', '<!-- sound:music -->');
    assert.equal(result, '');
    // SSE event should still be emitted
    const soundEvt = store.emitted.find(e => e.type === 'sound_label');
    assert.ok(soundEvt);
  });

  test('case-insensitive: SOUND and BPM in caps', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    const result = await proc('test-key', '<!-- SOUND:MUSIC --> text <!-- BPM:90 -->');
    assert.equal(result, 'text');
    assert.ok(store.emitted.find(e => e.type === 'sound_label'));
    assert.ok(store.emitted.find(e => e.type === 'bpm_update'));
  });

  test('preserves surrounding text after stripping metacodes', async () => {
    const db = makeMockDb();
    const store = makeMockStore('test-key');
    const proc = createSoundCaptionProcessor({ store, db });

    const result = await proc('test-key', 'Before <!-- sound:silence --> After');
    assert.equal(result, 'Before  After'.trim());
  });
});
